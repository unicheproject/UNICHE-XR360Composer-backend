import type { FastifyInstance } from "fastify"
import { pool } from "../db/pool.js"
import { storage } from "../storage/index.js"

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => {
    let db = false
    try {
      await pool.query("SELECT 1")
      db = true
    } catch {
      /* reported below */
    }
    const storageOk = await storage.healthy()
    return {
      status: db && storageOk ? "ok" : "degraded",
      db,
      storage: storageOk,
      driver: storage.driver,
    }
  })
}
