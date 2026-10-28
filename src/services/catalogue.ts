import { config } from "../config.js"
import { getSvcToken } from "./svcToken.js"

/**
 * HTTP transport for the Catalogue API (orgs, projects, tools, membership,
 * invitations). Two token modes:
 *   - user-driven calls forward the caller's bearer token verbatim (`userGet`);
 *   - service-driven calls use the client_credentials token (`svcGet`), which
 *     yields null when no svc secret is configured.
 *
 * Any non-2xx response becomes a CatalogueError. `role`/`status` are free-form
 * strings.
 */

export interface ProjectMembership {
  projectId: string
  orgId: string
  role: string
}

export interface MeAuthorization {
  subject: string
  platformAdmin: boolean
  managedOrganisations: string[]
  projectMemberships: ProjectMembership[]
  etag: string | null
  ttlSeconds: number
}

export interface ToolRef {
  id: string
  slug: string
  name: string
  category?: string
  baseUrl?: string
  runtimeApiUrl?: string
  status?: string
}

export interface Project {
  id: string
  orgId: string
  name: string
  slug: string
  status: string
  tool: ToolRef | null
  hasImage?: boolean
}

export interface AccessDecision {
  allowed: boolean
  reason: string
}

/**
 * A project collaborator invitation, owned by the Catalogue. `role` is set by the
 * Catalogue (`curator`). `token` is returned only on issue and is not forwarded
 * to clients.
 */
export interface Invitation {
  id: string
  projectId: string
  email: string
  role: string
  status: string
  expiresAt: string
  token?: string
}

/** An invitation as the issuer's project list / the recipient's inbox sees it. */
export interface InvitationSummary {
  id: string
  projectId: string
  projectName: string
  orgId: string
  orgName: string
  email: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
}

export interface AcceptedInvitation {
  projectId: string
  projectName: string
  orgId: string
  role: string
}

export class CatalogueError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = "CatalogueError"
  }
}

function base(): string {
  const url = config.catalogue.internalUrl
  if (!url) throw new CatalogueError(0, "Catalogue URL is not configured")
  return url
}

function userGet(
  path: string,
  userToken: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    headers: { Authorization: `Bearer ${userToken}`, ...headers },
  })
}

/** User-driven write. `body` is omitted for the bodyless POSTs (accept-by-id). */
function userPost(path: string, userToken: string, body?: unknown): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Service-driven GET. Null when the svc client is unconfigured (degrade). */
async function svcGet(path: string): Promise<Response | null> {
  const svc = await getSvcToken()
  if (!svc) return null
  return fetch(`${base()}${path}`, { headers: { Authorization: `Bearer ${svc}` } })
}

/** Decode a 2xx body, or throw CatalogueError. `notFound` maps 404 → null. */
async function json<T>(res: Response, label: string, notFound = false): Promise<T | null> {
  if (notFound && res.status === 404) return null
  if (!res.ok) throw new CatalogueError(res.status, `${label} failed: ${res.status}`)
  return (await res.json()) as T
}

/**
 * GET /api/v1/me/authorization — the authorization source of truth for a user.
 * Sends `If-None-Match` when an etag is supplied; **null means "not modified"**,
 * so the caller keeps its cached copy. The returned etag prefers the response
 * header, falling back to the body field.
 */
export async function getMyAuthorization(
  userToken: string,
  etag?: string | null
): Promise<MeAuthorization | null> {
  const res = await userGet(
    "/api/v1/me/authorization",
    userToken,
    etag ? { "If-None-Match": etag } : {}
  )
  if (res.status === 304) return null
  const body = (await json<Omit<MeAuthorization, "etag"> & { etag?: string | null }>(
    res,
    "me/authorization"
  ))!
  return { ...body, etag: res.headers.get("etag") ?? body.etag ?? null }
}

/** GET /api/v1/projects/{id} — null on 404 (project gone / not visible). */
export async function getProject(projectId: string, userToken: string): Promise<Project | null> {
  return json<Project>(await userGet(`/api/v1/projects/${projectId}`, userToken), "getProject", true)
}

/** GET /api/v1/organisations/{orgId}/projects. */
export async function listProjects(orgId: string, userToken: string): Promise<Project[]> {
  const res = await userGet(`/api/v1/organisations/${orgId}/projects`, userToken)
  return (await json<Project[]>(res, "listProjects"))!
}

/**
 * GET /api/v1/tools/{slug} via the svc token. Null when svc is unconfigured or the
 * tool is unregistered.
 */
export async function getToolBySvc(slug: string): Promise<ToolRef | null> {
  const res = await svcGet(`/api/v1/tools/${encodeURIComponent(slug)}`)
  return res ? json<ToolRef>(res, "getTool", true) : null
}

/**
 * GET /api/v1/projects/{id}/access?subject= via the svc token, for authorizing a
 * subject without a user token. Null when the svc client is not configured.
 */
export async function checkAccess(
  projectId: string,
  subject: string
): Promise<AccessDecision | null> {
  const res = await svcGet(
    `/api/v1/projects/${projectId}/access?subject=${encodeURIComponent(subject)}`
  )
  return res ? json<AccessDecision>(res, "access check") : null
}

/**
 * POST /api/v1/projects/{id}/invitations — invite an email to a project. A
 * rejection throws a CatalogueError carrying the Catalogue's status.
 */
export async function issueInvitation(
  projectId: string,
  email: string,
  userToken: string
): Promise<Invitation> {
  const res = await userPost(`/api/v1/projects/${projectId}/invitations`, userToken, { email })
  return (await json<Invitation>(res, "issueInvitation"))!
}

/** GET /api/v1/projects/{id}/invitations — the issuer's view (manager+). */
export async function listProjectInvitations(
  projectId: string,
  userToken: string
): Promise<InvitationSummary[]> {
  const res = await userGet(`/api/v1/projects/${projectId}/invitations`, userToken)
  return (await json<InvitationSummary[]>(res, "listProjectInvitations"))!
}

/** GET /api/v1/invitations — invitations addressed to the caller's own email. */
export async function listMyInvitations(userToken: string): Promise<InvitationSummary[]> {
  const res = await userGet("/api/v1/invitations", userToken)
  return (await json<InvitationSummary[]>(res, "listMyInvitations"))!
}

/**
 * POST /api/v1/invitations/{id}/accept — accept an invitation addressed to the
 * caller's email; the Catalogue creates the project membership.
 */
export async function acceptInvitation(
  invitationId: string,
  userToken: string
): Promise<AcceptedInvitation> {
  const res = await userPost(`/api/v1/invitations/${invitationId}/accept`, userToken)
  return (await json<AcceptedInvitation>(res, "acceptInvitation"))!
}
