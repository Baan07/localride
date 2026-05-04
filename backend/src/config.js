import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL || "postgres://localride:localride@localhost:5432/localride",
  jwtSecret: process.env.JWT_SECRET || "development-only-change-me",
  mpAccessToken: process.env.MP_ACCESS_TOKEN || "",
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:4000"
};
