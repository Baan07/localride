import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { HttpError, asyncHandler } from "../errors.js";
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

adminRouter.get("/users", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       u.id, u.name, u.email, u.phone, u.role, u.created_at,
       d.vehicle_make, d.vehicle_model, d.vehicle_color, d.plate,
       d.verification_status, d.online, d.rating
     FROM users u
     LEFT JOIN driver_profiles d ON d.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT 100`
  );
  res.json({ users: result.rows });
}));

adminRouter.get("/trips", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       t.id, t.status, t.pickup_address, t.dropoff_address, t.distance_meters,
       t.fare_amount, t.platform_fee, t.payment_method, t.passenger_rating, t.passenger_rating_comment, t.created_at, t.completed_at,
       passenger.name AS passenger_name,
       driver.name AS driver_name
     FROM trips t
     JOIN users passenger ON passenger.id = t.passenger_id
     LEFT JOIN users driver ON driver.id = t.driver_id
     ORDER BY t.created_at DESC
     LIMIT 100`
  );
  res.json({ trips: result.rows });
}));

adminRouter.get("/fare-rules", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM fare_rules WHERE active = true ORDER BY created_at DESC LIMIT 1");
  res.json({ fareRule: result.rows[0] || null });
}));

adminRouter.put("/fare-rules", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    city: z.string().min(2),
    baseFare: z.number().min(0),
    minimumFare: z.number().min(0),
    pricePerKm: z.number().min(0),
    pricePerMinute: z.number().min(0),
    platformFeePercent: z.number().min(0).max(50),
    cancellationGraceMinutes: z.number().int().min(0).max(60)
  }).parse(req.body);

  await query("UPDATE fare_rules SET active = false WHERE active = true");
  const result = await query(
    `INSERT INTO fare_rules(city, base_fare, minimum_fare, price_per_km, price_per_minute, platform_fee_percent, cancellation_grace_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.city, input.baseFare, input.minimumFare, input.pricePerKm, input.pricePerMinute, input.platformFeePercent, input.cancellationGraceMinutes]
  );

  await audit({ actorId: req.user.sub, action: "admin.fare_rules_update", entityType: "fare_rule", entityId: result.rows[0].id, metadata: input, ip: req.ip });
  res.json({ fareRule: result.rows[0] });
}));

adminRouter.patch("/drivers/:id/verification", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    status: z.enum(["pending", "approved", "rejected"]),
    vehicleMake: z.string().optional(),
    vehicleModel: z.string().optional(),
    vehicleColor: z.string().optional(),
    plate: z.string().optional()
  }).parse(req.body);

  const user = await query("SELECT id, role FROM users WHERE id = $1", [req.params.id]);
  if (!user.rows[0] || user.rows[0].role !== "driver") throw new HttpError(404, "Conductor no encontrado");

  const existing = await query("SELECT * FROM driver_profiles WHERE user_id = $1", [req.params.id]);
  let result;

  if (!existing.rows[0]) {
    const missingVehicleData = !input.vehicleMake?.trim() || !input.vehicleModel?.trim() || !input.vehicleColor?.trim() || !input.plate?.trim();
    if (missingVehicleData) {
      throw new HttpError(422, "Carga marca, modelo, color y patente antes de aprobar este conductor");
    }

    result = await query(
      `INSERT INTO driver_profiles(user_id, vehicle_make, vehicle_model, vehicle_color, plate, verification_status)
       VALUES ($1, $2, $3, $4, upper($5), $6)
       RETURNING *`,
      [
        req.params.id,
        input.vehicleMake.trim(),
        input.vehicleModel.trim(),
        input.vehicleColor.trim(),
        input.plate.trim(),
        input.status
      ]
    );
  } else {
    result = await query(
      `UPDATE driver_profiles
       SET verification_status = $2,
           vehicle_make = COALESCE(NULLIF($3, ''), vehicle_make),
           vehicle_model = COALESCE(NULLIF($4, ''), vehicle_model),
           vehicle_color = COALESCE(NULLIF($5, ''), vehicle_color),
           plate = COALESCE(NULLIF(upper($6), ''), plate)
       WHERE user_id = $1
       RETURNING *`,
      [
        req.params.id,
        input.status,
        input.vehicleMake?.trim() || "",
        input.vehicleModel?.trim() || "",
        input.vehicleColor?.trim() || "",
        input.plate?.trim() || ""
      ]
    );
  }

  await audit({ actorId: req.user.sub, action: "admin.driver_verification", entityType: "driver_profile", entityId: req.params.id, metadata: input, ip: req.ip });
  res.json({ profile: result.rows[0] });
}));
