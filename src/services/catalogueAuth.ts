import { config } from "../config.js"
import type { AuthUser } from "../types/api.js"
import { getMyAuthorization, getProject, listProjects, type MeAuthorization } from "./catalogue.js"
import { maxRole, type ProjectGrant } from "./roles.js"

/**
 * Resolves a user's Catalogue authorization into per-project local roles, cached
 * per `sub` honoring the Catalogue's `ttlSeconds` and ETag. Resolves to `null`
 * when the Catalogue is disabled or unreachable (owner-only authorization).
 */

export interface ResolvedAuthorization {
  /** Platform admins get an editor baseline on every project. */
  platformAdmin: boolean
  /** projectId → the local role Catalogue membership/management grants. */
  projectRoles: Map<string, ProjectGrant>
  /** Orgs the user manages. */
  managedOrgs: Set<string>
}

export interface AuthorableProject {
  projectId: string
  orgId: string
  name: string
  role: ProjectGrant
  /** Whether the caller may invite collaborators (advisory; the Catalogue enforces it). */
  canInvite: boolean
}

/**
 * Catalogue project-role string → local grant, capped at `editor`. Unknown
 * strings warn once and map to `viewer`.
 */
const ROLE_MAP: Record<string, ProjectGrant> = {
  owner: "editor",
  manager: "editor",
  admin: "editor",
  editor: "editor",
  contributor: "editor",
  // The role every invitation grants; curators author and publish.
  curator: "editor",
  member: "viewer",
  viewer: "viewer",
  reader: "viewer",
  guest: "viewer",
}
const warnedRoles = new Set<string>()

function mapRole(role: string): ProjectGrant {
  const key = role.toLowerCase()
  const mapped = ROLE_MAP[key]
  if (mapped) return mapped
  if (!warnedRoles.has(key)) {
    console.warn(
      `[catalogue] unknown project role "${role}" — defaulting to viewer. ` +
        `Update ROLE_MAP in services/catalogueAuth.ts.`
    )
    warnedRoles.add(key)
  }
  return "viewer"
}

interface CacheEntry {
  value: ResolvedAuthorization
  etag: string | null
  ttlMs: number
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
// Coalesces concurrent cold-cache resolves for the same subject into one request.
const inflight = new Map<string, Promise<ResolvedAuthorization | null>>()
const MAX_CACHED_SUBJECTS = 1000

function grant(roles: Map<string, ProjectGrant>, projectId: string, next: ProjectGrant): void {
  roles.set(projectId, maxRole(roles.get(projectId), next)!)
}

async function build(auth: MeAuthorization, token: string): Promise<ResolvedAuthorization> {
  const projectRoles = new Map<string, ProjectGrant>()
  for (const m of auth.projectMemberships) {
    grant(projectRoles, m.projectId, mapRole(m.role))
  }
  // Org managers get editor on every project of a managed org, member or not.
  const managed = await Promise.all(
    auth.managedOrganisations.map(async (orgId) => {
      try {
        return await listProjects(orgId, token)
      } catch (err) {
        console.error(`[catalogue] listProjects(${orgId}) failed:`, err)
        return []
      }
    })
  )
  for (const project of managed.flat()) {
    grant(projectRoles, project.id, "editor")
  }
  return {
    platformAdmin: auth.platformAdmin,
    projectRoles,
    managedOrgs: new Set(auth.managedOrganisations),
  }
}

/** Drop expired entries once the map grows past its cap (no background sweeper). */
function evictExpired(now: number): void {
  if (cache.size <= MAX_CACHED_SUBJECTS) return
  for (const [sub, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(sub)
  }
}

async function resolveUncached(
  sub: string,
  token: string,
  cached: CacheEntry | undefined
): Promise<ResolvedAuthorization | null> {
  const now = Date.now()
  try {
    const auth = await getMyAuthorization(token, cached?.etag)
    // null = 304 Not Modified: re-arm the cached entry's TTL.
    if (!auth) {
      if (cached) cached.expiresAt = now + cached.ttlMs
      return cached?.value ?? null
    }
    const value = await build(auth, token)
    const ttlMs = Math.max(1, auth.ttlSeconds) * 1000
    evictExpired(now)
    cache.set(sub, { value, etag: auth.etag, ttlMs, expiresAt: now + ttlMs })
    return value
  } catch (err) {
    // Falls back to a stale copy, else null.
    console.error("[catalogue] authorization resolve failed:", err)
    return cached?.value ?? null
  }
}

export async function resolveAuthorization(
  user: AuthUser,
  token: string
): Promise<ResolvedAuthorization | null> {
  if (!config.catalogue.enabled) return null

  const cached = cache.get(user.sub)
  if (cached && Date.now() < cached.expiresAt) return cached.value

  const pending = inflight.get(user.sub)
  if (pending) return pending

  const promise = resolveUncached(user.sub, token, cached).finally(() => inflight.delete(user.sub))
  inflight.set(user.sub, promise)
  return promise
}

/**
 * Drops a subject's cached authorization (e.g. after accepting an invitation).
 * The entry is deleted rather than expired so the refetch carries no ETag, which
 * could otherwise be answered with a 304 and re-arm stale membership.
 */
export function invalidateAuthorization(sub: string): void {
  cache.delete(sub)
}

/** The local role Catalogue authorization grants for a project, or null. */
export function catalogueProjectRole(
  auth: ResolvedAuthorization,
  projectId: string
): ProjectGrant | null {
  if (auth.platformAdmin) return "editor"
  return auth.projectRoles.get(projectId) ?? null
}

/**
 * Whether the caller may issue invitations in this org (manager-of-org or platform
 * admin). Advisory only; the Catalogue enforces it.
 */
export function canInviteTo(auth: ResolvedAuthorization, orgId: string): boolean {
  return auth.platformAdmin || auth.managedOrgs.has(orgId)
}

/**
 * The caller's Catalogue-accessible projects that belong to this tool. Issues one
 * Catalogue request per project, in parallel.
 */
export async function listAuthorableProjects(
  auth: ResolvedAuthorization,
  token: string
): Promise<AuthorableProject[]> {
  const resolved = await Promise.all(
    [...auth.projectRoles.keys()].map(async (id) => {
      try {
        return await getProject(id, token)
      } catch (err) {
        console.error(`[catalogue] getProject(${id}) failed:`, err)
        return null
      }
    })
  )
  return resolved
    .filter((p): p is NonNullable<typeof p> => !!p && p.tool?.slug === config.pid.tool)
    .map((p) => ({
      projectId: p.id,
      orgId: p.orgId,
      name: p.name,
      role: catalogueProjectRole(auth, p.id) ?? "viewer",
      canInvite: canInviteTo(auth, p.orgId),
    }))
}

/**
 * The orgs whose templates the caller may see: orgs of their authorable projects
 * plus every org they manage.
 */
export async function listAuthorableOrgs(
  auth: ResolvedAuthorization,
  token: string
): Promise<Set<string>> {
  const projects = await listAuthorableProjects(auth, token)
  const orgs = new Set<string>(projects.map((p) => p.orgId))
  for (const orgId of auth.managedOrgs) orgs.add(orgId)
  return orgs
}
