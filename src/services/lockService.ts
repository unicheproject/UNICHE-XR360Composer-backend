import { pool } from "../db/pool.js"
import { config } from "../config.js"
import type { AuthUser, LockInfo } from "../types/api.js"

/**
 * Pessimistic per-experience edit lock stored on the experience row. A lock whose
 * `locked_at` is older than LOCK_TTL_MINUTES counts as free. Acquire and refresh
 * are one atomic conditional UPDATE.
 */

const TTL = `${config.lockTtlMinutes} minutes`

function toLockInfo(row: {
  locked_by: string | null
  locked_by_email: string | null
  locked_at: Date | null
}): LockInfo {
  const expiresAt = row.locked_at
    ? new Date(row.locked_at.getTime() + config.lockTtlMinutes * 60_000)
    : null
  return {
    lockedBy: row.locked_by,
    lockedByEmail: row.locked_by_email,
    lockedAt: row.locked_at?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
  }
}

export type LockResult =
  | { acquired: true; lock: LockInfo }
  | { acquired: false; lock: LockInfo }

/** Acquire the lock, or refresh it if the caller already holds it. */
export async function acquireLock(experienceId: string, user: AuthUser): Promise<LockResult> {
  const { rows } = await pool.query(
    `UPDATE experiences
        SET locked_by = $2, locked_by_email = $3, locked_at = now()
      WHERE id = $1
        AND (locked_by IS NULL
             OR locked_at < now() - $4::interval
             OR locked_by = $2)
      RETURNING locked_by, locked_by_email, locked_at`,
    [experienceId, user.sub, user.email, TTL]
  )

  const winner = rows[0]
  if (winner) return { acquired: true, lock: toLockInfo(winner) }

  // Lost the race / held by someone else — report the current holder.
  const { rows: current } = await pool.query(
    `SELECT locked_by, locked_by_email, locked_at FROM experiences WHERE id = $1`,
    [experienceId]
  )
  return { acquired: false, lock: toLockInfo(current[0]) }
}

/** Release only if the caller is the holder; releasing a free lock is a no-op. */
export async function releaseLock(experienceId: string, user: AuthUser): Promise<void> {
  await pool.query(
    `UPDATE experiences
        SET locked_by = NULL, locked_by_email = NULL, locked_at = NULL
      WHERE id = $1 AND locked_by = $2`,
    [experienceId, user.sub]
  )
}

/** True if the caller holds a fresh (non-stale) lock. */
export async function holdsFreshLock(experienceId: string, userSub: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM experiences
      WHERE id = $1 AND locked_by = $2 AND locked_at >= now() - $3::interval`,
    [experienceId, userSub, TTL]
  )
  return rows.length > 0
}

export { toLockInfo }
