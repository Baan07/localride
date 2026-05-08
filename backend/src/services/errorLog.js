import { query } from "../db.js";

export async function logError({ actorId, method, path, status, message, stack, ip, userAgent }) {
  await query(
    `INSERT INTO error_logs(actor_id, method, path, status, message, stack, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actorId || null, method || null, path || null, status, message, stack || null, ip || null, userAgent || null]
  );
}
