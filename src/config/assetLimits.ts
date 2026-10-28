/**
 * Per-asset-type content budgets enforced at upload time, in addition to the
 * upload type gate and the MEDIA_MAX_BYTES byte cap. One set of limits covers
 * every playback target (Quest 3, Pico 4, WebGL).
 */
export const assetLimits = {
  image: {
    /** Max texture edge the Quest 3 / Pico 4 (Adreno) GPUs sample without downscaling. */
    maxWidth: 8192,
    maxHeight: 8192,
  },
  model: {
    /** Triangle budget for one imported model on the mobile XR2 GPUs. */
    maxTriangles: 100_000,
    /**
     * Distinct material textures. Only the count is checked: embedded-texture
     * dimensions are not exposed by the Assimp JSON export.
     */
    maxTextures: 8,
  },
  video: {
    /**
     * Accepted MP4 brands. MP4 / H.264 / AAC is the only combination every
     * target decodes, including the browser <video> element used on WebGL.
     */
    mp4Brands: ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "cmfc", "mmp4"],
    /** H.264 only (avc1); H.265 is not reliably decoded by browsers. */
    videoCodecs: ["avc1"],
    /** AAC only (mp4a). Checked only when the file carries an audio track. */
    audioCodecs: ["mp4a"],
  },
} as const

export type AssetLimits = typeof assetLimits
