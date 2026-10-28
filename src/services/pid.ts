import { config } from "../config.js"

/**
 * Platform experience identifiers (outbound only; URLs route by the raw UUID):
 *   - a bare PID      `uniche:exp/{project}/{tool}/{uuid}`            (version-agnostic)
 *   - a versioned PID `uniche:exp/{project}/{tool}/{uuid}@{revision}` (one revision)
 */

const PREFIX = "uniche:exp"

/** `uniche:exp/{project}/{tool}/{uuid}` — stable across versions. */
export function buildPid(projectId: string, uuid: string): string {
  return `${PREFIX}/${projectId}/${config.pid.tool}/${uuid}`
}

/** `uniche:exp/{project}/{tool}/{uuid}@{revision}` — points at one version. */
export function buildVersionedPid(projectId: string, uuid: string, revision: number): string {
  return `${buildPid(projectId, uuid)}@${revision}`
}
