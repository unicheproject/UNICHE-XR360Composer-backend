import type { ByteRange } from "./types.js"

/**
 * Single-range HTTP Range parser.
 *
 * `null` = serve the whole body (no header, or an unsupported one, including
 * multi-range requests, as RFC 9110 permits).
 * `"unsatisfiable"` = no satisfiable bytes; respond 416.
 */
export type RangeParse = ByteRange | null | "unsatisfiable"

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

export function parseRangeHeader(header: string | undefined, size: number): RangeParse {
  if (!header) return null

  const match = SINGLE_RANGE.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") return null

  let start: number
  let end: number

  if (rawStart === "") {
    // Suffix range: `bytes=-500` means the last 500 bytes.
    const suffixLength = Number(rawEnd)
    if (suffixLength === 0) return "unsatisfiable"
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (start > end || start >= size) return "unsatisfiable"
  return { start, end }
}
