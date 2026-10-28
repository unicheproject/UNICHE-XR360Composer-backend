import type { FastifyInstance, FastifyReply } from "fastify"
import { config } from "../config.js"
import { CatalogueError } from "../services/catalogue.js"
import * as catalogue from "../services/catalogue.js"
import { invalidateAuthorization, listAuthorableProjects } from "../services/catalogueAuth.js"
import { inviteBody, invitationIdParam, projectIdParam } from "../schemas/catalogue.zod.js"
import { parse, requireCatalogue } from "./parse.js"

/**
 * Backend proxy for the browser's Catalogue calls; the Catalogue URL stays
 * server-side and user calls forward the caller's bearer token. Invitations and
 * memberships are created in the Catalogue; this backend stores neither.
 */
export function registerCatalogueRoutes(app: FastifyInstance): void {
  const auth = { preHandler: app.authenticateWithCatalogue }

  /**
   * Forward a Catalogue 4xx verbatim; its 5xx and transport failures (status 0)
   * become 502.
   */
  function forwardCatalogueError(err: unknown, reply: FastifyReply): FastifyReply {
    if (!(err instanceof CatalogueError)) throw err
    reply.log.warn({ status: err.status }, `[catalogue] ${err.message}`)
    const status = err.status >= 400 && err.status < 500 ? err.status : 502
    return reply.code(status).send({ error: err.message })
  }

  /**
   * Projects the caller may author experiences in.
   *   - `enabled: false` → no Catalogue configured; projectless create is allowed.
   *   - `degraded: true` → Catalogue configured but unreachable; create answers 503.
   *   - otherwise        → the project list (may be empty).
   */
  app.get("/api/catalogue/projects", auth, async (req) => {
    if (!config.catalogue.enabled) return { enabled: false, degraded: false, projects: [] }
    if (!req.catalogueAuth) return { enabled: true, degraded: true, projects: [] }
    return {
      enabled: true,
      degraded: false,
      projects: await listAuthorableProjects(req.catalogueAuth, req.bearerToken),
    }
  })

  // --- Invitations ---

  /**
   * Invite a collaborator to a project. Body is `{email}` only; the Catalogue
   * sets the role. The one-time invitation `token` is not forwarded to the browser.
   */
  app.post("/api/catalogue/projects/:projectId/invitations", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const params = parse(projectIdParam, req.params, reply)
    if (!params) return
    const body = parse(inviteBody, req.body, reply)
    if (!body) return

    try {
      const inv = await catalogue.issueInvitation(params.projectId, body.email, req.bearerToken)
      reply.code(201)
      return {
        id: inv.id,
        projectId: inv.projectId,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
      }
    } catch (err) {
      return forwardCatalogueError(err, reply)
    }
  })

  /** Invitations already issued for a project (manager-of-org or admin). */
  app.get("/api/catalogue/projects/:projectId/invitations", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const params = parse(projectIdParam, req.params, reply)
    if (!params) return
    try {
      return await catalogue.listProjectInvitations(params.projectId, req.bearerToken)
    } catch (err) {
      return forwardCatalogueError(err, reply)
    }
  })

  /** The caller's inbox: invitations addressed to their email. */
  app.get("/api/catalogue/invitations", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    try {
      return await catalogue.listMyInvitations(req.bearerToken)
    } catch (err) {
      return forwardCatalogueError(err, reply)
    }
  })

  /**
   * Accept an invitation; the Catalogue creates the membership. The caller's
   * cached authorization is invalidated before replying so the next request
   * sees the new membership.
   */
  app.post("/api/catalogue/invitations/:invitationId/accept", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const params = parse(invitationIdParam, req.params, reply)
    if (!params) return
    try {
      const accepted = await catalogue.acceptInvitation(params.invitationId, req.bearerToken)
      invalidateAuthorization(req.user.sub)
      return accepted
    } catch (err) {
      return forwardCatalogueError(err, reply)
    }
  })
}
