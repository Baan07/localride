import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../db.js";
import { HttpError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../services/audit.js";
import { estimateFare } from "../services/fare.js";
import { broadcastTrip } from "../realtime.js";

export const tripsRouter = Router();

const pointSchema = z.object({
  address: z.string().min(3),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

const routeSchema = z.object({
  distanceMeters: z.number().min(1),
  durationSeconds: z.number().min(1)
}).optional();

tripsRouter.post("/estimate", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({ pickup: pointSchema, dropoff: pointSchema, route: routeSchema }).parse(req.body);
  res.json({ estimate: await estimateFare(input) });
}));

tripsRouter.post("/", requireAuth, requireRole("passenger", "admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    pickup: pointSchema,
    dropoff: pointSchema,
    route: routeSchema,
    paymentMethod: z.enum(["mercado_pago", "cash"]),
    note: z.string().max(500).optional()
  }).parse(req.body);

  const estimate = await estimateFare(input);

  const trip = await transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO trips(
         passenger_id, driver_id, status, pickup_address, dropoff_address,
         pickup_location, dropoff_location, distance_meters, duration_seconds,
         fare_amount, platform_fee, payment_method, accepted_at
       )
       VALUES (
         $1, NULL, 'requested', $2, $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
         ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
         $8, $9, $10, $11, $12,
         NULL
       )
       RETURNING *`,
      [
        req.user.sub,
        input.pickup.address,
        input.dropoff.address,
        input.pickup.lng,
        input.pickup.lat,
        input.dropoff.lng,
        input.dropoff.lat,
        estimate.distanceMeters,
        estimate.durationSeconds,
        estimate.amount,
        estimate.platformFee,
        input.paymentMethod
      ]
    );

    return result.rows[0];
  });

  await audit({ actorId: req.user.sub, action: "trip.create", entityType: "trip", entityId: trip.id, metadata: { note: input.note || null }, ip: req.ip });
  broadcastTrip(trip.id, { type: "trip.updated", trip });
  res.status(201).json({ trip });
}));

tripsRouter.get("/driver/requests", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, status, pickup_address, dropoff_address, distance_meters, fare_amount, payment_method, created_at
     FROM trips
     WHERE status = 'requested'
       AND driver_id IS NULL
     ORDER BY created_at DESC
     LIMIT 10`
  );
  res.json({ trips: result.rows });
}));

tripsRouter.post("/:id/accept", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const result = await query(
    `UPDATE trips
     SET driver_id = $2,
         status = 'accepted',
         accepted_at = now(),
         updated_at = now()
     WHERE id = $1
       AND status = 'requested'
       AND driver_id IS NULL
     RETURNING *`,
    [req.params.id, req.user.sub]
  );

  if (!result.rows[0]) throw new HttpError(409, "Este pedido ya fue tomado o no esta disponible");

  await audit({ actorId: req.user.sub, action: "trip.accept", entityType: "trip", entityId: req.params.id, ip: req.ip });
  broadcastTrip(req.params.id, { type: "trip.updated", trip: result.rows[0] });
  res.json({ trip: result.rows[0] });
}));

tripsRouter.get("/active", requireAuth, asyncHandler(async (req, res) => {
  const column = req.user.role === "driver" ? "driver_id" : "passenger_id";
  const result = await query(
    `SELECT * FROM trips
     WHERE ${column} = $1 AND status IN ('requested', 'accepted', 'driver_arriving', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.user.sub]
  );
  res.json({ trip: result.rows[0] || null });
}));

tripsRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const column = req.user.role === "driver" ? "driver_id" : "passenger_id";
  const result = await query(
    `SELECT id, status, pickup_address, dropoff_address, distance_meters, fare_amount, payment_method, passenger_rating, passenger_rating_comment, created_at, completed_at
     FROM trips
     WHERE ${column} = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [req.user.sub]
  );
  res.json({ trips: result.rows });
}));

tripsRouter.post("/:id/rating", requireAuth, requireRole("passenger", "admin"), asyncHandler(async (req, res) => {
  const input = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(300).optional()
  }).parse(req.body);

  const result = await query(
    `UPDATE trips
     SET passenger_rating = $3,
         passenger_rating_comment = $4,
         updated_at = now()
     WHERE id = $1
       AND passenger_id = $2
       AND status = 'completed'
     RETURNING *`,
    [req.params.id, req.user.sub, input.rating, input.comment || null]
  );

  if (!result.rows[0]) throw new HttpError(404, "Viaje finalizado no encontrado para calificar");

  await query(
    `UPDATE driver_profiles
     SET rating = COALESCE((
       SELECT round(avg(passenger_rating)::numeric, 2)
       FROM trips
       WHERE driver_id = $1 AND passenger_rating IS NOT NULL
     ), rating)
     WHERE user_id = $1`,
    [result.rows[0].driver_id]
  );

  await audit({ actorId: req.user.sub, action: "trip.rate", entityType: "trip", entityId: req.params.id, metadata: input, ip: req.ip });
  res.json({ trip: result.rows[0] });
}));

tripsRouter.get("/:id", requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = result.rows[0];
  if (!trip) throw new HttpError(404, "Viaje no encontrado");

  const isPassenger = trip.passenger_id === req.user.sub;
  const isDriver = trip.driver_id === req.user.sub;
  const isAdmin = req.user.role === "admin";
  if (!isPassenger && !isDriver && !isAdmin) throw new HttpError(403, "No podes ver este viaje");

  res.json({ trip });
}));

tripsRouter.patch("/:id/status", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({
    status: z.enum(["accepted", "driver_arriving", "in_progress", "completed", "cancelled"]),
    cancellationReason: z.string().max(300).optional()
  }).parse(req.body);

  const current = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = current.rows[0];
  if (!trip) throw new HttpError(404, "Viaje no encontrado");

  const isPassenger = trip.passenger_id === req.user.sub;
  const isDriver = trip.driver_id === req.user.sub;
  const isAdmin = req.user.role === "admin";
  if (!isPassenger && !isDriver && !isAdmin) throw new HttpError(403, "No podes modificar este viaje");

  const result = await query(
    `UPDATE trips
     SET status = $2::trip_status,
         cancellation_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancellation_reason END,
         started_at = CASE WHEN $2 = 'in_progress' THEN now() ELSE started_at END,
         completed_at = CASE WHEN $2 IN ('completed', 'cancelled') THEN now() ELSE completed_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id, input.status, input.cancellationReason || null]
  );

  await audit({ actorId: req.user.sub, action: `trip.${input.status}`, entityType: "trip", entityId: req.params.id, metadata: input, ip: req.ip });
  broadcastTrip(req.params.id, { type: "trip.updated", trip: result.rows[0] });
  res.json({ trip: result.rows[0] });
}));

tripsRouter.post("/:id/location", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const input = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(0).max(360).optional(),
    speedKmh: z.number().min(0).max(220).optional()
  }).parse(req.body);

  const tripResult = await query("SELECT * FROM trips WHERE id = $1 AND driver_id = $2", [req.params.id, req.user.sub]);
  if (!tripResult.rows[0]) throw new HttpError(404, "Viaje activo no encontrado para este conductor");

  await query(
    `INSERT INTO trip_locations(trip_id, driver_id, location, heading, speed_kmh)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6)`,
    [req.params.id, req.user.sub, input.lng, input.lat, input.heading || null, input.speedKmh || null]
  );
  await query(
    `UPDATE driver_profiles
     SET last_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         last_location_at = now()
     WHERE user_id = $1`,
    [req.user.sub, input.lng, input.lat]
  );

  const payload = { type: "driver.location", tripId: req.params.id, location: input, at: new Date().toISOString() };
  broadcastTrip(req.params.id, payload);
  res.status(201).json(payload);
}));
