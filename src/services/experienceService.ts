import { pool, withTransaction } from "../db/pool.js"
import { toLockInfo } from "./lockService.js"
import { buildPid, buildVersionedPid } from "./pid.js"
import { composeRole } from "./authz.js"
import type { ResolvedAuthorization } from "./catalogueAuth.js"
import { config } from "../config.js"
import type {
  ExperienceRow,
  ExperienceRowWithMeta,
  ExperienceSummaryRow,
  ExperienceVersionRow,
} from "../db/schema.js"
import type { ExperienceData } from "../types/experience.js"
import type {
  AuthUser,
  ExperienceSummary,
  PublishedExperienceResponse,
  Role,
  RuntimeExperienceSummary,
  VersionSummary,
} from "../types/api.js"

function blankExperience(title: string): ExperienceData {
  return {
    version: "1.0",
    title,
    startEnvironmentId: "environment_1",
    environments: [
      {
        id: "environment_1",
        type: "Video360",
        assetPath: "",
        startRotationY: 0,
        elements: [],
      },
    ],
  }
}

/**
 * Summary row with the newest version's timestamp; absent or null means no
 * version exists, which counts as uncommitted.
 */
type SummaryRow = ExperienceSummaryRow & { latest_version_at?: Date | null }

function hasUncommittedChanges(row: SummaryRow): boolean {
  const latest = row.latest_version_at ?? null
  if (!latest) return true
  return row.draft_updated_at.getTime() > latest.getTime()
}

function toSummary(row: SummaryRow, role: Role): ExperienceSummary {
  const published = row.published_major !== null
  return {
    id: row.id,
    pid: buildPid(row.project_id, row.id),
    experiencePid: published
      ? buildVersionedPid(row.project_id, row.id, row.published_major as number)
      : null,
    projectId: row.project_id,
    tool: config.pid.tool,
    revision: row.published_major,
    title: row.title,
    ownerEmail: row.owner_email,
    role,
    major: row.major,
    minor: row.minor,
    publishedMajor: row.published_major,
    hasUncommittedChanges: hasUncommittedChanges(row),
    updatedAt: row.updated_at.toISOString(),
    lock: staleAwareLock(row),
  }
}

/** Present a stale lock as no lock — the DB row is only cleared lazily. */
function staleAwareLock(row: Pick<ExperienceRow, "locked_by" | "locked_by_email" | "locked_at">) {
  if (row.locked_at) {
    const ageMs = Date.now() - row.locked_at.getTime()
    if (ageMs > config.lockTtlMinutes * 60_000) {
      return toLockInfo({ locked_by: null, locked_by_email: null, locked_at: null })
    }
  }
  return toLockInfo(row)
}

/** Creates an experience at version (0, 0) with a draft and no version rows. */
export async function createExperience(
  user: AuthUser,
  title: string,
  projectId: string,
  initial?: ExperienceData
): Promise<ExperienceRow> {
  const json = initial ?? blankExperience(title)
  const { rows } = await pool.query<ExperienceRow>(
    `INSERT INTO experiences (project_id, owner_sub, owner_email, title, draft_json)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [projectId, user.sub, user.email, title, JSON.stringify(json)]
  )
  return rows[0]!
}

/**
 * Creates an independent, caller-owned experience from `source` (new id, empty
 * history, unpublished). `title` is written into the document too, since
 * `saveDraft` derives the row title from it.
 */
export async function duplicateExperience(
  user: AuthUser,
  source: ExperienceData,
  title: string,
  projectId: string
): Promise<ExperienceRow> {
  return createExperience(user, title, projectId, { ...source, title })
}

export async function listForUser(
  user: AuthUser,
  catalogueAuth: ResolvedAuthorization | null
): Promise<ExperienceSummary[]> {
  // Owned rows, rows in a Catalogue project of the caller, or all rows for a platform admin.
  const projectIds = catalogueAuth ? [...catalogueAuth.projectRoles.keys()] : []
  const platformAdmin = catalogueAuth?.platformAdmin ?? false

  // Columns enumerated to skip the large `draft_json`.
  const { rows } = await pool.query<ExperienceRowWithMeta>(
    `SELECT e.id, e.project_id, e.owner_sub, e.owner_email, e.title,
            e.major, e.minor, e.published_major, e.draft_updated_at,
            e.locked_by, e.locked_by_email, e.locked_at,
            e.created_at, e.updated_at,
            (SELECT max(v.created_at) FROM experience_versions v
              WHERE v.experience_id = e.id) AS latest_version_at
       FROM experiences e
      WHERE e.owner_sub = $1
         OR $2::boolean
         OR e.project_id = ANY($3::text[])
      ORDER BY e.updated_at DESC`,
    [user.sub, platformAdmin, projectIds]
  )

  const summaries: ExperienceSummary[] = []
  for (const row of rows) {
    const role = composeRole(row, user, catalogueAuth)
    if (role) summaries.push(toSummary(row, role))
  }
  return summaries
}

/**
 * Anonymous runtime list: every published experience across all projects,
 * unfiltered by user, without owner/lock/draft state.
 */
export async function listPublished(): Promise<RuntimeExperienceSummary[]> {
  const { rows } = await pool.query<{
    id: string
    project_id: string
    published_major: number
    title: string
  }>(
    `SELECT id, project_id, published_major, title
       FROM experiences
      WHERE published_major IS NOT NULL
      ORDER BY updated_at DESC`
  )
  return rows.map((row) => ({
    id: row.id,
    experiencePid: buildVersionedPid(row.project_id, row.id, row.published_major),
    projectId: row.project_id,
    tool: config.pid.tool,
    revision: row.published_major,
    title: row.title,
  }))
}

/** The newest version's timestamp, or null when nothing was ever committed. */
export async function latestVersionAt(experienceId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ latest_version_at: Date | null }>(
    `SELECT max(created_at) AS latest_version_at
       FROM experience_versions WHERE experience_id = $1`,
    [experienceId]
  )
  return rows[0]?.latest_version_at ?? null
}

/** Autosave: overwrite the working tree. Touches NO version row. */
export async function saveDraft(experienceId: string, json: ExperienceData): Promise<void> {
  await pool.query(
    `UPDATE experiences
        SET draft_json = $2,
            draft_updated_at = now(),
            title = COALESCE($3, title),
            updated_at = now()
      WHERE id = $1`,
    [experienceId, JSON.stringify(json), typeof json.title === "string" ? json.title : null]
  )
}

/**
 * Commit: snapshot the current draft as (major, minor + 1), under a row lock
 * (FOR UPDATE).
 */
export async function commitVersion(
  experienceId: string,
  user: AuthUser,
  note: string
): Promise<{ major: number; minor: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Pick<ExperienceRow, "major" | "minor" | "draft_json">>(
      `SELECT major, minor, draft_json FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId]
    )
    if (!rows[0]) throw new Error("Experience not found")
    const { major, minor, draft_json } = rows[0]

    await client.query(
      `INSERT INTO experience_versions (experience_id, major, minor, json_blob, author_sub, author_email, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [experienceId, major, minor + 1, JSON.stringify(draft_json), user.sub, user.email, note]
    )
    await client.query(
      `UPDATE experiences SET minor = minor + 1, updated_at = now() WHERE id = $1`,
      [experienceId]
    )
    return { major, minor: minor + 1 }
  })
}

/** Publish: snapshot the current draft as (major + 1, 0) and move the published pointer. */
export async function publishVersion(
  experienceId: string,
  user: AuthUser,
  note?: string
): Promise<{ major: number; minor: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Pick<ExperienceRow, "major" | "draft_json">>(
      `SELECT major, draft_json FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId]
    )
    if (!rows[0]) throw new Error("Experience not found")
    const newMajor = rows[0].major + 1

    await client.query(
      `INSERT INTO experience_versions (experience_id, major, minor, json_blob, author_sub, author_email, note)
       VALUES ($1, $2, 0, $3, $4, $5, $6)`,
      [experienceId, newMajor, JSON.stringify(rows[0].draft_json), user.sub, user.email, note ?? null]
    )
    await client.query(
      `UPDATE experiences
          SET major = $2, minor = 0, published_major = $2, updated_at = now()
        WHERE id = $1`,
      [experienceId, newMajor]
    )
    return { major: newMajor, minor: 0 }
  })
}

/** Version history, newest first; `kind` is "publish" when minor = 0. */
export async function listVersions(experienceId: string): Promise<VersionSummary[]> {
  const { rows } = await pool.query<ExperienceVersionRow>(
    `SELECT major, minor, author_email, note, created_at
       FROM experience_versions
      WHERE experience_id = $1
      ORDER BY major DESC, minor DESC`,
    [experienceId]
  )
  return rows.map((r) => ({
    major: r.major,
    minor: r.minor,
    kind: r.minor === 0 ? "publish" : "commit",
    authorEmail: r.author_email,
    note: r.note,
    createdAt: r.created_at.toISOString(),
  }))
}

export async function getVersion(
  experienceId: string,
  major: number,
  minor: number
): Promise<ExperienceData | null> {
  const { rows } = await pool.query<{ json_blob: ExperienceData }>(
    `SELECT json_blob FROM experience_versions
      WHERE experience_id = $1 AND major = $2 AND minor = $3`,
    [experienceId, major, minor]
  )
  return rows[0]?.json_blob ?? null
}

/**
 * Restore: overwrite the draft from a version row without writing a version.
 * Returns the restored document, or null when the version does not exist.
 */
export async function restoreVersion(
  experienceId: string,
  major: number,
  minor: number
): Promise<ExperienceData | null> {
  const blob = await getVersion(experienceId, major, minor)
  if (!blob) return null
  await saveDraft(experienceId, blob)
  return blob
}

/** The published revision, or null if never published / pointer cleared. */
export async function getPublished(
  experienceId: string
): Promise<{ projectId: string; major: number; content: ExperienceData } | null> {
  const { rows } = await pool.query<{
    project_id: string
    published_major: number
    json_blob: ExperienceData
  }>(
    `SELECT e.project_id, e.published_major, v.json_blob
       FROM experiences e
       JOIN experience_versions v
         ON v.experience_id = e.id AND v.major = e.published_major AND v.minor = 0
      WHERE e.id = $1 AND e.published_major IS NOT NULL`,
    [experienceId]
  )
  if (!rows[0]) return null
  return { projectId: rows[0].project_id, major: rows[0].published_major, content: rows[0].json_blob }
}

export function toPublishedResponse(
  experienceId: string,
  pub: { projectId: string; major: number; content: ExperienceData }
): PublishedExperienceResponse {
  return {
    experience_pid: buildVersionedPid(pub.projectId, experienceId, pub.major),
    project_id: pub.projectId,
    tool: config.pid.tool,
    revision: pub.major,
    content: pub.content,
  }
}

/**
 * Move the published pointer (publication rollback). false = no published
 * version row exists at that major, nothing changed.
 */
export async function setPublishedMajor(experienceId: string, major: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE experiences e
        SET published_major = $2, updated_at = now()
      WHERE e.id = $1
        AND EXISTS (SELECT 1 FROM experience_versions v
                     WHERE v.experience_id = e.id AND v.major = $2 AND v.minor = 0)`,
    [experienceId, major]
  )
  return (rowCount ?? 0) > 0
}

/** Unpublish: pointer to NULL. History is untouched. */
export async function unpublish(experienceId: string): Promise<void> {
  await pool.query(
    `UPDATE experiences SET published_major = NULL, updated_at = now() WHERE id = $1`,
    [experienceId]
  )
}

export async function deleteExperience(experienceId: string): Promise<void> {
  await pool.query(`DELETE FROM experiences WHERE id = $1`, [experienceId])
}

export { toSummary, staleAwareLock }
