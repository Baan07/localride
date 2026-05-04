import { query } from "../db.js";

export async function audit({ actorId, action, entityType, entityId, metadata = {}, ip }) {
  await query(
    `INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId || null, action, entityType, entityId || null, metadata, ip || null]
  );
}
