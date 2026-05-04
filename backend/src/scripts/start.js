import "./migrate.js";

if (process.env.RUN_SEED_ON_START === "true") {
  await import("./seed.js");
}

await import("../server.js");
