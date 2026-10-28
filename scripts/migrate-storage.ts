/**
 * Move media objects between storage drivers.
 *
 *   npm run migrate:storage -- s3-to-local
 *   npm run migrate:storage -- local-to-s3
 *   npm run migrate:storage -- s3-to-local --dry-run
 *
 * Uses the backend's env config. Both storage endpoints and the database must be
 * reachable: the MIME type comes from the `media` table, and an object stored
 * without a Content-Type serves as application/octet-stream, which browsers
 * will not play as video.
 *
 * The `media` table is not modified; `bucket_key` is the sha256 hex on every driver.
 * Each copied object is re-hashed and must match its key; objects already at the
 * destination are skipped without re-verification. Re-runnable; the source is
 * never deleted.
 */
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { readdir, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { config } from "../src/config.js"
import { pool } from "../src/db/pool.js"
import { localFsStorage, objectPath } from "../src/storage/localFsStorage.js"
import { s3Client, s3Storage } from "../src/storage/s3Storage.js"

const MODE = process.argv[2]
const DRY_RUN = process.argv.includes("--dry-run")

if (MODE !== "s3-to-local" && MODE !== "local-to-s3") {
  console.error("usage: migrate-storage.ts <s3-to-local|local-to-s3> [--dry-run]")
  process.exit(1)
}

const BUCKET = config.minio.bucket
const ROOT = path.resolve(config.storage.localDir)

/** Content type is only recoverable from the DB: the local driver stores no metadata. */
async function mimeOf(hash: string): Promise<string> {
  const { rows } = await pool.query<{ mime: string }>(`SELECT mime FROM media WHERE hash = $1`, [
    hash,
  ])
  return rows[0]?.mime ?? "application/octet-stream"
}

async function sha256OfFile(p: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(createReadStream(p), hash)
  return hash.digest("hex")
}

const stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 }

async function s3ToLocal(): Promise<void> {
  await localFsStorage.init()

  const keys: string[] = []
  for await (const obj of s3Client().listObjectsV2(BUCKET, "", true)) {
    if (obj.name) keys.push(obj.name)
  }
  console.log(`${keys.length} objects in s3://${BUCKET}`)

  for (const key of keys) {
    if (await localFsStorage.exists(key)) {
      stats.skipped++
      continue
    }
    if (DRY_RUN) {
      console.log(`would copy ${key} -> ${objectPath(key)}`)
      stats.copied++
      continue
    }

    const spool = path.join(tmpdir(), `xr360-migrate-${randomUUID()}`)
    try {
      const stream = await s3Client().getObject(BUCKET, key)
      await pipeline(stream, createWriteStream(spool))

      const digest = await sha256OfFile(spool)
      if (digest !== key) {
        throw new Error(`digest mismatch: stored as ${key}, bytes hash to ${digest}`)
      }
      await localFsStorage.putFile(key, spool, await mimeOf(key))
      stats.copied++
    } catch (err) {
      console.error(`FAILED ${key}: ${(err as Error).message}`)
      stats.failed++
    } finally {
      await unlink(spool).catch(() => {})
    }
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (!entry.name.includes(".tmp-")) yield full
  }
}

async function localToS3(): Promise<void> {
  try {
    await readdir(ROOT)
  } catch {
    console.error(`local media root ${ROOT} does not exist — nothing to migrate`)
    process.exit(1)
  }
  await s3Storage.init()

  for await (const file of walk(ROOT)) {
    const key = path.basename(file)

    if (await s3Storage.exists(key)) {
      stats.skipped++
      continue
    }
    if (DRY_RUN) {
      console.log(`would copy ${file} -> s3://${BUCKET}/${key}`)
      stats.copied++
      continue
    }

    try {
      // The filename is the expected digest.
      const digest = await sha256OfFile(file)
      if (digest !== key) {
        throw new Error(`digest mismatch: named ${key}, bytes hash to ${digest}`)
      }
      await s3Storage.putFile(key, file, await mimeOf(key))
      stats.copied++
    } catch (err) {
      console.error(`FAILED ${key}: ${(err as Error).message}`)
      stats.failed++
    }
  }
}

const started = Date.now()
await (MODE === "s3-to-local" ? s3ToLocal() : localToS3())
await pool.end()

console.log(
  `\n${DRY_RUN ? "[dry run] " : ""}copied ${stats.copied}, skipped ${stats.skipped} ` +
    `(already present), failed ${stats.failed} — ${((Date.now() - started) / 1000).toFixed(1)}s`
)
if (stats.failed > 0) {
  console.error("Some objects failed. Nothing was deleted from the source; re-run to retry.")
  process.exit(1)
}
console.log("Source untouched. Flip STORAGE_DRIVER, verify, then retire the old backend.")
