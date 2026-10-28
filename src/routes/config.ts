import type { FastifyInstance } from "fastify"
import { config } from "../config.js"

/**
 * Runtime client configuration the composer fetches at boot. Unauthenticated:
 * the login flow depends on it, and it contains nothing secret.
 */
export function registerConfigRoutes(app: FastifyInstance): void {
  app.get("/api/config", async () => ({
    keycloak: {
      url: config.keycloak.publicUrl,
      realm: config.keycloak.realm,
      clientId: config.keycloak.clientId,
    },
  }))
}
