import type { FastifyReply, FastifyRequest } from "fastify"
import * as exp from "../services/experienceService.js"

/**
 * Sends the published revision of `id`: 404 if never published, 304 when
 * If-None-Match matches the strong revision ETag, else the
 * PublishedExperienceResponse. Callers handle id parsing and auth first.
 */
export async function sendPublished(req: FastifyRequest, reply: FastifyReply, id: string) {
  const pub = await exp.getPublished(id)
  if (!pub) return reply.code(404).send({ error: "Experience has never been published" })
  const etag = `"${id}@${pub.major}"`
  reply.header("etag", etag)
  if (req.headers["if-none-match"] === etag) return reply.code(304).send()
  return exp.toPublishedResponse(id, pub)
}
