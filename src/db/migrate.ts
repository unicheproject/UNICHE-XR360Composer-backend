import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pool } from "./pool.js"
import { config } from "../config.js"

/**
 * Minimal forward-only migration runner. Applies `*.sql` files from
 * MIGRATIONS_DIR in filename order, tracking applied names in `_migrations`.
 * Idempotent — safe to run on every boot.
 */
export async function runMigrations(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  )

  const dir = path.resolve(config.migrationsDir)
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()

  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM _migrations`)
  const applied = new Set(rows.map((r) => r.name))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(dir, file), "utf8")
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(sql)
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file])
      await client.query("COMMIT")
      console.log(`[migrate] applied ${file}`)
    } catch (err) {
      await client.query("ROLLBACK")
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }
}

// Standalone entry point for `npm run migrate`.
if (process.argv[1] && path.resolve(process.argv[1]).includes("migrate")) {
  runMigrations()
    .then(() => {
      console.log("[migrate] done")
      return pool.end()
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
