import type { PoolClient } from "pg"
import { pool } from "../db/pool.js"
import type { ExperienceRow } from "../db/schema.js"
import type { AuthUser, Role } from "../types/api.js"
import { catalogueProjectRole, type ResolvedAuthorization } from "./catalogueAuth.js"
import { isLegacyScope } from "./projectScope.js"

/**
 * Experience authorization. A caller's role is, in order:
 *   - `owner` — the user who created the experience (never granted by membership);
 *   - the role granted by Catalogue project membership for the experience's project.
 *
 * null means no access. Without a Catalogue, or for legacy `"default"`-project
 * rows, authorization is owner-only.
 */

/** The role Catalogue membership grants for this row, or null. */
function catalogueRole(
  row: Pick<ExperienceRow, "project_id">,
  catalogueAuth: ResolvedAuthorization | null
): Role | null {
  if (!catalogueAuth || isLegacyScope(row.project_id)) return null
  return catalogueProjectRole(catalogueAuth, row.project_id)
}

/** The caller's effective role for a row, or null for no access. */
export function composeRole(
  row: Pick<ExperienceRow, "owner_sub" | "project_id">,
  user: AuthUser,
  catalogueAuth: ResolvedAuthorization | null
): Role | null {
  if (row.owner_sub === user.sub) return "owner"
  return catalogueRole(row, catalogueAuth)
}

/** Loads an experience row and the caller's role on it; null when absent or inaccessible. */
export async function getRole(
  experienceId: string,
  user: AuthUser,
  catalogueAuth: ResolvedAuthorization | null,
  client?: PoolClient
): Promise<{ row: ExperienceRow; role: Role } | null> {
  const db = client ?? pool
  const { rows } = await db.query<ExperienceRow>(`SELECT * FROM experiences WHERE id = $1`, [
    experienceId,
  ])
  const row = rows[0]
  if (!row) return null

  const role = composeRole(row, user, catalogueAuth)
  return role ? { row, role } : null
}

export function canEdit(role: Role): boolean {
  return role === "owner" || role === "editor"
}
