/**
 * An uploaded file of an allowed type violates a per-type content budget (HTTP 422).
 * `code` and `details` identify a client-side localized message; `message` is the
 * English fallback.
 */
export class AssetValidationError extends Error {
  readonly statusCode = 422

  constructor(
    readonly code: string,
    readonly details: Record<string, unknown>,
    message: string
  ) {
    super(message)
  }
}
