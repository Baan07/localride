import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../services/audit.js";

export const adminRouter = Router();

adminRouter.get("/dashboard", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const [trips, revenue, drivers, pendingDrivers] = await Promise.all([
    query("SELECT count(*)::int AS total FROM trips WHERE created_at::date = current_date"),
    query("SELECT coalesce(sum(fare_amount), 0)::numeric AS total FROM trips WHERE status = 'completed'"),
    query("SELECT count(*)::int AS total FROM driver_profiles WHERE online = true"),
    query("SELECT count(*)::int AS total FROM driver_profiles WHERE verification_status = 'pending'")
  ]);

  res.json({
    metrics: {
      tripsToday: trips.rows[0].total,
      revenue: Number(revenue.rows[0].total),
      onlineDrivers: drivers.rows[0].total,
      pendingDriverVerifications: pendingDrivers.rows[0].total
    }
  });
}));

adminRouter.put("/fare-rules", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    city: z.string().min(2),
    baseFare: z.number().min(0),
    pricePerKm: z.number().min(0),
    pricePerMinute: z.number().min(0),
    platformFeePercent: z.number().min(0).max(50),
    cancellationGraceMinutes: z.number().int().min(0).max(60)
  }).parse(req.body);

  await query("UPDATE fare_rules SET active = false WHERE active = true");
  const result = await query(
    `INSERT INTO fare_rules(city, base_fare, price_per_km, price_per_minute, platform_fee_percent, cancellation_grace_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.city, input.baseFare, input.pricePerKm, input.pricePerMinute, input.platformFeePercent, input.cancellationGraceMinutes]
  );

  await audit({ actorId: req.user.sub, action: "admin.fare_rules_update", entityType: "fare_rule", entityId: result.rows[0].id, metadata: input, ip: req.ip });
  res.json({ fareRule: result.rows[0] });
}));

adminRouter.patch("/drivers/:id/verification", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = z.object({ status: z.enum(["pending", "approved", "rejected"]) }).parse(req.body);
  const result = await query(
    "UPDATE driver_profiles SET verification_status = $2 WHERE user_id = $1 RETURNING *",
    [req.params.id, input.status]
  );

  await audit({ actorId: req.user.sub, action: "admin.driver_verification", entityType: "driver_profile", entityId: req.params.id, metadata: input, ip: req.ip });
  res.json({ profile: result.rows[0] });
}));
