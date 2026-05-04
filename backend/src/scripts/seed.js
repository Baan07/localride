import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const passwordHash = await bcrypt.hash("LocalRide123!", 12);
const seed = (await fs.readFile(path.join(root, "database/seed.sql"), "utf8")).replaceAll("$2b$10$localride.seed.hash.replace", passwordHash);
await pool.query(seed);
await pool.end();
console.log("Database seeded. Demo password: LocalRide123!");
