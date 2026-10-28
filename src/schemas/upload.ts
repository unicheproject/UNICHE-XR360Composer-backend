import { z } from "zod"

/** Request shapes for the chunked upload protocol. */

export const initUploadBody = z.object({
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  /** Total bytes of the finished file. Drives totalParts and the early cap check. */
  size: z.coerce.number().int().positive(),
  /** Client may propose a part size; the server clamps and echoes the real one. */
  partSize: z.coerce.number().int().positive().optional(),
})

export const uploadIdParam = z.object({ id: z.string().uuid() })

export const partParams = uploadIdParam.extend({
  /** 1-based part number. */
  partNo: z.coerce.number().int().positive(),
})
