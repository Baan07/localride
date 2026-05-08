import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../db.js";
import { HttpError, asyncHandler } from "../errors.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { audit } from "../services/audit.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(["passenger", "driver"]).default("passenger"),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  vehicleColor: z.string().optional(),
  plate: z.string().optional()
}).superRefine((input, ctx) => {
  if (input.role !== "driver") return;
  [
    ["vehicleMake", "Marca del vehiculo"],
    ["vehicleModel", "Modelo del vehiculo"],
    ["vehicleColor", "Color del vehiculo"],
    ["plate", "Patente"]
  ].forEach(([field, label]) => {
    if (!input[field]?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${label} es obligatorio para conductores` });
    }
  });
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO users(name, email, password_hash, phone, role)
       VALUES ($1, lower($2), $3, $4, $5)
       RETURNING id, name, email, phone, role`,
      [input.name, input.email, passwordHash, input.phone || null, input.role]
    );

    const created = result.rows[0];
    if (input.role === "driver") {
      await client.query(
        `INSERT INTO driver_profiles(user_id, vehicle_make, vehicle_model, vehicle_color, plate)
         VALUES ($1, $2, $3, $4, upper($5))`,
        [
          created.id,
          input.vehicleMake.trim(),
          input.vehicleModel.trim(),
          input.vehicleColor.trim(),
          input.plate.trim()
        ]
      );
    }

    return created;
  });
  await audit({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id, ip: req.ip });
  res.status(201).json({ user, token: signToken(user) });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
  const result = await query("SELECT * FROM users WHERE email = lower($1)", [input.email]);
  const user = result.rows[0];

  if (user?.blocked_at) {
    throw new HttpError(403, "Usuario bloqueado. Contacta al administrador.");
  }

  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    throw new HttpError(401, "Email o contrasena incorrectos");
  }

  await audit({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, ip: req.ip });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    token: signToken(user)
  });
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT id, name, email, phone, role, blocked_at FROM users WHERE id = $1", [req.user.sub]);
  if (!result.rows[0]) throw new HttpError(404, "Usuario no encontrado");
  res.json({ user: result.rows[0] });
}));

authRouter.patch("/me", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().max(40).optional()
  }).parse(req.body);

  const result = await query(
    `UPDATE users
     SET name = $2,
         email = lower($3),
         phone = $4,
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, email, phone, role`,
    [req.user.sub, input.name.trim(), input.email.trim(), input.phone?.trim() || null]
  );

  await audit({ actorId: req.user.sub, action: "auth.profile_update", entityType: "user", entityId: req.user.sub, ip: req.ip });
  res.json({ user: result.rows[0], token: signToken(result.rows[0]) });
}));
