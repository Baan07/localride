import { query } from "../db.js";

export async function estimateFare({ pickup, dropoff }) {
  const fareRule = await query("SELECT * FROM fare_rules WHERE active = true ORDER BY created_at DESC LIMIT 1");
  const rule = fareRule.rows[0];

  const geo = await query(
    `SELECT
       ST_Distance(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
       ) AS distance_meters`,
    [pickup.lng, pickup.lat, dropoff.lng, dropoff.lat]
  );

  const distanceMeters = Math.max(1000, Math.round(Number(geo.rows[0].distance_meters)));
  const durationSeconds = Math.round((distanceMeters / 1000) * 180);
  const distanceKm = distanceMeters / 1000;
  const minutes = durationSeconds / 60;
  const amount = Math.round(Number(rule.base_fare) + distanceKm * Number(rule.price_per_km) + minutes * Number(rule.price_per_minute));
  const platformFee = Math.round(amount * (Number(rule.platform_fee_percent) / 100));

  return {
    city: rule.city,
    distanceMeters,
    durationSeconds,
    amount,
    platformFee,
    currency: "ARS"
  };
}
