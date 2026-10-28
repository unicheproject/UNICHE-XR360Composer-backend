import { pool } from "../db/pool.js"
import type {
  ExperienceTemplateRow,
  ExperienceTemplateSummaryRow,
} from "../db/schema.js"
import type { ExperienceData } from "../types/experience.js"
import type { AuthUser, TemplateSummary } from "../types/api.js"

/**
 * Experience templates: reusable, org-scoped content snapshots. A template's
 * `json_blob` references media by `/api/media/<sha256>` URL, like an experience.
 */

function toSummary(row: ExperienceTemplateSummaryRow): TemplateSummary {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    description: row.description,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at.toISOString(),
  }
}

export async function saveTemplate(
  user: AuthUser,
  orgId: string,
  title: string,
  description: string | undefined,
  jsonBlob: ExperienceData
): Promise<TemplateSummary> {
  const { rows } = await pool.query<ExperienceTemplateRow>(
    `INSERT INTO experience_templates (org_id, title, description, json_blob, created_by, created_by_email)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [orgId, title, description ?? null, JSON.stringify(jsonBlob), user.sub, user.email]
  )
  return toSummary(rows[0]!)
}

/** The library: templates in any of the caller's orgs. Never reads json_blob. */
export async function listTemplates(orgIds: string[]): Promise<TemplateSummary[]> {
  if (orgIds.length === 0) return []
  const { rows } = await pool.query<ExperienceTemplateSummaryRow>(
    `SELECT id, org_id, title, description, created_by, created_by_email, created_at
       FROM experience_templates
      WHERE org_id = ANY($1::text[])
      ORDER BY created_at DESC`,
    [orgIds]
  )
  return rows.map(toSummary)
}

/** Full template row, including the content blob. */
export async function getTemplate(id: string): Promise<ExperienceTemplateRow | null> {
  const { rows } = await pool.query<ExperienceTemplateRow>(
    `SELECT * FROM experience_templates WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function deleteTemplate(id: string): Promise<void> {
  await pool.query(`DELETE FROM experience_templates WHERE id = $1`, [id])
}
