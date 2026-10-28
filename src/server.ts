import Fastify from "fastify"
import multipart from "@fastify/multipart"
import { config } from "./config.js"
import { runMigrations } from "./db/migrate.js"
import { getToolBySvc } from "./services/catalogue.js"
import { storage } from "./storage/index.js"
import { registerAuth } from "./auth/authPlugin.js"
import { registerHealthRoutes } from "./routes/health.js"
import { registerConfigRoutes } from "./routes/config.js"
import { registerExperienceRoutes } from "./routes/experiences.js"
import { registerRuntimeRoutes } from "./routes/runtime.js"
import { registerCatalogueRoutes } from "./routes/catalogue.js"
import { registerTemplateRoutes } from "./routes/templates.js"
import { registerMediaRoutes } from "./routes/media.js"
import { registerStaticRoutes } from "./routes/static.js"

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: config.nodeEnv === "production" ? "info" : "debug" },
    // Experience documents exceed Fastify's 1 MB default.
    bodyLimit: config.experienceBodyLimitBytes,
  })

  await app.register(multipart, {
    limits: { fileSize: config.media.maxBytes, files: 1 },
  })

  // Chunked-upload part bodies: hand the raw stream to the route; the default parser would buffer it in memory.
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => {
    done(null, payload)
  })

  registerAuth(app)
  registerHealthRoutes(app)
  registerConfigRoutes(app)
  registerExperienceRoutes(app)
  registerRuntimeRoutes(app)
  registerCatalogueRoutes(app)
  registerTemplateRoutes(app)
  registerMediaRoutes(app)
  // Registered last so /api routes take precedence.
  registerStaticRoutes(app)

  await runMigrations()
  await storage.init()

  await app.listen({ port: config.port, host: "0.0.0.0" })
  app.log.info(
    `XR360 backend up on :${config.port} (${config.nodeEnv}, storage=${storage.driver})`
  )

  // Non-fatal Catalogue self-check: logs whether this tool is registered.
  if (config.catalogue.enabled) {
    getToolBySvc(config.pid.tool)
      .then((tool) =>
        tool
          ? app.log.info(`Catalogue: tool "${tool.slug}" registered (runtimeApiUrl=${tool.runtimeApiUrl ?? "n/a"})`)
          : app.log.warn(`Catalogue: tool "${config.pid.tool}" not found or svc unconfigured`)
      )
      .catch((err) => app.log.warn(`Catalogue self-check failed: ${err}`))
  }
}

main().catch((err) => {
  console.error("[server] Fatal boot error:", err)
  process.exit(1)
})
