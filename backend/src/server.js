import http from "http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { setupRealtime } from "./realtime.js";

export function startServer() {
  const app = createApp();
  const server = http.createServer(app);

  setupRealtime(server);

  server.listen(config.port, () => {
    console.log(`LocalRide API listening on http://localhost:${config.port}`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
