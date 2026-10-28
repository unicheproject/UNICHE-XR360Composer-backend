import type { FastifyInstance } from "fastify"
import * as exp from "../services/experienceService.js"
import { idParam } from "../schemas/experience.zod.js"
import { parse } from "./parse.js"
import { sendPublished } from "./publishedReply.js"

/**
 * Anonymous runtime API for device clients, which have no Keycloak identity.
 * Only published experiences are exposed; the media they reference is served
 * by unguessable /api/media/<hash> URLs.
 */
export function registerRuntimeRoutes(app: FastifyInstance): void {
  app.get("/api/v1/experiences", async () => {
    return exp.listPublished()
  })

  app.get("/api/v1/experiences/:id", async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    return sendPublished(req, reply, params.id)
  })
}
