import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { HttpError } from "../errors.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "No autenticado");

  try {
    req.user = jwt.verify(header.slice(7), config.jwtSecret);
    return next();
  } catch {
    throw new HttpError(401, "Sesion invalida o vencida");
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
