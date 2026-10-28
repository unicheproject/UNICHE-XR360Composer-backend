import { imageSizeFromFile } from "image-size/fromFile"
import { assetLimits } from "../../config/assetLimits.js"
import { AssetValidationError } from "../assetValidationError.js"

/** Rejects images larger than the configured texture dimensions (header-only read). */
export async function validateImage(tmpPath: string): Promise<void> {
  const { maxWidth, maxHeight } = assetLimits.image

  let width: number | undefined
  let height: number | undefined
  try {
    ;({ width, height } = await imageSizeFromFile(tmpPath))
  } catch {
    throw new AssetValidationError(
      "image.unreadable",
      {},
      "Could not read the image; the file may be corrupt or an unsupported image format."
    )
  }

  if (width === undefined || height === undefined) {
    throw new AssetValidationError(
      "image.unreadable",
      {},
      "Could not determine the image dimensions."
    )
  }

  if (width > maxWidth || height > maxHeight) {
    throw new AssetValidationError(
      "image.dimensions",
      { width, height, maxWidth, maxHeight },
      `Image is ${width}x${height}px; the maximum is ${maxWidth}x${maxHeight}px. Resize or re-export it to fit within ${maxWidth}x${maxHeight}px.`
    )
  }
}
