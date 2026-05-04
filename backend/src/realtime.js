import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

const channels = new Map();

function addClient(channel, ws) {
  const clients = channels.get(channel) || new Set();
  clients.add(ws);
  channels.set(channel, clients);
}

function removeClient(channel, ws) {
  const clients = channels.get(channel);
  if (!clients) return;
  clients.delete(ws);
  if (!clients.size) channels.delete(channel);
}

export function setupRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const tripId = url.searchParams.get("tripId");

    try {
      if (!token || !tripId) throw new Error("missing auth");
      ws.user = jwt.verify(token, config.jwtSecret);
      ws.channel = `trip:${tripId}`;
      addClient(ws.channel, ws);
      ws.send(JSON.stringify({ type: "connected", tripId }));
    } catch {
      ws.close(1008, "unauthorized");
      return;
    }

    ws.on("close", () => removeClient(ws.channel, ws));
  });

  return wss;
}

export function broadcastTrip(tripId, payload) {
  const clients = channels.get(`trip:${tripId}`);
  if (!clients) return;

  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) client.send(message);
  }
}
