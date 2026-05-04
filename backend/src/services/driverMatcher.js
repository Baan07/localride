import { query } from "../db.js";

export async function findNearbyDrivers({ lat, lng, radiusMeters = 8000 }) {
  const result = await query(
    `SELECT
       u.id,
       u.name,
       u.phone,
       d.vehicle_make,
       d.vehicle_model,
       d.vehicle_color,
       d.plate,
       d.rating,
       ST_Y(d.last_location::geometry) AS lat,
       ST_X(d.last_location::geometry) AS lng,
       ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
     FROM driver_profiles d
     JOIN users u ON u.id = d.user_id
     WHERE d.online = true
       AND d.verification_status = 'approved'
       AND d.last_location IS NOT NULL
       AND ST_DWithin(d.last_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ORDER BY distance_meters ASC
     LIMIT 10`,
    [lng, lat, radiusMeters]
  );

  return result.rows;
}

export async function assignNearestDriver({ lat, lng, client }) {
  const result = await client.query(
    `SELECT u.id
     FROM driver_profiles d
     JOIN users u ON u.id = d.user_id
     WHERE d.online = true
       AND d.verification_status = 'approved'
       AND d.last_location IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM trips t
         WHERE t.driver_id = u.id
           AND t.status IN ('accepted', 'driver_arriving', 'in_progress')
       )
     ORDER BY ST_Distance(d.last_location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
     LIMIT 1
     FOR UPDATE OF d SKIP LOCKED`,
    [lng, lat]
  );

  return result.rows[0]?.id || null;
}
