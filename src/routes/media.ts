import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Readable } from "node:stream"
import { z } from "zod"
import type { MediaUploadRow } from "../db/schema.js"
import { storeUpload, getMedia, resolveDownload, MediaTooLargeError } from "../services/mediaService.js"
import { AssetValidationError } from "../services/assetValidation.js"
import {
  abortUpload,
  completeUpload,
  describeSession,
  getSession,
  initUpload,
  recordPart,
  UploadError,
} from "../services/uploadService.js"
import { isAllowedUpload } from "../schemas/media.js"
import { initUploadBody, partParams, uploadIdParam } from "../schemas/upload.js"
import { parseRangeHeader } from "../storage/range.js"
import type { DownloadResult } from "../storage/types.js"
import { parse } from "./parse.js"

const hashParam = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) })

export function registerMediaRoutes(app: FastifyInstance): void {
  /** Single-shot multipart upload, for small files. */
  app.post(
    "/api/media",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const file = await req.file()
      if (!file) return reply.code(400).send({ error: "No file provided" })

      const verdict = isAllowedUpload(file.mimetype, file.filename)
      if (!verdict.ok) {
        return reply.code(415).send({ error: verdict.reason })
      }

      try {
        const result = await storeUpload(file.file, verdict.mime, file.filename, req.user)
        reply.code(201)
        return result
      } catch (err) {
        return uploadFailure(reply, err)
      }
    }
  )

  // --- Chunked upload ---

  app.post("/api/media/uploads", { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(initUploadBody, req.body, reply)
    if (!body) return

    try {
      const result = await initUpload(req.user, body)
      reply.code(201)
      return result
    } catch (err) {
      return uploadFailure(reply, err)
    }
  })

  /** Session state for resuming: which parts have been received. */
  app.get("/api/media/uploads/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const found = await resolveSession(req, reply, uploadIdParam)
    if (!found) return reply

    return describeSession(found.session)
  })

  /** Raw `application/octet-stream` part body, received as an unbuffered stream. */
  app.put("/api/media/uploads/:id/parts/:partNo", { preHandler: app.authenticate }, async (req, reply) => {
    const found = await resolveSession(req, reply, partParams)
    if (!found) return reply

    try {
      await recordPart(found.session, found.params.partNo, req.body as Readable)
      return reply.code(204).send()
    } catch (err) {
      return uploadFailure(reply, err)
    }
  })

  app.post("/api/media/uploads/:id/complete", { preHandler: app.authenticate }, async (req, reply) => {
    const found = await resolveSession(req, reply, uploadIdParam)
    if (!found) return reply

    try {
      const result = await completeUpload(found.session, req.user)
      reply.code(201)
      return result
    } catch (err) {
      return uploadFailure(reply, err)
    }
  })

  app.delete("/api/media/uploads/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const found = await resolveSession(req, reply, uploadIdParam)
    if (!found) return reply

    await abortUpload(found.session)
    return reply.code(204).send()
  })

  /**
   * Stable media URL stored in experience JSON. The s3 driver redirects to a
   * fresh presigned URL; the local driver streams the bytes and answers Range.
   *
   * Unauthenticated: the sha256 path is an unguessable capability token, and
   * Unity's WebGL VideoPlayer cannot send auth headers.
   */
  app.get("/api/media/:hash", async (req, reply) => {
    const params = parse(hashParam, req.params, reply)
    if (!params) return

    const media = await getMedia(params.hash)
    if (!media) return reply.code(404).send({ error: "Media not found" })

    const size = Number(media.size)
    const range = parseRangeHeader(req.headers.range, size)
    if (range === "unsatisfiable") {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send()
    }

    const result = await resolveDownload(media, range)
    if (!result) return reply.code(404).send({ error: "Media not found" })

    return sendDownload(reply, result)
  })
}

/**
 * Validates the path params and loads the caller's upload session. Returns null
 * after replying; another user's session is a 404, not a 403.
 */
async function resolveSession<T extends z.ZodType<{ id: string }>>(
  req: FastifyRequest,
  reply: FastifyReply,
  schema: T
): Promise<{ params: z.infer<T>; session: MediaUploadRow } | null> {
  const params = parse(schema, req.params, reply)
  if (!params) return null

  const session = await getSession(params.id, req.user)
  if (!session) {
    reply.code(404).send({ error: "Upload session not found" })
    return null
  }

  return { params, session }
}

function uploadFailure(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof MediaTooLargeError) return reply.code(413).send({ error: err.message })
  // 422: over a content budget. `code`/`details` allow a localized message; `error` is the English fallback.
  if (err instanceof AssetValidationError) {
    return reply.code(422).send({ error: err.message, code: err.code, details: err.details })
  }
  if (err instanceof UploadError) return reply.code(err.statusCode).send({ error: err.message })
  throw err
}

function sendDownload(reply: FastifyReply, result: DownloadResult): FastifyReply {
  if (result.kind === "redirect") {
    // The client re-issues its Range request against the presigned URL.
    return reply.redirect(result.url, 302)
  }

  reply.header("Accept-Ranges", "bytes").header("Content-Type", result.mime)

  if (result.range) {
    const { start, end } = result.range
    reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${end}/${result.totalSize}`)
      .header("Content-Length", end - start + 1)
  } else {
    reply.header("Content-Length", result.totalSize)
  }

  return reply.send(result.stream)
}
