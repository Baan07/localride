import http from "http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { setupRealtime } from "./realtime.js";

const app = createApp();
const server = http.createServer(app);

setupRealtime(server);

server.listen(config.port, () => {
  console.log(`LocalRide API listening on http://localhost:${config.port}`);
});
