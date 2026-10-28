import { open } from "node:fs/promises"
import { createFile, MP4BoxBuffer, type Movie } from "mp4box"
import { assetLimits } from "../../config/assetLimits.js"
import { AssetValidationError } from "../assetValidationError.js"

// mp4box logs an unsuppressible "[BoxParser] Invalid box type" line on non-MP4 input.

/**
 * Compatibility gate: accepts only MP4 containers with allowed video/audio codecs
 * (MP4 / H.264 / AAC). Reading stops once the moov box is parsed.
 */
export async function validateVideo(tmpPath: string): Promise<void> {
  const { mp4Brands, videoCodecs, audioCodecs } = assetLimits.video

  const info = await probeMp4(tmpPath)
  if (!info) {
    throw new AssetValidationError(
      "video.container",
      {},
      "Video is not a readable MP4 file. Re-export as MP4 (H.264 video, AAC audio)."
    )
  }

  const brands = new Set((info.brands ?? []).map((b) => b.trim().toLowerCase()))
  if (!mp4Brands.some((b) => brands.has(b))) {
    throw new AssetValidationError(
      "video.container",
      { brands: [...brands] },
      "Video container is not MP4. Re-export as MP4 (H.264 video, AAC audio)."
    )
  }

  const videoTracks = info.videoTracks ?? []
  if (videoTracks.length === 0) {
    throw new AssetValidationError(
      "video.noVideoTrack",
      {},
      "File has no video track. Upload an MP4 with an H.264 video track."
    )
  }
  for (const track of videoTracks) {
    if (!codecAllowed(track.codec, videoCodecs)) {
      throw new AssetValidationError(
        "video.codec",
        { codec: track.codec },
        `Video codec "${track.codec}" is not supported. Re-encode as H.264 (avc1) in an MP4 container.`
      )
    }
  }
  for (const track of info.audioTracks ?? []) {
    if (!codecAllowed(track.codec, audioCodecs)) {
      throw new AssetValidationError(
        "video.audioCodec",
        { codec: track.codec },
        `Audio codec "${track.codec}" is not supported. Re-encode the audio as AAC (mp4a).`
      )
    }
  }
}

/** mp4box codec strings are prefixed, e.g. "avc1.4d4028" / "mp4a.40.2". */
function codecAllowed(codec: string | undefined, allowed: readonly string[]): boolean {
  const c = (codec ?? "").toLowerCase()
  return allowed.some((a) => c.startsWith(a))
}

/** Feed the file to mp4box in chunks until it reports the moov box (or fails). */
function probeMp4(tmpPath: string): Promise<Movie | null> {
  return new Promise((resolve) => {
    const mp4 = createFile()
    let settled = false
    const finish = (value: Movie | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }

    mp4.onError = () => finish(null)
    mp4.onReady = (info) => finish(info)

    void (async () => {
      let fh
      try {
        fh = await open(tmpPath, "r")
        const CHUNK = 1 << 20
        const buf = Buffer.alloc(CHUNK)
        let pos = 0
        while (!settled) {
          const { bytesRead } = await fh.read(buf, 0, CHUNK, pos)
          if (bytesRead === 0) break
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead)
          mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos))
          pos += bytesRead
        }
        mp4.flush()
      } catch {
        // resolved as null below
      } finally {
        await fh?.close()
      }
      // No moov box after the whole file, or a read error.
      finish(null)
    })()
  })
}
