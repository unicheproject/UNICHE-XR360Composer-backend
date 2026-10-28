import { existsSync } from "node:fs"
import path from "node:path"
import fastifyStatic from "@fastify/static"
import type { FastifyInstance } from "fastify"
import { config } from "../config.js"
import { stampCompressedHeaders } from "../static/brotli.js"

/**
 * Serves the composer SPA build (including the WebGL player under /unity).
 * Unknown non-API GETs fall back to index.html for client-side routing.
 */
export function registerStaticRoutes(app: FastifyInstance): void {
  const root = path.resolve(config.composerDist)
  if (!existsSync(path.join(root, "index.html"))) {
    app.log.warn(`[static] No composer build at ${root} — running API-only`)
    return
  }

  app.register(fastifyStatic, {
    root,
    // Off: a 304 on a .br file would skip the Content-Encoding header stamp.
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => stampCompressedHeaders(res, filePath),
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/") || req.method !== "GET") {
      return reply.code(404).send({ error: "Not found" })
    }
    return reply.sendFile("index.html")
  })

  app.log.info(`[static] Serving composer from ${root}`)
}
