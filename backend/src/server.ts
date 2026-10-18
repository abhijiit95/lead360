import "./config/environment.js";
import { createServer, type Server as HttpServer } from "node:http";
import { app } from "./app.js";
import { initializeDatabase, pool } from "./config/database.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { closeMySqlPool, testMySqlConnection } from "./config/mysql.js";
import { initializeMySqlSchema } from "./config/mysql-schema.js";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb.js";
import { leadDatabaseType } from "./repositories/lead-repository.factory.js";
import { closeLeadJobsQueue } from "./jobs/lead-job.queue.js";
import { attachSocketServer, closeSocketServer } from "./config/socket.js";
import { prepareApiDatabases } from "./startup/database-startup.js";

const port = Number(process.env.PORT) || 4000;
let httpServer: HttpServer | undefined;

async function startServer(): Promise<void> {
  try {
    await prepareApiDatabases({
      production: process.env.NODE_ENV === "production",
      leadDatabaseType,
      verifyPostgres: () => pool.query("SELECT 1"),
      initializePostgres: initializeDatabase,
      verifyMySql: testMySqlConnection,
      initializeMySql: initializeMySqlSchema,
      connectMongo: connectMongoDB,
      warn: (message) => console.warn(message),
    });
    await connectRedis();
    httpServer = createServer(app);
    attachSocketServer(httpServer);
    await new Promise<void>((resolve, reject) => {
      httpServer?.once("error", reject);
      httpServer?.listen(port, () => {
        httpServer?.removeListener("error", reject);
        console.log(`LeadFlow360 API listening on port ${port}`);
        resolve();
      });
    });
  } catch (error) {
    console.error("Failed to start LeadFlow360 API:", error);
    await Promise.allSettled([closeSocketServer(), pool.end(), closeMySqlPool(), disconnectRedis(), disconnectMongoDB(), closeLeadJobsQueue()]);
    process.exitCode = 1;
  }
}

void startServer();

let isShuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Received ${signal}; shutting down LeadFlow360 API`);

    const closeResources = async (): Promise<void> => {
      await Promise.allSettled([closeSocketServer(), pool.end(), closeMySqlPool(), disconnectRedis(), disconnectMongoDB(), closeLeadJobsQueue()]);
      process.exit(0);
    };

    void closeResources();
  });
}
