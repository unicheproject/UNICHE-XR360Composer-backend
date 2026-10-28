import path from "node:path"

/**
 * Upload gate. Images and videos are matched by MIME prefix; 3D models
 * usually arrive as application/octet-stream, so those are matched by
 * file extension instead.
 */

const MODEL_EXTENSIONS = new Set([
  ".fbx",
  ".obj",
  ".gltf",
  ".glb",
  ".dae",
  ".stl",
  ".ply",
  ".3ds",
])

const MODEL_MIME_FALLBACK = "application/octet-stream"

/** The three content families the upload path recognises and validates. */
export type AssetCategory = "image" | "video" | "model"

/**
 * Classify by MIME prefix (images/videos) or file extension (3D models).
 * Returns null for anything unsupported.
 */
export function classifyAsset(mime: string, filename: string): AssetCategory | null {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (MODEL_EXTENSIONS.has(path.extname(filename).toLowerCase())) return "model"
  return null
}

export type UploadVerdict = { ok: true; mime: string } | { ok: false; reason: string }

export function isAllowedUpload(mime: string, filename: string): UploadVerdict {
  const category = classifyAsset(mime, filename)
  if (category === "image" || category === "video") return { ok: true, mime }
  if (category === "model") return { ok: true, mime: mime || MODEL_MIME_FALLBACK }

  const ext = path.extname(filename).toLowerCase()
  return {
    ok: false,
    reason: `Unsupported file type (${mime || "unknown"}, ${ext || "no extension"}). Allowed: images, videos, 3D models (${[...MODEL_EXTENSIONS].join(", ")}).`,
  }
}
