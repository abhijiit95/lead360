import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import { io as createClient, type Socket } from "socket.io-client";
import type { Lead, LeadRepository } from "../src/repositories/lead.repository.js";

// Keep unit tests independent from local infrastructure and secret files.
process.env.JWT_SECRET ??= "socket-test-secret-that-is-longer-than-thirty-two-bytes";
process.env.JWT_EXPIRES_IN ??= "1h";
process.env.DATABASE_HOST ??= "localhost";
process.env.DATABASE_PORT ??= "5432";
process.env.DATABASE_NAME ??= "leadflow360_test";
process.env.DATABASE_USER ??= "leadflow360_test";
process.env.DATABASE_PASSWORD ??= "leadflow360_test";
process.env.MYSQL_HOST ??= "localhost";
process.env.MYSQL_PORT ??= "3306";
process.env.MYSQL_DATABASE ??= "leadflow360_test";
process.env.MYSQL_USER ??= "leadflow_test";
process.env.MYSQL_PASSWORD ??= "leadflow_test";
process.env.LEADS_CACHE_TTL_SECONDS ??= "60";

const httpServer = createServer();
let attachSocketServer: typeof import("../src/config/socket.js").attachSocketServer;
let closeSocketServer: typeof import("../src/config/socket.js").closeSocketServer;
let leadsReadRoom: string;
let jwtSecret: string;
let createLeadService: typeof import("../src/services/lead.service.js").createLeadService;
let socketServer: import("../src/config/socket.js").LeadSocketServer;
let serverUrl = "";

before(async () => {
  const socketModule = await import("../src/config/socket.js");
  const authModule = await import("../src/config/auth.js");
  const leadServiceModule = await import("../src/services/lead.service.js");
  attachSocketServer = socketModule.attachSocketServer;
  closeSocketServer = socketModule.closeSocketServer;
  leadsReadRoom = socketModule.leadsReadRoom;
  jwtSecret = authModule.jwtSecret;
  createLeadService = leadServiceModule.createLeadService;
  socketServer = attachSocketServer(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      const address = httpServer.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await closeSocketServer();
});

function token(role: "admin" | "agent", id = `user-${role}`): string {
  return jwt.sign(
    { name: "Socket Test", email: "socket-test@example.test", role },
    jwtSecret,
    { algorithm: "HS256", subject: id, expiresIn: "1h" },
  );
}

function connect(accessToken: string): Promise<Socket> {
  const client = createClient(serverUrl, { auth: { token: accessToken }, reconnection: false });
  return new Promise((resolve, reject) => {
    client.once("connect", () => resolve(client));
    client.once("connect_error", (error) => reject(error));
  });
}

const lead: Lead = {
  id: "lead-realtime-test",
  name: "Private Name",
  email: "private@example.test",
  phone: "5550100",
  source: "website",
  status: "new",
  created_at: new Date("2026-10-12T10:00:00.000Z"),
  updated_at: new Date("2026-10-12T10:00:00.000Z"),
};

function repository(overrides: Partial<LeadRepository> = {}): LeadRepository {
  return {
    create: async () => lead,
    findAll: async () => ({ data: [lead], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }),
    findById: async () => lead,
    update: async () => ({ ...lead, status: "contacted" }),
    delete: async () => true,
    ...overrides,
  };
}

test("accepts verified admin and agent JWTs and puts them only in the authorized leads room", async () => {
  for (const role of ["admin", "agent"] as const) {
    const userId = `verified-${role}`;
    const client = await connect(token(role, userId));
    try {
      const serverSocket = socketServer.sockets.sockets.get(client.id);
      assert.equal(serverSocket?.data.userId, userId);
      assert.equal(serverSocket?.data.role, role);
      assert.equal(serverSocket?.rooms.has(leadsReadRoom), true);
      assert.deepEqual([...serverSocket!.rooms].sort(), [client.id, leadsReadRoom].sort());

      // There is no client-controlled room-join event; attempts do not create
      // membership in arbitrary user/team rooms.
      client.emit("room:join", `user:${userId}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(serverSocket?.rooms.has(`user:${userId}`), false);
    } finally {
      client.disconnect();
    }
  }
});

test("rejects missing, malformed, and invalid JWT credentials", async () => {
  for (const auth of [{}, { token: "not-a-jwt" }]) {
    const client = createClient(serverUrl, { auth, reconnection: false });
    const error = await new Promise<Error>((resolve) => client.once("connect_error", resolve));
    assert.match(error.message, /unauthorized/);
    client.close();
  }
});

test("publishes sanitized lead events after successful create, update, and delete", async () => {
  const client = await connect(token("admin"));
  let persisted = false;
  const ordering: string[] = [];
  const repo = repository({
    create: async () => { persisted = true; ordering.push("created"); return lead; },
    update: async () => { persisted = true; ordering.push("updated"); return { ...lead, status: "contacted" }; },
    delete: async () => { persisted = true; ordering.push("deleted"); return true; },
  });
  const service = createLeadService({
    repository: repo,
    invalidateLeadLists: async () => undefined,
    enqueueLeadCreatedJobs: async () => undefined,
  });

  try {
    const created = new Promise<Record<string, unknown>>((resolve) => client.once("lead:created", resolve));
    await service.createLead({ name: lead.name, email: lead.email, phone: lead.phone, source: lead.source });
    const createdPayload = await created;
    assert.equal(persisted, true);
    assert.equal(createdPayload.id, lead.id);
    assert.equal(createdPayload.status, "new");
    assert.equal("email" in createdPayload, false);
    assert.equal("phone" in createdPayload, false);
    assert.equal("name" in createdPayload, false);

    persisted = false;
    const updated = new Promise<Record<string, unknown>>((resolve) => client.once("lead:updated", resolve));
    await service.updateLead(lead.id, { status: "contacted" });
    assert.equal((await updated).status, "contacted");
    assert.equal(persisted, true);

    persisted = false;
    const deleted = new Promise<{ id: string }>((resolve) => client.once("lead:deleted", resolve));
    await service.deleteLead(lead.id);
    assert.deepEqual(await deleted, { id: lead.id });
    assert.equal(persisted, true);
    assert.deepEqual(ordering, ["created", "updated", "deleted"]);
  } finally {
    client.disconnect();
  }
});

test("emits no lead event when create, update, or delete persistence fails", async () => {
  const client = await connect(token("agent"));
  const received: string[] = [];
  client.on("lead:created", () => received.push("created"));
  client.on("lead:updated", () => received.push("updated"));
  client.on("lead:deleted", () => received.push("deleted"));
  const databaseError = new Error("database unavailable");
  const service = createLeadService({
    repository: repository({
      create: async () => { throw databaseError; },
      update: async () => { throw databaseError; },
      delete: async () => { throw databaseError; },
    }),
    invalidateLeadLists: async () => undefined,
    enqueueLeadCreatedJobs: async () => undefined,
  });

  try {
    await assert.rejects(service.createLead({ name: lead.name, email: lead.email, phone: lead.phone, source: lead.source }), databaseError);
    await assert.rejects(service.updateLead(lead.id, { status: "contacted" }), databaseError);
    await assert.rejects(service.deleteLead(lead.id), databaseError);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(received, []);
  } finally {
    client.disconnect();
  }
});

test("disconnects clients and removes them from the leads room", async () => {
  const client = await connect(token("agent", "disconnect-test"));
  const clientId = client.id;
  const serverSocket = socketServer.sockets.sockets.get(clientId)!;
  assert.equal(socketServer.sockets.adapter.rooms.get(leadsReadRoom)?.has(clientId), true);
  const disconnected = new Promise<void>((resolve) => serverSocket.once("disconnect", () => resolve()));
  client.disconnect();
  await disconnected;
  assert.equal(socketServer.sockets.sockets.has(clientId), false);
  assert.equal(socketServer.sockets.adapter.rooms.get(leadsReadRoom)?.has(clientId), undefined);
});
