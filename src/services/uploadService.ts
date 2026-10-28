import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { config } from "../config.js"
import { pool } from "../db/pool.js"
import { isAllowedUpload } from "../schemas/media.js"
import { MediaTooLargeError, storeUpload } from "./mediaService.js"
import type { MediaUploadRow } from "../db/schema.js"
import type {
  AuthUser,
  MediaUploadResult,
  UploadInitResult,
  UploadSessionInfo,
} from "../types/api.js"

/**
 * Resumable chunked upload.
 *
 * Parts spool to `tmpdir()/xr360-uploads/<sessionId>/<partNo>`, outside the media
 * storage backend; sessions survive a process restart but not a reboot.
 * `completeUpload` streams the parts in order into `storeUpload`. Peak scratch
 * disk is ~3x the upload size for the local driver and ~2x for s3.
 */

export class UploadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

const sessionDir = (uploadId: string) => path.join(tmpdir(), "xr360-uploads", uploadId)
const partPath = (uploadId: string, partNo: number) =>
  path.join(sessionDir(uploadId), String(partNo).padStart(6, "0"))

/** Deletes sessions past their TTL; runs at the start of `initUpload`. */
async function sweepExpired(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `DELETE FROM media_uploads WHERE expires_at < now() RETURNING id`
  )
  await Promise.all(rows.map((r) => rm(sessionDir(r.id), { recursive: true, force: true })))
}

export async function initUpload(
  user: AuthUser,
  input: { filename: string; mime: string; size: number; partSize?: number }
): Promise<UploadInitResult> {
  await sweepExpired()

  // File-type gate for the chunked path, which has no multipart envelope.
  const verdict = isAllowedUpload(input.mime, input.filename)
  if (!verdict.ok) throw new UploadError(verdict.reason, 415)

  // Advisory check on the declared size; `completeUpload` enforces the real total.
  if (input.size > config.media.maxBytes) {
    throw new MediaTooLargeError(`File exceeds ${config.media.maxBytes} bytes`)
  }

  const { defaultPartBytes, maxPartBytes, maxParts, ttlMinutes } = config.media.upload
  const partSize = Math.min(input.partSize ?? defaultPartBytes, maxPartBytes)
  const totalParts = Math.ceil(input.size / partSize)
  if (totalParts > maxParts) {
    throw new UploadError(`Too many parts (${totalParts} > ${maxParts}); use a larger partSize`, 400)
  }

  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media_uploads (owner_sub, filename, mime, declared_size, part_size, total_parts, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [user.sub, input.filename, verdict.mime, input.size, partSize, totalParts, expiresAt]
  )
  const uploadId = rows[0]!.id

  await mkdir(sessionDir(uploadId), { recursive: true })
  return {
    uploadId,
    partSize,
    totalParts,
    expiresAt: expiresAt.toISOString(),
  }
}

/** The caller's unexpired session, or null when missing, expired or owned by someone else. */
export async function getSession(uploadId: string, user: AuthUser): Promise<MediaUploadRow | null> {
  const { rows } = await pool.query<MediaUploadRow>(
    `SELECT * FROM media_uploads WHERE id = $1 AND owner_sub = $2 AND expires_at > now()`,
    [uploadId, user.sub]
  )
  return rows[0] ?? null
}

async function listParts(uploadId: string): Promise<number[]> {
  const { rows } = await pool.query<{ part_no: number }>(
    `SELECT part_no FROM media_upload_parts WHERE upload_id = $1 ORDER BY part_no`,
    [uploadId]
  )
  return rows.map((r) => r.part_no)
}

export async function describeSession(session: MediaUploadRow): Promise<UploadSessionInfo> {
  return {
    uploadId: session.id,
    partSize: session.part_size,
    totalParts: session.total_parts,
    size: Number(session.declared_size),
    expiresAt: session.expires_at.toISOString(),
    receivedParts: await listParts(session.id),
  }
}

/** Spools one part; re-uploading a part overwrites it. */
export async function recordPart(
  session: MediaUploadRow,
  partNo: number,
  body: Readable
): Promise<void> {
  if (partNo > session.total_parts) {
    throw new UploadError(`Part ${partNo} exceeds totalParts ${session.total_parts}`, 400)
  }

  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      if (received > session.part_size) {
        cb(new UploadError(`Part exceeds partSize ${session.part_size}`, 413))
        return
      }
      cb(null, chunk)
    },
  })

  await mkdir(sessionDir(session.id), { recursive: true })
  const target = partPath(session.id, partNo)
  const staging = `${target}.tmp-${randomUUID()}`

  try {
    await pipeline(body, limit, createWriteStream(staging))
    // Atomic rename: a part becomes visible only once complete.
    await rename(staging, target)
  } catch (err) {
    await unlink(staging).catch(() => {})
    throw err
  }

  await pool.query(
    `INSERT INTO media_upload_parts (upload_id, part_no, size)
     VALUES ($1, $2, $3)
     ON CONFLICT (upload_id, part_no) DO UPDATE SET size = EXCLUDED.size`,
    [session.id, partNo, received]
  )
}

/** Streams all parts in order as one Readable. */
function orderedPartStream(uploadId: string, totalParts: number): Readable {
  async function* parts(): AsyncGenerator<Buffer> {
    for (let partNo = 1; partNo <= totalParts; partNo++) {
      yield* createReadStream(partPath(uploadId, partNo))
    }
  }
  return Readable.from(parts(), { objectMode: false })
}

export async function completeUpload(
  session: MediaUploadRow,
  user: AuthUser
): Promise<MediaUploadResult> {
  const { rows } = await pool.query<{ part_no: number; size: number }>(
    `SELECT part_no, size FROM media_upload_parts WHERE upload_id = $1 ORDER BY part_no`,
    [session.id]
  )

  if (rows.length !== session.total_parts) {
    const received = new Set(rows.map((r) => r.part_no))
    const missing = Array.from({ length: session.total_parts }, (_, i) => i + 1).filter(
      (n) => !received.has(n)
    )
    throw new UploadError(`Upload incomplete; missing parts: ${missing.join(", ")}`, 409)
  }

  const total = rows.reduce((sum, r) => sum + r.size, 0)
  if (total > config.media.maxBytes) {
    throw new MediaTooLargeError(`File exceeds ${config.media.maxBytes} bytes`)
  }
  if (total !== Number(session.declared_size)) {
    throw new UploadError(
      `Reassembled size ${total} does not match declared ${session.declared_size}`,
      400
    )
  }

  const result = await storeUpload(
    orderedPartStream(session.id, session.total_parts),
    session.mime,
    session.filename,
    user
  )

  await abortUpload(session)
  return result
}

/** Drop the session and its scratch bytes. Idempotent. */
export async function abortUpload(session: MediaUploadRow): Promise<void> {
  await pool.query(`DELETE FROM media_uploads WHERE id = $1`, [session.id])
  await rm(sessionDir(session.id), { recursive: true, force: true })
}
