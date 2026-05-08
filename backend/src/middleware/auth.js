import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { query } from "../db.js";
import { HttpError } from "../errors.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "No autenticado");

    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    const result = await query("SELECT id, role, blocked_at FROM users WHERE id = $1", [payload.sub]);
    const user = result.rows[0];
    if (!user) throw new HttpError(401, "Sesion invalida o vencida");
    if (user.blocked_at) throw new HttpError(403, "Usuario bloqueado. Contacta al administrador.");
    req.user = { ...payload, role: user.role };
    return next();
  } catch (err) {
    return next(err instanceof HttpError ? err : new HttpError(401, "Sesion invalida o vencida"));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      throw new HttpError(403, "No tenes permisos para esta accion");
    }
    return next();
  };
}
