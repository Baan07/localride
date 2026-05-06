import crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { HttpError, asyncHandler } from "../errors.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../services/audit.js";

export const paymentsRouter = Router();

function mercadoPagoClient() {
  if (!config.mpAccessToken) throw new HttpError(503, "Mercado Pago no esta configurado");
  return new MercadoPagoConfig({ accessToken: config.mpAccessToken });
}

paymentsRouter.post("/checkout-pro", requireAuth, asyncHandler(async (req, res) => {
  const input = z.object({ tripId: z.string().uuid() }).parse(req.body);
  const tripResult = await query("SELECT * FROM trips WHERE id = $1 AND passenger_id = $2", [input.tripId, req.user.sub]);
  const trip = tripResult.rows[0];
  if (!trip) throw new HttpError(404, "Viaje no encontrado");
  if (trip.payment_method !== "mercado_pago") throw new HttpError(422, "El viaje no usa Mercado Pago");

  const preference = new Preference(mercadoPagoClient());
  let response;
  try {
    response = await preference.create({
      body: {
        external_reference: trip.id,
        notification_url: `${config.publicBaseUrl}/api/payments/webhooks/mercado-pago?source_news=webhooks`,
        back_urls: {
          success: `${config.frontendUrl}/payments/success`,
          failure: `${config.frontendUrl}/payments/failure`,
          pending: `${config.frontendUrl}/payments/pending`
        },
        items: [
          {
            id: trip.id,
            title: `Viaje Rio Movil ${trip.pickup_address} - ${trip.dropoff_address}`,
            quantity: 1,
            currency_id: "ARS",
            unit_price: Number(trip.fare_amount)
          }
        ]
      }
    });
  } catch (error) {
    const mpMessage = error?.message || error?.cause?.message || "Mercado Pago rechazo la preferencia";
    console.error("Mercado Pago preference failed", {
      message: mpMessage,
      status: error?.status,
      cause: error?.cause,
      details: error?.details
    });
    throw new HttpError(502, `Mercado Pago: ${mpMessage}`);
  }

  if (!response.init_point && !response.sandbox_init_point) {
    console.error("Mercado Pago preference without checkout URL", response);
    throw new HttpError(502, "Mercado Pago no devolvio URL de checkout");
  }

  await query(
    `INSERT INTO payments(trip_id, provider, preference_id, init_point, status, amount, raw_payload)
     VALUES ($1, 'mercado_pago', $2, $3, 'pending', $4, $5)
     ON CONFLICT DO NOTHING`,
    [trip.id, response.id, response.init_point, trip.fare_amount, response]
  );

  await audit({ actorId: req.user.sub, action: "payment.preference_created", entityType: "trip", entityId: trip.id, ip: req.ip });
  res.json({ preferenceId: response.id, initPoint: response.init_point, sandboxInitPoint: response.sandbox_init_point });
}));

paymentsRouter.post("/webhooks/mercado-pago", asyncHandler(async (req, res) => {
  if (!isValidMercadoPagoSignature(req)) {
    throw new HttpError(401, "Firma de webhook invalida");
  }

  const eventId = String(req.body.id || req.query.id || crypto.randomUUID());
  const topic = String(req.body.type || req.query.type || "unknown");

  await query(
    `INSERT INTO webhook_events(id, provider, topic, payload)
     VALUES ($1, 'mercado_pago', $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [eventId, topic, req.body]
  );

  res.status(200).json({ received: true });
  processMercadoPagoWebhook(req.body).catch((error) => console.error("mp webhook processing failed", error));
}));

function isValidMercadoPagoSignature(req) {
  if (!config.mpWebhookSecret) return config.nodeEnv !== "production";
  const signature = req.get("x-signature");
  if (!signature) return false;

  const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=")));
  if (!parts.ts || !parts.v1) return false;

  const dataId = req.body?.data?.id || req.query?.["data.id"] || req.query?.id || "";
  const manifest = `id:${dataId};request-id:${req.get("x-request-id") || ""};ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", config.mpWebhookSecret).update(manifest).digest("hex");
  if (expected.length !== parts.v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

async function processMercadoPagoWebhook(body) {
  if (body.type !== "payment" || !body.data?.id || !config.mpAccessToken) return;

  const paymentClient = new Payment(mercadoPagoClient());
  const payment = await paymentClient.get({ id: body.data.id });
  const tripId = payment.external_reference;
  if (!tripId) return;

  const statusMap = {
    approved: "approved",
    rejected: "rejected",
    refunded: "refunded",
    pending: "pending",
    in_process: "pending"
  };
  const status = statusMap[payment.status] || "pending";

  await query(
    `UPDATE payments
     SET provider_reference = $2,
         status = $3,
         raw_payload = $4,
         updated_at = now()
     WHERE trip_id = $1`,
    [tripId, String(payment.id), status, payment]
  );

  await query("UPDATE webhook_events SET processed_at = now() WHERE id = $1", [String(body.id)]);
}
