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

async function fetchTripDetails(id) {
  const result = await query(
    `SELECT
       t.*,
       ST_Y(t.pickup_location::geometry) AS pickup_lat,
       ST_X(t.pickup_location::geometry) AS pickup_lng,
       ST_Y(t.dropoff_location::geometry) AS dropoff_lat,
       ST_X(t.dropoff_location::geometry) AS dropoff_lng,
       driver.name AS driver_name,
       driver.phone AS driver_phone,
       d.vehicle_make,
       d.vehicle_model,
       d.vehicle_color,
       d.plate,
       d.rating AS driver_rating,
       ST_Y(d.last_location::geometry) AS driver_lat,
       ST_X(d.last_location::geometry) AS driver_lng,
       d.last_location_at AS driver_location_at
     FROM trips t
     LEFT JOIN users driver ON driver.id = t.driver_id
     LEFT JOIN driver_profiles d ON d.user_id = t.driver_id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

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

  await saveUserLocation({ userId: req.user.sub, point: input.pickup, kind: "pickup" });
  await saveUserLocation({ userId: req.user.sub, point: input.dropoff, kind: "dropoff" });

  await audit({ actorId: req.user.sub, action: "trip.create", entityType: "trip", entityId: trip.id, metadata: { note: input.note || null }, ip: req.ip });
  broadcastTrip(trip.id, { type: "trip.updated", trip });
  res.status(201).json({ trip });
}));

tripsRouter.get("/driver/requests", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       t.id,
       t.status,
       t.pickup_address,
       t.dropoff_address,
       t.distance_meters,
       t.fare_amount,
       t.payment_method,
       t.created_at,
       ST_Distance(d.last_location, t.pickup_location) AS distance_to_pickup_meters
     FROM trips t
     JOIN driver_profiles d ON d.user_id = $1
       AND d.online = true
       AND d.verification_status = 'approved'
       AND d.last_location IS NOT NULL
     WHERE t.status = 'requested'
       AND t.driver_id IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM driver_trip_dismissals dismissed
         WHERE dismissed.trip_id = t.id
           AND dismissed.driver_id = $1
       )
     ORDER BY t.created_at DESC
     LIMIT 10`
    ,
    [req.user.sub]
  );
  res.json({ trips: result.rows });
}));

tripsRouter.post("/:id/reject", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id FROM trips WHERE id = $1 AND status = 'requested' AND driver_id IS NULL",
    [req.params.id]
  );
  if (!result.rows[0]) throw new HttpError(404, "Pedido no disponible");

  await query(
    `INSERT INTO driver_trip_dismissals(driver_id, trip_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [req.user.sub, req.params.id]
  );

  await audit({ actorId: req.user.sub, action: "trip.reject", entityType: "trip", entityId: req.params.id, ip: req.ip });
  res.json({ ok: true });
}));

tripsRouter.post("/:id/accept", requireAuth, requireRole("driver"), asyncHandler(async (req, res) => {
  const active = await query(
    `SELECT id FROM trips
     WHERE driver_id = $1
       AND status IN ('accepted', 'driver_arriving', 'in_progress')
     LIMIT 1`,
    [req.user.sub]
  );
  if (active.rows[0]) throw new HttpError(409, "Ya tenes un viaje activo. Finalizalo antes de aceptar otro.");

  const result = await query(
    `UPDATE trips
     SET driver_id = $2,
         status = 'accepted',
         accepted_at = now(),
         updated_at = now()
     WHERE id = $1
       AND status = 'requested'
       AND driver_id IS NULL
       AND EXISTS (
         SELECT 1
         FROM driver_profiles d
         WHERE d.user_id = $2
           AND d.online = true
           AND d.verification_status = 'approved'
       )
     RETURNING id`,
    [req.params.id, req.user.sub]
  );

  if (!result.rows[0]) throw new HttpError(409, "Este pedido ya fue tomado o no esta disponible");

  const trip = await fetchTripDetails(req.params.id);
  await audit({ actorId: req.user.sub, action: "trip.accept", entityType: "trip", entityId: req.params.id, ip: req.ip });
  broadcastTrip(req.params.id, { type: "trip.updated", trip });
  res.json({ trip });
}));

tripsRouter.get("/active", requireAuth, asyncHandler(async (req, res) => {
  const column = req.user.role === "driver" ? "driver_id" : "passenger_id";
  const result = await query(
    `SELECT
       t.*,
       ST_Y(t.pickup_location::geometry) AS pickup_lat,
       ST_X(t.pickup_location::geometry) AS pickup_lng,
       ST_Y(t.dropoff_location::geometry) AS dropoff_lat,
       ST_X(t.dropoff_location::geometry) AS dropoff_lng,
       driver.name AS driver_name,
       driver.phone AS driver_phone,
       d.vehicle_make,
       d.vehicle_model,
       d.vehicle_color,
       d.plate,
       d.rating AS driver_rating,
       ST_Y(d.last_location::geometry) AS driver_lat,
       ST_X(d.last_location::geometry) AS driver_lng,
       d.last_location_at AS driver_location_at
     FROM trips t
     LEFT JOIN users driver ON driver.id = t.driver_id
     LEFT JOIN driver_profiles d ON d.user_id = t.driver_id
     WHERE t.${column} = $1 AND t.status IN ('requested', 'accepted', 'driver_arriving', 'in_progress')
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [req.user.sub]
  );
  res.json({ trip: result.rows[0] || null });
}));

tripsRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const column = req.user.role === "driver" ? "driver_id" : "passenger_id";
  const result = await query(
    `SELECT
       id, status, pickup_address, dropoff_address, distance_meters, fare_amount, payment_method,
       passenger_rating, passenger_rating_comment, created_at, completed_at,
       ST_Y(pickup_location::geometry) AS pickup_lat,
       ST_X(pickup_location::geometry) AS pickup_lng,
       ST_Y(dropoff_location::geometry) AS dropoff_lat,
       ST_X(dropoff_location::geometry) AS dropoff_lng
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
  const trip = await fetchTripDetails(req.params.id);
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
     RETURNING id`,
    [req.params.id, input.status, input.cancellationReason || null]
  );

  const updatedTrip = await fetchTripDetails(req.params.id);
  await audit({ actorId: req.user.sub, action: `trip.${input.status}`, entityType: "trip", entityId: req.params.id, metadata: input, ip: req.ip });
  broadcastTrip(req.params.id, { type: "trip.updated", trip: updatedTrip });
  res.json({ trip: updatedTrip });
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

async function saveUserLocation({ userId, point, kind }) {
  await query(
    `WITH existing AS (
       SELECT id
       FROM user_locations
       WHERE user_id = $1
         AND lower(address) = lower($2)
       LIMIT 1
     )
     UPDATE user_locations
     SET use_count = use_count + 1,
         last_used_at = now(),
         kind = $3
     WHERE id IN (SELECT id FROM existing)`,
    [userId, point.address, kind]
  );

  await query(
    `INSERT INTO user_locations(user_id, label, address, location, kind)
     SELECT $1, $2, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5
     WHERE NOT EXISTS (
       SELECT 1 FROM user_locations WHERE user_id = $1 AND lower(address) = lower($2)
     )`,
    [userId, point.address, point.lng, point.lat, kind]
  );
}
