import type { FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { config } from "../config.js"

/** Parse with Zod; reply 400 and return undefined on failure. */
export function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  reply: FastifyReply
): z.infer<S> | undefined {
  const result = schema.safeParse(value)
  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error.flatten() })
    return undefined
  }
  return result.data
}

/**
 * Gate for Catalogue-backed routes: 404 when no Catalogue is configured, 503
 * when it is configured but `req.catalogueAuth` could not be resolved.
 * Returns false after replying.
 */
export function requireCatalogue(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.catalogue.enabled) {
    reply.code(404).send({ error: "Catalogue integration is not enabled" })
    return false
  }
  if (!req.catalogueAuth) {
    reply.code(503).send({ error: "The project directory is unavailable — try again shortly" })
    return false
  }
  return true
}
