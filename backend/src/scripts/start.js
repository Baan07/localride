import { migrateDatabase } from "./migrate.js";
import { seedDatabase } from "./seed.js";

const shouldSeed = String(process.env.RUN_SEED_ON_START || "").trim().toLowerCase() === "true";

console.log("LocalRide startup", {
  nodeEnv: process.env.NODE_ENV || "development",
  runSeedOnStart: shouldSeed
});

await migrateDatabase();

if (shouldSeed) {
  await seedDatabase();
} else {
  console.log("Database seed skipped. Set RUN_SEED_ON_START=true to enable it.");
}

await import("../server.js");
