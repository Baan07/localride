import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { findNearbyDrivers } from "../services/driverMatcher.js";

export const driversRouter = Router();

driversRouter.get("/nearby", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().min(500).max(30000).default(8000)
  }).parse(req.query);

  res.json({ drivers: await findNearbyDrivers(input) });
}));

driversRouter.get("/me/profile", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM driver_profiles WHERE user_id = $1", [req.user.sub]);
  res.json({ profile: result.rows[0] || null });
}));

driversRouter.get("/me/earnings", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const [summary, recentTrips] = await Promise.all([
    query(
      `SELECT
         count(*)::int AS completed_trips,
         coalesce(sum(fare_amount), 0)::numeric AS gross_amount,
         coalesce(sum(platform_fee), 0)::numeric AS platform_fee,
         coalesce(sum(fare_amount - platform_fee), 0)::numeric AS driver_net,
         coalesce(sum(CASE WHEN payment_method = 'cash' THEN fare_amount ELSE 0 END), 0)::numeric AS cash_amount,
         coalesce(sum(CASE WHEN payment_method = 'mercado_pago' THEN fare_amount ELSE 0 END), 0)::numeric AS mercado_pago_amount
       FROM trips
       WHERE driver_id = $1 AND status = 'completed'`,
      [req.user.sub]
    ),
    query(
      `SELECT
         t.id, t.pickup_address, t.dropoff_address, t.distance_meters, t.fare_amount,
         t.platform_fee, t.payment_method, t.completed_at,
         p.status AS payment_status
       FROM trips t
       LEFT JOIN LATERAL (
         SELECT status
         FROM payments
         WHERE trip_id = t.id
         ORDER BY created_at DESC
         LIMIT 1
       ) p ON true
       WHERE t.driver_id = $1 AND t.status = 'completed'
       ORDER BY t.completed_at DESC NULLS LAST, t.created_at DESC
       LIMIT 30`,
      [req.user.sub]
    )
  ]);

  res.json({
    summary: {
      completedTrips: summary.rows[0].completed_trips,
      grossAmount: Number(summary.rows[0].gross_amount),
      platformFee: Number(summary.rows[0].platform_fee),
      driverNet: Number(summary.rows[0].driver_net),
      cashAmount: Number(summary.rows[0].cash_amount),
      mercadoPagoAmount: Number(summary.rows[0].mercado_pago_amount)
    },
    trips: recentTrips.rows
  });
}));

driversRouter.put("/me/profile", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const input = z.object({
    vehicleMake: z.string().min(2),
    vehicleModel: z.string().min(1),
    vehicleColor: z.string().min(2),
    plate: z.string().min(5).max(12)
  }).parse(req.body);

  const result = await query(
    `INSERT INTO driver_profiles(user_id, vehicle_make, vehicle_model, vehicle_color, plate)
     VALUES ($1, $2, $3, $4, upper($5))
     ON CONFLICT (user_id)
     DO UPDATE SET vehicle_make = EXCLUDED.vehicle_make,
                   vehicle_model = EXCLUDED.vehicle_model,
                   vehicle_color = EXCLUDED.vehicle_color,
                   plate = EXCLUDED.plate
     RETURNING *`,
    [req.user.sub, input.vehicleMake, input.vehicleModel, input.vehicleColor, input.plate]
  );

  await audit({ actorId: req.user.sub, action: "driver.profile_upsert", entityType: "driver_profile", entityId: req.user.sub, ip: req.ip });
  res.json({ profile: result.rows[0] });
}));

driversRouter.patch("/me/availability", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const input = z.object({
    online: z.boolean(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional()
  }).parse(req.body);

  const result = await query(
    `UPDATE driver_profiles
     SET online = $2,
         last_location = CASE
           WHEN $3::numeric IS NOT NULL AND $4::numeric IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
           ELSE last_location
         END,
         last_location_at = CASE
           WHEN $3::numeric IS NOT NULL AND $4::numeric IS NOT NULL THEN now()
           ELSE last_location_at
         END
     WHERE user_id = $1
     RETURNING *`,
    [req.user.sub, input.online, input.lat || null, input.lng || null]
  );

  await audit({ actorId: req.user.sub, action: "driver.availability", entityType: "driver_profile", entityId: req.user.sub, metadata: input, ip: req.ip });
  res.json({ profile: result.rows[0] });
}));
