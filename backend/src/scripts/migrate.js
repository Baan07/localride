import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

export async function migrateDatabase() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const schema = await fs.readFile(path.join(root, "database/schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Database migrated");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await migrateDatabase();
  await pool.end();
}
