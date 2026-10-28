/** Minimal structural response type — matches both node's ServerResponse and @fastify/static's SetHeadersResponse. */
interface HeaderSettable {
  setHeader(name: string, value: string): unknown
}

/**
 * Sets Content-Encoding and Content-Type for precompressed Unity WebGL files
 * (.br / .gz). Uses `no-store` because a 304 would replay cached headers without
 * this stamp.
 */
export function stampCompressedHeaders(res: HeaderSettable, filePath: string): void {
  if (filePath.endsWith(".br")) {
    res.setHeader("Content-Encoding", "br")
    res.setHeader("Cache-Control", "no-store")
    if (filePath.endsWith(".js.br")) {
      res.setHeader("Content-Type", "application/javascript")
    } else if (filePath.endsWith(".wasm.br")) {
      res.setHeader("Content-Type", "application/wasm")
    } else {
      res.setHeader("Content-Type", "application/octet-stream")
    }
  } else if (filePath.endsWith(".gz")) {
    res.setHeader("Content-Encoding", "gzip")
    res.setHeader("Cache-Control", "no-store")
    if (filePath.endsWith(".js.gz")) {
      res.setHeader("Content-Type", "application/javascript")
    } else if (filePath.endsWith(".wasm.gz")) {
      res.setHeader("Content-Type", "application/wasm")
    } else {
      res.setHeader("Content-Type", "application/octet-stream")
    }
  }
}
