import pg from "pg"
import { config } from "../config.js"

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
})

/** Run `fn` inside a transaction; commits on resolve, rolls back on throw. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
