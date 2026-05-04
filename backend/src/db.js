import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12
});

export async function query(text, params = []) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - started;
  if (duration > 300) {
    console.warn("slow query", { duration, text: text.slice(0, 120) });
  }
  return result;
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
