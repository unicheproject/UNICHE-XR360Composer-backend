import * as Minio from "minio"
import type { Readable } from "node:stream"
import { config } from "../config.js"
import type { MediaRow } from "../db/schema.js"
import type { ByteRange, DownloadResult, IStorage } from "./types.js"

/**
 * S3-compatible object storage (MinIO, AWS S3, R2, …) via the `minio` client,
 * configured by the MINIO_* env vars.
 */

// Clients are built on first use so importing this module needs no MINIO_* config.
let io: Minio.Client | null = null
let presign: Minio.Client | null = null

/**
 * Client for all object I/O. `region` is set explicitly so the SDK never looks it
 * up over the network; it must match the bucket's region.
 */
function ioClient(): Minio.Client {
  io ??= new Minio.Client({
    endPoint: config.minio.endpoint,
    port: config.minio.port,
    useSSL: config.minio.useSsl,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
    region: config.minio.region,
    pathStyle: config.minio.pathStyle,
  })
  return io
}

/**
 * Client used only for presigning GET URLs, against the browser-facing endpoint
 * (MINIO_PUBLIC_ENDPOINT), since the host is part of the signature.
 */
function presignClient(): Minio.Client {
  presign ??= new Minio.Client({
    endPoint: config.minio.publicEndpoint,
    port: config.minio.publicPort,
    useSSL: config.minio.publicUseSsl,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
    region: config.minio.region,
    pathStyle: config.minio.pathStyle,
  })
  return presign
}

/** The raw object-I/O client, for ops scripts that list or read objects in bulk. */
export function s3Client(): Minio.Client {
  return ioClient()
}

export const s3Storage: IStorage = {
  driver: "s3",

  async init(): Promise<void> {
    const exists = await ioClient().bucketExists(config.minio.bucket)
    if (!exists) {
      await ioClient().makeBucket(config.minio.bucket, config.minio.region)
      console.log(
        `[storage:s3] created bucket ${config.minio.bucket} in ${config.minio.region}`
      )
    }
  },

  async healthy(): Promise<boolean> {
    try {
      await ioClient().bucketExists(config.minio.bucket)
      return true
    } catch {
      return false
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await ioClient().statObject(config.minio.bucket, key)
      return true
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "NotFound" || code === "NoSuchKey") return false
      throw err
    }
  },

  async putFile(key: string, sourcePath: string, mime: string): Promise<void> {
    await ioClient().fPutObject(config.minio.bucket, key, sourcePath, { "Content-Type": mime })
  },

  /** Reads via the internal client; the public endpoint may be unreachable from here. */
  async openRead(key: string): Promise<Readable | null> {
    try {
      return await ioClient().getObject(config.minio.bucket, key)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "NotFound" || code === "NoSuchKey") return null
      throw err
    }
  },

  /**
   * Always a redirect to a presigned URL, without checking that the object exists.
   * `range` is unused: the client re-issues it against the presigned URL.
   */
  async resolveDownload(media: MediaRow, _range: ByteRange | null): Promise<DownloadResult> {
    const url = await presignClient().presignedGetObject(
      config.minio.bucket,
      media.bucket_key,
      config.media.urlExpirySeconds
    )
    return { kind: "redirect", url }
  },
}
