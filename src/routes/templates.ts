import type { FastifyInstance } from "fastify"
import * as catalogue from "../services/catalogue.js"
import { listAuthorableOrgs } from "../services/catalogueAuth.js"
import { getRole } from "../services/authz.js"
import * as templates from "../services/templateService.js"
import * as exp from "../services/experienceService.js"
import { resolveCreateScope, sendScopeDenial } from "../services/projectScope.js"
import { saveTemplateBody, instantiateBody, templateIdParam } from "../schemas/template.zod.js"
import { parse, requireCatalogue } from "./parse.js"

/**
 * Org-scoped experience templates. Rows live in this backend's database; the
 * Catalogue supplies the org membership that scopes visibility, so every route
 * requires Catalogue integration.
 */
export function registerTemplateRoutes(app: FastifyInstance): void {
  const auth = { preHandler: app.authenticateWithCatalogue }

  /** The library: every template in an org the caller belongs to. */
  app.get("/api/templates", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const orgs = await listAuthorableOrgs(req.catalogueAuth!, req.bearerToken)
    return templates.listTemplates([...orgs])
  })

  /**
   * Save an experience's current draft as a template, scoped to the org of the
   * source's project. Any read role may do this.
   */
  app.post("/api/templates", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const body = parse(saveTemplateBody, req.body, reply)
    if (!body) return
    const access = await getRole(body.experienceId, req.user, req.catalogueAuth)
    if (!access) return reply.code(404).send({ error: "Experience not found" })

    const project = await catalogue.getProject(access.row.project_id, req.bearerToken)
    if (!project) {
      return reply.code(400).send({ error: "Source experience's project is not available" })
    }

    reply.code(201)
    return templates.saveTemplate(
      req.user,
      project.orgId,
      body.title,
      body.description,
      access.row.draft_json
    )
  })

  /**
   * Create a caller-owned experience from a template in one of the caller's
   * orgs. The target project is resolved like create.
   */
  app.post("/api/templates/:id/instantiate", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const params = parse(templateIdParam, req.params, reply)
    if (!params) return
    const body = parse(instantiateBody, req.body, reply)
    if (!body) return

    const template = await templates.getTemplate(params.id)
    if (!template) return reply.code(404).send({ error: "Template not found" })
    const orgs = await listAuthorableOrgs(req.catalogueAuth!, req.bearerToken)
    // 404, not 403, so ids cannot be probed.
    if (!orgs.has(template.org_id)) return reply.code(404).send({ error: "Template not found" })

    const scope = resolveCreateScope(req.catalogueAuth, body.projectId)
    if ("deny" in scope) return sendScopeDenial(reply, scope, "create")

    const row = await exp.duplicateExperience(req.user, template.json_blob, body.title, scope.projectId)
    reply.code(201)
    return { ...exp.toSummary(row, "owner"), experience: row.draft_json }
  })

  /** Delete a template. Allowed for its creator or a manager of its org; others get 404. */
  app.delete("/api/templates/:id", auth, async (req, reply) => {
    if (!requireCatalogue(req, reply)) return
    const params = parse(templateIdParam, req.params, reply)
    if (!params) return
    const template = await templates.getTemplate(params.id)
    if (!template) return reply.code(404).send({ error: "Template not found" })

    const isCreator = template.created_by === req.user.sub
    const managesOrg = req.catalogueAuth!.managedOrgs.has(template.org_id)
    if (!isCreator && !managesOrg) return reply.code(404).send({ error: "Template not found" })

    await templates.deleteTemplate(params.id)
    reply.code(204).send()
  })
}
