import type { Readable } from "node:stream"
import archiver from "archiver"
import type { MediaRow } from "../db/schema.js"
import { getMedia, mediaBytesPresent, openMediaStream } from "./mediaService.js"

/**
 * Offline experience bundles: a zip holding one root folder with `bundle.json`,
 * `experience.json` and `media/`. The layout must match what the device client
 * writes when it downloads an experience over the network.
 */

export const BUNDLE_FORMAT_VERSION = 1

const MEDIA_DIR = "media"
const MANIFEST_FILE = "bundle.json"
const DOCUMENT_FILE = "experience.json"

// Schema-agnostic media discovery over the raw document JSON.
const MEDIA_REF = /\/api\/media\/([0-9a-f]{64})/g

export interface BundleManifest {
  formatVersion: number
  id: string
  experiencePid: string
  title: string
  revision: number
  /** Stored filenames under `media/`. A bundle is complete iff every one is present. */
  media: string[]
}

interface BundleEntry {
  filename: string
  media: MediaRow
}

export interface BundlePlan {
  /** Single root folder inside the zip, so unzipping yields one folder to copy. */
  rootDir: string
  filename: string
  manifest: BundleManifest
  documentJson: string
  entries: BundleEntry[]
}

/** A referenced media object is missing from the database or the storage backend. */
export class BundleMediaMissingError extends Error {
  statusCode = 409
}

/** The archive closed before an entry was written (client aborted the download). */
export class BundleAbortedError extends Error {}

/**
 * File extension for a stored video, or "" for other media. Unity's `VideoPlayer`
 * infers the container from the extension; textures and models stay bare `<hash>`.
 */
export function videoExtension(mime: string): string {
  const [type = ""] = mime.split(";")
  switch (type.trim().toLowerCase()) {
    case "video/mp4":
      return ".mp4"
    case "video/webm":
      return ".webm"
    case "video/quicktime":
      return ".mov"
    case "video/x-matroska":
      return ".mkv"
    default:
      return ""
  }
}

export function extractMediaHashes(json: string): string[] {
  return [...new Set(Array.from(json.matchAll(MEDIA_REF), (m) => m[1] as string))]
}

/** ASCII, filesystem- and Content-Disposition-safe. The manifest carries the real title. */
export function slugify(title: string): string {
  const slug = title
    // NFKD + strip combining marks: "Élmény" → "elmeny".
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "")
  return slug || "experience"
}

/**
 * Resolves the manifest, document and media entries before streaming, so a missing
 * media object can still be reported as a status code.
 */
export async function planBundle(input: {
  id: string
  title: string
  revision: number
  experiencePid: string
  content: unknown
}): Promise<BundlePlan> {
  let documentJson = JSON.stringify(input.content, null, 2)
  const entries: BundleEntry[] = []

  for (const hash of extractMediaHashes(documentJson)) {
    const media = await getMedia(hash)
    if (!media) {
      throw new BundleMediaMissingError(`Media ${hash} referenced by this experience is missing`)
    }
    if (!(await mediaBytesPresent(media))) {
      throw new BundleMediaMissingError(`Media ${hash} is not present in this storage backend`)
    }
    const filename = hash + videoExtension(media.mime)
    // Video refs are rewritten to the extension-bearing stored name.
    if (filename !== hash) {
      documentJson = documentJson.split(`/api/media/${hash}`).join(filename)
    }
    entries.push({ filename, media })
  }

  const rootDir = `${slugify(input.title)}-rev${input.revision}`
  return {
    rootDir,
    filename: `${rootDir}.zip`,
    manifest: {
      formatVersion: BUNDLE_FORMAT_VERSION,
      id: input.id,
      experiencePid: input.experiencePid,
      title: input.title,
      revision: input.revision,
      media: entries.map((e) => e.filename),
    },
    documentJson,
    entries,
  }
}

export function createArchive(): archiver.Archiver {
  // Store-only: media are already compressed.
  return archiver("zip", { store: true })
}

/**
 * Fills and finalizes the archive, opening one media stream at a time. On
 * rejection the archive has already been destroyed.
 */
export async function writeBundle(archive: archiver.Archiver, plan: BundlePlan): Promise<void> {
  try {
    await appendEntry(archive, JSON.stringify(plan.manifest, null, 2), `${plan.rootDir}/${MANIFEST_FILE}`)
    await appendEntry(archive, plan.documentJson, `${plan.rootDir}/${DOCUMENT_FILE}`)

    for (const entry of plan.entries) {
      const stream = await openMediaStream(entry.media)
      if (!stream) {
        throw new BundleMediaMissingError(`Media ${entry.media.hash} is not present in this storage backend`)
      }
      try {
        await appendEntry(archive, stream, `${plan.rootDir}/${MEDIA_DIR}/${entry.filename}`)
      } catch (err) {
        stream.destroy()
        throw err
      }
    }

    await archive.finalize()
  } catch (err) {
    // The response is already streaming: truncate the download rather than hang.
    archive.destroy(err as Error)
    throw err
  }
}

/**
 * Appends one entry and waits for the archive to consume it. Also settles on
 * `close`, since an aborted download destroys the archive without an `error` event.
 */
function appendEntry(
  archive: archiver.Archiver,
  source: string | Readable,
  name: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      archive.off("entry", onEntry)
      archive.off("error", onError)
      archive.off("close", onClose)
    }
    // archiver processes appends serially, so the next `entry` event is this append's.
    const onEntry = (): void => {
      cleanup()
      resolve()
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onClose = (): void => {
      cleanup()
      reject(new BundleAbortedError(`Archive closed before '${name}' was written`))
    }
    archive.once("entry", onEntry)
    archive.once("error", onError)
    archive.once("close", onClose)
    archive.append(source, { name })
  })
}
