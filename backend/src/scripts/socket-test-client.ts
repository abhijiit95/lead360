import "../config/environment.js";
import { io } from "socket.io-client";

const serverUrl = process.env.SOCKET_URL ?? "http://localhost:4000";
const token = process.env.SOCKET_TEST_TOKEN;
if (!token) {
  throw new Error("Set SOCKET_TEST_TOKEN to an access token returned by /api/auth/login");
}

const socket = io(serverUrl, {
  auth: { token },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5_000,
});

socket.on("connect", () => console.log(`[Socket test client] Connected (${socket.id})`));
socket.on("disconnect", (reason) => console.log(`[Socket test client] Disconnected: ${reason}`));
socket.on("connect_error", (error) => console.error(`[Socket test client] Connection rejected/failed: ${error.message}`));
socket.on("lead:created", (lead) => console.log("lead:created", JSON.stringify(lead)));
socket.on("lead:updated", (lead) => console.log("lead:updated", JSON.stringify(lead)));
socket.on("lead:deleted", (lead) => console.log("lead:deleted", JSON.stringify(lead)));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    socket.disconnect();
    process.exit(0);
  });
}
