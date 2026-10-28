import { createReadStream } from "node:fs"
import { access, copyFile, mkdir, rename, stat, unlink } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import path from "node:path"
import { config } from "../config.js"
import type { MediaRow } from "../db/schema.js"
import type { ByteRange, DownloadResult, IStorage } from "./types.js"

/**
 * Plain-directory media storage. Bytes are streamed through the backend, so this
 * driver serves HTTP Range requests itself.
 */

const root = () => path.resolve(config.storage.localDir)

/** On-disk path for a key, sharded as `ab/cd/<hash>` under the media root. */
export function objectPath(key: string): string {
  return path.join(root(), key.slice(0, 2), key.slice(2, 4), key)
}

export const localFsStorage: IStorage = {
  driver: "local",

  /** Creates the media root and throws if it is not writable. */
  async init(): Promise<void> {
    await mkdir(root(), { recursive: true })
    try {
      await access(root(), fsConstants.W_OK)
    } catch {
      throw new Error(
        `[storage:local] media root ${root()} is not writable by uid ${process.getuid?.() ?? "?"}. ` +
          `If this is a docker named volume, chown it to the container user.`
      )
    }
    console.log(`[storage:local] media root ${root()}`)
  },

  async healthy(): Promise<boolean> {
    try {
      await access(root(), fsConstants.W_OK)
      return true
    } catch {
      return false
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      await access(objectPath(key), fsConstants.R_OK)
      return true
    } catch {
      return false
    }
  },

  /**
   * Copies to a staging file, then renames it into place atomically. The source
   * may be on another filesystem, where a direct rename fails with EXDEV.
   */
  async putFile(key: string, sourcePath: string, _mime: string): Promise<void> {
    const target = objectPath(key)
    await mkdir(path.dirname(target), { recursive: true })

    const staging = `${target}.tmp-${randomUUID()}`
    try {
      await copyFile(sourcePath, staging)
      await rename(staging, target)
    } catch (err) {
      await unlink(staging).catch(() => {})
      throw err
    }
  },

  async openRead(key: string): Promise<Readable | null> {
    const target = objectPath(key)
    try {
      await stat(target)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      throw err
    }
    return createReadStream(target)
  },

  async resolveDownload(media: MediaRow, range: ByteRange | null): Promise<DownloadResult | null> {
    const target = objectPath(media.bucket_key)

    let size: number
    try {
      ;({ size } = await stat(target))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      throw err
    }

    const stream = range
      ? createReadStream(target, { start: range.start, end: range.end })
      : createReadStream(target)

    return { kind: "stream", stream, totalSize: size, range, mime: media.mime }
  },
}
