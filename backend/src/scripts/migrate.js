import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = await fs.readFile(path.join(root, "database/schema.sql"), "utf8");
await pool.query(schema);
await pool.end();
console.log("Database migrated");
