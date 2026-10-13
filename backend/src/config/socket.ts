import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/access-token.js";
import type {
  ClientToServerEvents,
  InterServerEvents,
  LeadDeletedEventPayload,
  LeadEventPayload,
  ServerToClientEvents,
  SocketData,
} from "../realtime/lead-events.js";

export const leadsReadRoom = "leads:read";
export type LeadSocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let socketServer: LeadSocketServer | undefined;

export function attachSocketServer(httpServer: HttpServer): LeadSocketServer {
  if (socketServer) throw new Error("Socket.IO has already been attached to an HTTP server");

  const io: LeadSocketServer = new Server(httpServer, {
    // Keep the transport payloads small and prevent unlimited incoming messages.
    maxHttpBufferSize: 1_000_000,
  });

  io.use((socket, next) => {
    const authToken: unknown = socket.handshake.auth?.token;
    const authorization = socket.handshake.headers.authorization;
    const bearerMatch = authorization?.match(/^Bearer\s+(\S+)$/i);
    const token = typeof authToken === "string" ? authToken : bearerMatch?.[1];
    const user = token ? verifyAccessToken(token) : null;

    if (!user) {
      next(new Error("unauthorized"));
      return;
    }

    // Both roles are permitted to read leads by the existing REST routes.
    socket.data.userId = user.id;
    socket.data.role = user.role;
    next();
  });

  io.on("connection", (socket) => {
    // Clients cannot request arbitrary user/team rooms. Membership is chosen
    // server-side only after JWT verification and read-role authorization.
    void socket.join(leadsReadRoom);
    console.log(`[Socket.IO] Authenticated ${socket.data.role} connected`);
    socket.on("disconnect", (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${reason}`);
    });
    socket.on("error", (error) => {
      console.error("[Socket.IO] Client socket error:", error.message);
    });
  });

  io.engine.on("connection_error", (error) => {
    console.warn(`[Socket.IO] Connection error (${error.code}): ${error.message}`);
  });

  socketServer = io;
  return io;
}

function getSocketServer(): LeadSocketServer | undefined {
  return socketServer;
}

function publish(event: "lead:created" | "lead:updated", payload: LeadEventPayload): void;
function publish(event: "lead:deleted", payload: LeadDeletedEventPayload): void;
function publish(
  event: "lead:created" | "lead:updated" | "lead:deleted",
  payload: LeadEventPayload | LeadDeletedEventPayload,
): void {
  const io = getSocketServer();
  if (!io) return;
  try {
    if (event === "lead:created") {
      io.to(leadsReadRoom).emit(event, payload as LeadEventPayload);
    } else if (event === "lead:updated") {
      io.to(leadsReadRoom).emit(event, payload as LeadEventPayload);
    } else {
      io.to(leadsReadRoom).emit(event, payload as LeadDeletedEventPayload);
    }
  } catch (error) {
    // A realtime transport problem must not undo a committed REST operation.
    console.error("[Socket.IO] Could not publish lead event:", error);
  }
}

export const emitLeadCreated = (payload: LeadEventPayload): void => publish("lead:created", payload);
export const emitLeadUpdated = (payload: LeadEventPayload): void => publish("lead:updated", payload);
export const emitLeadDeleted = (payload: LeadDeletedEventPayload): void => publish("lead:deleted", payload);

/** io.close also closes the attached HTTP server, so it owns API shutdown. */
export async function closeSocketServer(): Promise<void> {
  const io = socketServer;
  socketServer = undefined;
  if (!io) return;
  await new Promise<void>((resolve) => io.close(() => resolve()));
}
