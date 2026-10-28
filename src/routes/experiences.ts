import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import type { ExperienceData } from "../types/experience.js"
import * as exp from "../services/experienceService.js"
import * as locks from "../services/lockService.js"
import { getRole, canEdit } from "../services/authz.js"
import { resolveCreateScope, sendScopeDenial } from "../services/projectScope.js"
import {
  createExperienceBody,
  duplicateBody,
  draftBody,
  commitBody,
  publishBody,
  restoreBody,
  setPublishedBody,
  idParam,
  majorMinorParam,
} from "../schemas/experience.zod.js"
import { parse } from "./parse.js"
import { sendPublished } from "./publishedReply.js"
import * as bundles from "../services/bundleService.js"
import { buildVersionedPid } from "../services/pid.js"

export function registerExperienceRoutes(app: FastifyInstance): void {
  // Role checks include Catalogue membership, so every route resolves `req.catalogueAuth`.
  const auth = { preHandler: app.authenticateWithCatalogue }

  /** Resolve access or send 404/403. Returns undefined after replying. */
  async function requireRole(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
    opts: { edit?: boolean; owner?: boolean } = {}
  ) {
    const access = await getRole(id, req.user, req.catalogueAuth)
    if (!access) {
      reply.code(404).send({ error: "Experience not found" })
      return undefined
    }
    if (opts.owner && access.role !== "owner") {
      reply.code(403).send({ error: "Owner access required" })
      return undefined
    }
    if (opts.edit && !canEdit(access.role)) {
      reply.code(403).send({ error: "Editor access required" })
      return undefined
    }
    return access
  }

  /** 409 unless the caller holds a fresh edit lock. Returns false after replying. */
  async function requireFreshLock(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
    row: Parameters<typeof exp.staleAwareLock>[0]
  ): Promise<boolean> {
    if (await locks.holdsFreshLock(id, req.user.sub)) return true
    reply.code(409).send({
      error: "You do not hold the edit lock for this experience",
      lock: exp.staleAwareLock(row),
    })
    return false
  }

  /**
   * Shared write preamble: valid id, valid body, editor role, fresh lock.
   * Returns undefined after replying.
   */
  async function requireWritable<S extends z.ZodTypeAny>(
    req: FastifyRequest,
    reply: FastifyReply,
    bodySchema: S
  ): Promise<{ id: string; body: z.infer<S> } | undefined> {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const body = parse(bodySchema, req.body, reply)
    if (!body) return
    const access = await requireRole(req, reply, params.id, { edit: true })
    if (!access) return
    if (!(await requireFreshLock(req, reply, params.id, access.row))) return
    return { id: params.id, body }
  }

  app.get("/api/experiences", auth, async (req) => {
    return exp.listForUser(req.user, req.catalogueAuth)
  })

  app.post("/api/experiences", auth, async (req, reply) => {
    const body = parse(createExperienceBody, req.body, reply)
    if (!body) return

    const scope = resolveCreateScope(req.catalogueAuth, body.projectId)
    if ("deny" in scope) return sendScopeDenial(reply, scope, "create")

    // Zod validates structure only (passthrough), so the body is cast to the TS type.
    const row = await exp.createExperience(
      req.user,
      body.title,
      scope.projectId,
      body.experience as ExperienceData | undefined
    )
    reply.code(201)
    return { ...exp.toSummary(row, "owner"), experience: row.draft_json }
  })

  app.get("/api/experiences/:id", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const access = await requireRole(req, reply, params.id)
    if (!access) return
    const latest_version_at = await exp.latestVersionAt(params.id)
    return {
      ...exp.toSummary({ ...access.row, latest_version_at }, access.role),
      experience: access.row.draft_json,
    }
  })

  /**
   * Offline bundle: a zip of the published revision plus every media file it
   * references, in the layout the headset player reads from local storage.
   * Any read role may export.
   */
  app.get("/api/experiences/:id/export", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const access = await requireRole(req, reply, params.id)
    if (!access) return

    const pub = await exp.getPublished(params.id)
    if (!pub) return reply.code(404).send({ error: "Experience has never been published" })

    let plan
    try {
      plan = await bundles.planBundle({
        id: params.id,
        title: access.row.title,
        revision: pub.major,
        experiencePid: buildVersionedPid(pub.projectId, params.id, pub.major),
        content: pub.content,
      })
    } catch (err) {
      if (err instanceof bundles.BundleMediaMissingError) {
        return reply.code(err.statusCode).send({ error: err.message })
      }
      throw err
    }

    const archive = bundles.createArchive()
    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${plan.filename}"`)

    reply.send(archive)

    // Headers are already sent: a failure here surfaces as a truncated download, not a 5xx.
    bundles.writeBundle(archive, plan).catch((err) => {
      if (err instanceof bundles.BundleAbortedError) {
        req.log.info({ err }, "bundle export aborted by the client")
        return
      }
      req.log.error({ err }, "bundle export failed mid-stream")
    })

    return reply
  })

  app.delete("/api/experiences/:id", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const access = await requireRole(req, reply, params.id, { owner: true })
    if (!access) return
    await exp.deleteExperience(params.id)
    reply.code(204).send()
  })

  // Duplicate: any read role may copy the source into a new caller-owned draft
  // (no lock needed). The target project is resolved like create.
  app.post("/api/experiences/:id/duplicate", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const body = parse(duplicateBody, req.body, reply)
    if (!body) return
    const access = await requireRole(req, reply, params.id)
    if (!access) return

    const scope = resolveCreateScope(req.catalogueAuth, body.projectId)
    if ("deny" in scope) return sendScopeDenial(reply, scope, "duplicate")

    const row = await exp.duplicateExperience(
      req.user,
      access.row.draft_json,
      body.title,
      scope.projectId
    )
    reply.code(201)
    return { ...exp.toSummary(row, "owner"), experience: row.draft_json }
  })

  // --- Draft / commit / publish / restore ---

  app.put("/api/experiences/:id/draft", auth, async (req, reply) => {
    const ctx = await requireWritable(req, reply, draftBody)
    if (!ctx) return
    await exp.saveDraft(ctx.id, ctx.body.experience as ExperienceData)
    reply.code(204).send()
  })

  app.post("/api/experiences/:id/commit", auth, async (req, reply) => {
    const ctx = await requireWritable(req, reply, commitBody)
    if (!ctx) return
    return exp.commitVersion(ctx.id, req.user, ctx.body.note)
  })

  // Editors may publish; moving or clearing the published pointer is owner-only.
  app.post("/api/experiences/:id/publish", auth, async (req, reply) => {
    const ctx = await requireWritable(req, reply, publishBody)
    if (!ctx) return
    return exp.publishVersion(ctx.id, req.user, ctx.body.note)
  })

  app.post("/api/experiences/:id/restore", auth, async (req, reply) => {
    const ctx = await requireWritable(req, reply, restoreBody)
    if (!ctx) return
    const blob = await exp.restoreVersion(ctx.id, ctx.body.major, ctx.body.minor)
    if (!blob) return reply.code(404).send({ error: "Version not found" })
    return { experience: blob }
  })

  // --- Versions (read-only, any role) ---

  app.get("/api/experiences/:id/versions", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id))) return
    return exp.listVersions(params.id)
  })

  app.get("/api/experiences/:id/versions/:major/:minor", auth, async (req, reply) => {
    const params = parse(majorMinorParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id))) return
    const blob = await exp.getVersion(params.id, params.major, params.minor)
    if (!blob) return reply.code(404).send({ error: "Version not found" })
    return { major: params.major, minor: params.minor, experience: blob }
  })

  // --- Published revision (authenticated view of /api/v1/experiences/:id) ---
  app.get("/api/experiences/:id/published", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id))) return
    return sendPublished(req, reply, params.id)
  })

  app.put("/api/experiences/:id/published", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    const body = parse(setPublishedBody, req.body, reply)
    if (!body) return
    if (!(await requireRole(req, reply, params.id, { owner: true }))) return
    const moved = await exp.setPublishedMajor(params.id, body.major)
    if (!moved) return reply.code(400).send({ error: `No published version at major ${body.major}` })
    reply.code(204).send()
  })

  app.delete("/api/experiences/:id/published", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id, { owner: true }))) return
    await exp.unpublish(params.id)
    reply.code(204).send()
  })

  // --- Lock ---

  app.post("/api/experiences/:id/lock", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id, { edit: true }))) return
    const result = await locks.acquireLock(params.id, req.user)
    if (!result.acquired) {
      return reply.code(423).send({ error: "Locked by another user", lock: result.lock })
    }
    return { lock: result.lock }
  })

  app.delete("/api/experiences/:id/lock", auth, async (req, reply) => {
    const params = parse(idParam, req.params, reply)
    if (!params) return
    if (!(await requireRole(req, reply, params.id, { edit: true }))) return
    await locks.releaseLock(params.id, req.user)
    reply.code(204).send()
  })
}
