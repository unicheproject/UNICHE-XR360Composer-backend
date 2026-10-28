import { z } from "zod"

/**
 * Request shapes for the Catalogue proxy routes. No `role` field: the
 * Catalogue assigns the invitation role.
 */

// 320 = the Catalogue's maxLength for the invited address.
export const inviteBody = z.object({
  email: z.string().email().max(320),
})

export const projectIdParam = z.object({ projectId: z.string().uuid() })
export const invitationIdParam = z.object({ invitationId: z.string().uuid() })
