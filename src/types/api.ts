import type { ExperienceData } from "./experience.js"

export type Role = "owner" | "editor" | "viewer"

export interface AuthUser {
  sub: string
  email: string
  name?: string
}

export interface LockInfo {
  lockedBy: string | null
  lockedByEmail: string | null
  lockedAt: string | null
  expiresAt: string | null
}

export interface ExperienceSummary {
  id: string
  // Platform identifiers. `id` is the raw UUID used in URLs; `revision` is the
  // published major, null (with no versioned PID) when never published.
  pid: string
  experiencePid: string | null
  projectId: string
  tool: string
  revision: number | null
  title: string
  ownerEmail: string
  role: Role
  major: number
  minor: number
  publishedMajor: number | null
  hasUncommittedChanges: boolean
  updatedAt: string
  lock: LockInfo
}

export interface ExperienceDetail extends ExperienceSummary {
  experience: ExperienceData
}

/** GET /api/templates — a library row, without its (heavy) content blob. */
export interface TemplateSummary {
  id: string
  orgId: string
  title: string
  description: string | null
  createdBy: string
  createdByEmail: string | null
  createdAt: string
}

export interface VersionSummary {
  major: number
  minor: number
  kind: "commit" | "publish"
  authorEmail: string | null
  note: string | null
  createdAt: string
}

/**
 * GET /api/experiences/:id/published. Field names are snake_case by external
 * contract; do not camelCase.
 */
export interface PublishedExperienceResponse {
  experience_pid: string
  project_id: string
  tool: string
  revision: number
  content: ExperienceData
}

/**
 * GET /api/v1/experiences list item (anonymous). Carries no owner, lock, role,
 * or draft data; only published experiences appear, so experiencePid and
 * revision are always present.
 */
export interface RuntimeExperienceSummary {
  id: string
  experiencePid: string
  projectId: string
  tool: string
  revision: number
  title: string
}

export interface MediaUploadResult {
  hash: string
  url: string
  mime: string
  size: number
}

/** POST /api/media/uploads — the server's terms for the session. */
export interface UploadInitResult {
  uploadId: string
  partSize: number
  totalParts: number
  expiresAt: string
}

/** GET /api/media/uploads/:id: session state including the parts already received. */
export interface UploadSessionInfo extends UploadInitResult {
  size: number
  receivedParts: number[]
}
