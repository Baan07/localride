import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { HttpError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { broadcastTrip } from "../realtime.js";
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
       u.blocked_at, u.blocked_reason,
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

adminRouter.get("/payments-summary", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const [byMethod, paymentStates] = await Promise.all([
    query(
      `SELECT
         payment_method,
         count(*)::int AS total_trips,
         coalesce(sum(fare_amount), 0)::numeric AS total_amount,
         coalesce(sum(platform_fee), 0)::numeric AS platform_fee
       FROM trips
       WHERE status = 'completed'
       GROUP BY payment_method
       ORDER BY payment_method`
    ),
    query(
      `SELECT status, count(*)::int AS total, coalesce(sum(amount), 0)::numeric AS amount
       FROM payments
       GROUP BY status
       ORDER BY status`
    )
  ]);

  res.json({
    byMethod: byMethod.rows.map((row) => ({
      paymentMethod: row.payment_method,
      totalTrips: row.total_trips,
      totalAmount: Number(row.total_amount),
      platformFee: Number(row.platform_fee)
    })),
    paymentStates: paymentStates.rows.map((row) => ({
      status: row.status,
      total: row.total,
      amount: Number(row.amount)
    }))
  });
}));

adminRouter.get("/audit", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
       u.name AS actor_name, u.email AS actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC
     LIMIT 60`
  );
  res.json({ logs: result.rows });
}));

adminRouter.get("/trips/export", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       t.created_at, t.completed_at, t.status, t.pickup_address, t.dropoff_address,
       t.distance_meters, t.fare_amount, t.platform_fee, t.payment_method,
       passenger.name AS passenger_name,
       driver.name AS driver_name,
       t.passenger_rating, t.passenger_rating_comment, t.cancellation_reason
     FROM trips t
     JOIN users passenger ON passenger.id = t.passenger_id
     LEFT JOIN users driver ON driver.id = t.driver_id
     ORDER BY t.created_at DESC
     LIMIT 1000`
  );
  const header = [
    "creado", "finalizado", "estado", "origen", "destino", "km", "total", "comision",
    "pago", "pasajero", "conductor", "calificacion", "comentario", "cancelacion"
  ];
  const rows = result.rows.map((trip) => [
    trip.created_at,
    trip.completed_at || "",
    trip.status,
    trip.pickup_address,
    trip.dropoff_address,
    Math.round(Number(trip.distance_meters || 0) / 100) / 10,
    trip.fare_amount,
    trip.platform_fee,
    trip.payment_method,
    trip.passenger_name,
    trip.driver_name || "",
    trip.passenger_rating || "",
    trip.passenger_rating_comment || "",
    trip.cancellation_reason || ""
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=rio-movil-viajes.csv");
  res.send(`\ufeff${csv}`);
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

adminRouter.patch("/users/:id/block", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.sub) throw new HttpError(422, "No podes bloquear tu propio usuario");
  const input = z.object({
    blocked: z.boolean(),
    reason: z.string().max(300).optional()
  }).parse(req.body);

  const result = await query(
    `UPDATE users
     SET blocked_at = CASE WHEN $2 THEN now() ELSE NULL END,
         blocked_reason = CASE WHEN $2 THEN $3 ELSE NULL END,
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, email, role, blocked_at, blocked_reason`,
    [req.params.id, input.blocked, input.reason || null]
  );
  if (!result.rows[0]) throw new HttpError(404, "Usuario no encontrado");

  await audit({ actorId: req.user.sub, action: input.blocked ? "admin.user_block" : "admin.user_unblock", entityType: "user", entityId: req.params.id, metadata: input, ip: req.ip });
  res.json({ user: result.rows[0] });
}));

adminRouter.patch("/trips/:id/cancel", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    reason: z.string().min(3).max(300)
  }).parse(req.body);

  const result = await query(
    `UPDATE trips
     SET status = 'cancelled',
         cancellation_reason = $2,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1
       AND status IN ('requested', 'accepted', 'driver_arriving', 'in_progress')
     RETURNING *`,
    [req.params.id, input.reason]
  );
  if (!result.rows[0]) throw new HttpError(404, "Viaje activo no encontrado");

  await audit({ actorId: req.user.sub, action: "admin.trip_cancel", entityType: "trip", entityId: req.params.id, metadata: input, ip: req.ip });
  broadcastTrip(req.params.id, { type: "trip.updated", trip: result.rows[0] });
  res.json({ trip: result.rows[0] });
}));

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
