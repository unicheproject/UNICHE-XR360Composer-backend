import { z } from "zod"

/** Request shapes for the experience-template routes. */

// Save an experience's current draft as a template. The org is derived server-side.
export const saveTemplateBody = z.object({
  experienceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
})

// Create a new experience from a template. Target project resolved like create.
export const instantiateBody = z.object({
  title: z.string().min(1).max(200),
  projectId: z.string().min(1).optional(),
})

export const templateIdParam = z.object({ id: z.string().uuid() })
