import type { Readable } from "node:stream"
import type { MediaRow } from "../db/schema.js"

/**
 * Media storage backend types. A driver `key` is always `MediaRow.bucket_key`,
 * the sha256 hex of the bytes; each driver maps it to a location itself.
 */

/** Inclusive byte range, as HTTP means it: `bytes=0-1023` is 1024 bytes. */
export interface ByteRange {
  start: number
  end: number
}

/** How a media object is served: a redirect URL, or a byte stream from the backend. */
export type DownloadResult =
  | { kind: "redirect"; url: string }
  | {
      kind: "stream"
      stream: Readable
      /** Full object size, regardless of whether `range` narrows the stream. */
      totalSize: number
      /** Null for a full-body response; set for a 206. */
      range: ByteRange | null
      mime: string
    }

export interface IStorage {
  readonly driver: "s3" | "local"

  /** Boot-time setup: create the bucket / the media directory. */
  init(): Promise<void>

  healthy(): Promise<boolean>

  /** Whether the object is present in this backend. */
  exists(key: string): Promise<boolean>

  /** Stores an already-spooled file at `key`. */
  putFile(key: string, sourcePath: string, mime: string): Promise<void>

  /**
   * Reads a whole object as a stream (on every driver, including redirecting ones).
   * Returns null when this backend does not hold the object.
   */
  openRead(key: string): Promise<Readable | null>

  /**
   * Resolves how to serve `media`. Streaming drivers honour `range` and return
   * null when they do not hold the object; redirecting drivers ignore `range` and
   * always return a redirect.
   */
  resolveDownload(media: MediaRow, range: ByteRange | null): Promise<DownloadResult | null>
}
