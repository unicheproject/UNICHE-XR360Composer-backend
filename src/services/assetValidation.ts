import { classifyAsset } from "../schemas/media.js"
import { validateImage } from "./assetValidators/imageValidator.js"
import { validateModel } from "./assetValidators/modelValidator.js"
import { validateVideo } from "./assetValidators/videoValidator.js"

export { AssetValidationError } from "./assetValidationError.js"

/**
 * Content gate on a fully-spooled upload. Throws AssetValidationError (422) when
 * the file exceeds a per-type content budget; unrecognised categories pass.
 */
export async function validateAsset(
  tmpPath: string,
  mime: string,
  filename: string
): Promise<void> {
  switch (classifyAsset(mime, filename)) {
    case "image":
      return validateImage(tmpPath)
    case "video":
      return validateVideo(tmpPath)
    case "model":
      return validateModel(tmpPath, filename)
    default:
      return
  }
}
