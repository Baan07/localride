import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { config } from "./config.js";
import { errorHandler, notFound } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { driversRouter } from "./routes/drivers.js";
import { tripsRouter } from "./routes/trips.js";
import { paymentsRouter } from "./routes/payments.js";
import { adminRouter } from "./routes/admin.js";

export function createApp() {
  const app = express();
  const allowedOrigins = new Set([
    config.frontendUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ].map(normalizeOrigin));

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      const isAllowedNetlifyPreview = normalized.endsWith(".netlify.app");
      return callback(null, allowedOrigins.has(normalized) || isAllowedNetlifyPreview);
    },
    credentials: true
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));
  app.use(rateLimit({ windowMs: 60_000, max: 240 }));

  app.get("/health", (req, res) => res.json({ ok: true, service: "localride-api" }));
  app.use("/api/auth", authRouter);
  app.use("/api/drivers", driversRouter);
  app.use("/api/trips", tripsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/admin", adminRouter);

  app.use((req, res, next) => next(notFound()));
  app.use(errorHandler);

  return app;
}

function normalizeOrigin(origin) {
  return String(origin || "").replace(/\/+$/, "");
}
