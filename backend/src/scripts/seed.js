import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

export async function seedDatabase() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const passwordHash = await bcrypt.hash("LocalRide123!", 12);
  const seedTemplate = await fs.readFile(path.join(root, "database/seed.sql"), "utf8");
  const seed = seedTemplate.split("$2b$10$localride.seed.hash.replace").join(passwordHash);
  await pool.query(seed);
  console.log("Database seeded. Demo password: LocalRide123!");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await seedDatabase();
  await pool.end();
}
