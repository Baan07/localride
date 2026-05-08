import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";

export const geoRouter = Router();

const serviceAreaViewbox = "-64.24,-38.88,-63.95,-39.10";

geoRouter.get("/search", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({
    q: z.string().optional(),
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    limit: z.coerce.number().min(1).max(10).default(5)
  }).parse(req.query);

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    countrycodes: "ar",
    viewbox: serviceAreaViewbox,
    bounded: "1",
    limit: String(input.limit)
  });

  if (input.street) {
    params.set("street", input.street);
    if (input.city) params.set("city", input.city);
    if (input.state) params.set("state", input.state);
    params.set("country", input.country || "Argentina");
  } else if (input.q) {
    params.set("q", input.q);
  }

  const cacheKey = crypto.createHash("sha256").update(params.toString()).digest("hex");
  const cached = await query("SELECT results FROM geocode_cache WHERE cache_key = $1 AND expires_at > now()", [cacheKey]);
  if (cached.rows[0]) return res.json({ results: cached.rows[0].results, cached: true });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { "User-Agent": "RioMovil/1.0 geocoder" }
  });
  const results = response.ok ? await response.json() : [];

  await query(
    `INSERT INTO geocode_cache(cache_key, query, results)
     VALUES ($1, $2, $3)
     ON CONFLICT (cache_key)
     DO UPDATE SET results = EXCLUDED.results, created_at = now(), expires_at = now() + interval '30 days'`,
    [cacheKey, params.toString(), JSON.stringify(results)]
  );

  res.json({ results, cached: false });
}));

geoRouter.get("/frequent", requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       id, label, address, kind, use_count, last_used_at,
       ST_Y(location::geometry) AS lat,
       ST_X(location::geometry) AS lng
     FROM user_locations
     WHERE user_id = $1
     ORDER BY use_count DESC, last_used_at DESC
     LIMIT 12`,
    [req.user.sub]
  );
  res.json({ locations: result.rows });
}));

geoRouter.post("/push-subscriptions", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({ subscription: z.record(z.any()) }).parse(req.body);
  await query(
    `INSERT INTO push_subscriptions(user_id, subscription)
     VALUES ($1, $2)
     ON CONFLICT (user_id, subscription)
     DO UPDATE SET enabled = true, updated_at = now()`,
    [req.user.sub, JSON.stringify(input.subscription)]
  );
  res.status(201).json({ ok: true });
}));
