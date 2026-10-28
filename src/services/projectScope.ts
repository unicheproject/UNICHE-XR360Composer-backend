import type { FastifyReply } from "fastify"
import { config } from "../config.js"
import { catalogueProjectRole, type ResolvedAuthorization } from "./catalogueAuth.js"

/**
 * Project scoping for experiences, including the legacy `"default"` project used
 * when no Catalogue is configured.
 */

/** True for the legacy `"default"` project, which is authorized owner-only. */
export function isLegacyScope(projectId: string): boolean {
  return projectId === config.pid.defaultProject
}

export type CreateScope =
  | { projectId: string }
  | { deny: "missing-project" | "not-author" | "unavailable" }

/**
 * Which project a create lands in.
 *   - Catalogue off  → the legacy default scope, no project needed.
 *   - Catalogue on   → a real project the caller can author in (editor).
 *   - Catalogue on but unreachable (`auth` null) → `unavailable`; never falls
 *     back to the default scope.
 */
export function resolveCreateScope(
  auth: ResolvedAuthorization | null,
  requestedProjectId: string | undefined
): CreateScope {
  if (!config.catalogue.enabled) return { projectId: config.pid.defaultProject }
  if (!auth) return { deny: "unavailable" }
  if (!requestedProjectId) return { deny: "missing-project" }
  if (catalogueProjectRole(auth, requestedProjectId) !== "editor") return { deny: "not-author" }
  return { projectId: requestedProjectId }
}

/**
 * Reply for a denied `CreateScope`. `action` is the verb for the
 * "missing-project" message only ("create" vs "duplicate" an experience) —
 * the other two denials are worded the same regardless of caller.
 */
export function sendScopeDenial(
  reply: FastifyReply,
  scope: Extract<CreateScope, { deny: string }>,
  action: string
): FastifyReply {
  const denial = {
    "missing-project": [400, `A projectId is required to ${action} an experience`],
    "not-author": [403, "You cannot create experiences in this project"],
    unavailable: [503, "The project directory is unavailable — try again shortly"],
  } as const
  const [code, error] = denial[scope.deny]
  return reply.code(code).send({ error })
}
