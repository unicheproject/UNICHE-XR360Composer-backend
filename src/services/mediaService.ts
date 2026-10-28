import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform, type Readable } from "node:stream"
import { randomUUID } from "node:crypto"
import { pool } from "../db/pool.js"
import { storage } from "../storage/index.js"
import { config } from "../config.js"
import { validateAsset } from "./assetValidation.js"
import type { MediaRow } from "../db/schema.js"
import type { ByteRange, DownloadResult } from "../storage/types.js"
import type { AuthUser, MediaUploadResult } from "../types/api.js"

/**
 * Content-addressed media storage. Uploads are spooled to a temp file while
 * being hashed; the object key is the sha256 of the bytes, so identical uploads
 * resolve to one object.
 */

export class MediaTooLargeError extends Error {
  statusCode = 413
}

export async function storeUpload(
  stream: Readable,
  mime: string,
  originalName: string,
  user: AuthUser
): Promise<MediaUploadResult> {
  const hash = createHash("sha256")
  let size = 0

  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length
      if (size > config.media.maxBytes) {
        cb(new MediaTooLargeError(`File exceeds ${config.media.maxBytes} bytes`))
        return
      }
      hash.update(chunk)
      cb(null, chunk)
    },
  })

  const tmpPath = path.join(tmpdir(), `xr360-upload-${randomUUID()}`)
  try {
    await pipeline(stream, tap, createWriteStream(tmpPath))

    // Runs before the dedup check so re-uploads are validated against current limits.
    await validateAsset(tmpPath, mime, originalName)

    const hexHash = hash.digest("hex")

    // Dedup checks the storage backend; a media row does not prove the bytes are stored.
    if (!(await storage.exists(hexHash))) {
      await storage.putFile(hexHash, tmpPath, mime)
    }
    await pool.query(
      `INSERT INTO media (hash, bucket_key, mime, size, original_name, first_uploaded_by)
       VALUES ($1, $1, $2, $3, $4, $5)
       ON CONFLICT (hash) DO NOTHING`,
      [hexHash, mime, size, originalName, user.sub]
    )

    return { hash: hexHash, url: `/api/media/${hexHash}`, mime, size }
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

export async function getMedia(hash: string): Promise<MediaRow | null> {
  const { rows } = await pool.query<MediaRow>(`SELECT * FROM media WHERE hash = $1`, [hash])
  return rows[0] ?? null
}

/**
 * How to serve a stored object: a redirect to a presigned URL (s3 driver) or a
 * byte stream honouring `range` (local driver).
 */
export async function resolveDownload(
  media: MediaRow,
  range: ByteRange | null
): Promise<DownloadResult | null> {
  return storage.resolveDownload(media, range)
}

/** Raw bytes of a stored object, or null when the storage backend does not hold it. */
export function openMediaStream(media: MediaRow): Promise<Readable | null> {
  return storage.openRead(media.bucket_key)
}

/** Whether the active storage backend holds the object's bytes. */
export function mediaBytesPresent(media: MediaRow): Promise<boolean> {
  return storage.exists(media.bucket_key)
}
