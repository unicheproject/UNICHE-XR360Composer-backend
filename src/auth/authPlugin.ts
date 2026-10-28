import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { verifyToken, AuthError } from "./keycloak.js"
import { pool } from "../db/pool.js"
import type { AuthUser } from "../types/api.js"
import { resolveAuthorization, type ResolvedAuthorization } from "../services/catalogueAuth.js"

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser
    /** The verified bearer token, forwarded verbatim on user-driven Catalogue calls. */
    bearerToken: string
    /**
     * The caller's resolved Catalogue authorization, or null when the Catalogue is
     * disabled/unreachable. Populated only by `authenticateWithCatalogue`.
     */
    catalogueAuth: ResolvedAuthorization | null
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateWithCatalogue: Array<(req: FastifyRequest, reply: FastifyReply) => Promise<void>>
  }
}

/**
 * Adds two preHandlers:
 *
 *   - `authenticate` — verifies the bearer token, attaches `req.user` +
 *     `req.bearerToken`, and upserts the user row.
 *   - `authenticateWithCatalogue` — the above, then resolves the caller's
 *     Catalogue authorization (per-`sub` cached).
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("user")
  app.decorateRequest("bearerToken", "")
  app.decorateRequest("catalogueAuth", null)

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing bearer token" })
    }

    const token = header.slice("Bearer ".length)
    try {
      req.user = await verifyToken(token)
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Authentication failed"
      return reply.code(401).send({ error: message })
    }
    req.bearerToken = token

    await pool.query(
      `INSERT INTO users (sub, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (sub) DO UPDATE
         SET email = EXCLUDED.email,
             display_name = COALESCE(EXCLUDED.display_name, users.display_name)`,
      [req.user.sub, req.user.email, req.user.name ?? null]
    )
  }

  // Never fatal: resolveAuthorization returns null on failure (local-only authz).
  const resolveCatalogue = async (req: FastifyRequest) => {
    req.catalogueAuth = await resolveAuthorization(req.user, req.bearerToken)
  }

  app.decorate("authenticate", authenticate)
  app.decorate("authenticateWithCatalogue", [authenticate, resolveCatalogue])
}
