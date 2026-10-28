import { z } from "zod"

/**
 * Loose validation of incoming experience documents: only the structure the
 * backend depends on is checked (environments array, string ids). Unknown
 * fields pass through untouched so no field is dropped on round-trip.
 */

const elementSchema = z.object({ id: z.string().min(1) }).passthrough()

const environmentSchema = z
  .object({
    id: z.string().min(1),
    elements: z.array(elementSchema).optional(),
  })
  .passthrough()

export const experienceDataSchema = z
  .object({
    title: z.string().optional(),
    startEnvironmentId: z.string().optional(),
    environments: z.array(environmentSchema),
  })
  .passthrough()

export const createExperienceBody = z.object({
  title: z.string().min(1).max(200),
  // Catalogue project scope. Required only when Catalogue integration is
  // enabled (checked in the route); otherwise the default project is used.
  projectId: z.string().min(1).optional(),
  experience: experienceDataSchema.optional(),
})

export const duplicateBody = z.object({
  title: z.string().min(1).max(200),
  // Target Catalogue project; required only when Catalogue integration is enabled.
  projectId: z.string().min(1).optional(),
})

export const draftBody = z.object({
  experience: experienceDataSchema,
})

export const commitBody = z.object({
  note: z.string().min(1).max(500), // required, non-empty
})

export const publishBody = z.object({
  note: z.string().max(500).optional(),
})

export const restoreBody = z.object({
  major: z.number().int().min(0),
  minor: z.number().int().min(0),
})

export const setPublishedBody = z.object({
  major: z.number().int().positive(), // published majors start at 1
})

export const idParam = z.object({ id: z.string().uuid() })
export const majorMinorParam = z.object({
  id: z.string().uuid(),
  major: z.coerce.number().int().min(0),
  minor: z.coerce.number().int().min(0),
})
