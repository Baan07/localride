import { migrateDatabase } from "./migrate.js";
import { seedDatabase } from "./seed.js";

await migrateDatabase();

if (process.env.RUN_SEED_ON_START === "true") {
  await seedDatabase();
}

await import("../server.js");
