import type { ExperienceData } from "../types/experience.js"

/** Row shapes as returned by pg (snake_case, timestamptz as Date). */

export interface UserRow {
  sub: string
  email: string
  display_name: string | null
  created_at: Date
}

export interface ExperienceRow {
  id: string
  project_id: string
  owner_sub: string
  owner_email: string
  title: string
  draft_json: ExperienceData
  major: number
  minor: number
  published_major: number | null
  draft_updated_at: Date
  locked_by: string | null
  locked_by_email: string | null
  locked_at: Date | null
  created_at: Date
  updated_at: Date
}

/** Columns for list/summary queries; omits the large `draft_json` document. */
export type ExperienceSummaryRow = Omit<ExperienceRow, "draft_json">

/** Summary columns plus the newest version's created_at (correlated subquery). */
export interface ExperienceRowWithMeta extends ExperienceSummaryRow {
  latest_version_at: Date | null
}

export interface ExperienceVersionRow {
  experience_id: string
  major: number
  minor: number
  json_blob: ExperienceData
  author_sub: string
  author_email: string | null
  note: string | null
  created_at: Date
}

export interface MediaRow {
  hash: string
  bucket_key: string
  mime: string
  size: string // BIGINT comes back as string from pg
  original_name: string | null
  first_uploaded_by: string | null
  created_at: Date
}

export interface MediaUploadRow {
  id: string
  owner_sub: string
  filename: string
  mime: string
  declared_size: string // BIGINT
  part_size: number
  total_parts: number
  created_at: Date
  expires_at: Date
}

export interface ExperienceTemplateRow {
  id: string
  org_id: string
  title: string
  description: string | null
  json_blob: ExperienceData
  created_by: string
  created_by_email: string | null
  created_at: Date
}

/** Columns for template list queries; omits the large `json_blob` document. */
export type ExperienceTemplateSummaryRow = Omit<ExperienceTemplateRow, "json_blob">
