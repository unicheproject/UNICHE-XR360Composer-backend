import type { Role } from "../types/api.js"

/**
 * The role lattice: owner ⊃ editor ⊃ viewer.
 *
 * `ProjectGrant` is what project membership can grant; it excludes `owner`, which
 * only the experience's creator holds.
 */

export type ProjectGrant = Extract<Role, "editor" | "viewer">

const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

/** The higher of two roles; null only when both are null. */
export function maxRole<T extends Role>(a: T | null | undefined, b: T | null): T | null {
  if (!a) return b
  if (!b) return a
  return rank[a] >= rank[b] ? a : b
}
