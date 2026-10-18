import express from "express";
import { authRouter } from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { leadRouter } from "./routes/lead.routes.js";
import { oauthRouter } from "./routes/oauth.routes.js";
import { oidcRouter } from "./routes/oidc.routes.js";
import { createReadinessCheck } from "./health/readiness.js";
import { pool } from "./config/database.js";
import { getMySqlPool } from "./config/mysql.js";
import { pingMongoDB } from "./config/mongodb.js";
import { redisClient } from "./config/redis.js";
import { leadDatabaseType } from "./repositories/lead-repository.factory.js";

export const app = express();
app.set("json spaces", 2);

const checkReadiness = createReadinessCheck(leadDatabaseType, {
  postgres: async () => { await pool.query("SELECT 1"); },
  redis: async () => {
    if (!redisClient?.isReady) throw new Error("Redis is not ready");
    await redisClient.ping();
  },
  mysql: async () => { await getMySqlPool().query("SELECT 1"); },
  mongodb: pingMongoDB,
});

// Restrict credentialed browser requests to the configured frontend origin.
app.use((request, response, next) => {
  const origin = request.header("Origin");
  const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  if (origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    if (origin !== allowedOrigin) {
      response.status(403).end();
      return;
    }
    response.status(204).end();
    return;
  }
  next();
});

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "leadflow360-api" });
});

app.get("/api/health/ready", async (_request, response) => {
  const ready = await checkReadiness();
  response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
});

app.use("/api/auth", authRouter);
app.use("/api/oauth", oauthRouter);
app.use("/api/oidc", oidcRouter);
app.use("/api/leads", leadRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});

app.use(errorHandler);
