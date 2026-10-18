import "./config/environment.js";
import { Worker } from "bullmq";
import { pool } from "./config/database.js";
import { disconnectMongoDB, connectMongoDB } from "./config/mongodb.js";
import { closeMySqlPool, testMySqlConnection } from "./config/mysql.js";
import { leadDatabaseType, leadRepository } from "./repositories/lead-repository.factory.js";
import { sendLeadCreatedNotification, sendLeadFollowupReminder } from "./services/mock-notification.service.js";
import { createLeadJobsRedisConnection, leadJobsQueueName } from "./jobs/lead-job.redis.js";
import { processLeadJob } from "./jobs/lead-job.processor.js";
import { readWorkerConcurrency } from "./jobs/lead-job.types.js";
import { clearWorkerHeartbeat, updateWorkerHeartbeat } from "./jobs/worker-health.js";

async function startWorker(): Promise<void> {
  await pool.query("SELECT 1");
  if (leadDatabaseType === "mysql") await testMySqlConnection();
  if (leadDatabaseType === "mongodb") await connectMongoDB();
  const concurrency = readWorkerConcurrency();
  const connection = createLeadJobsRedisConnection();
  let worker: Worker | undefined;
  let redisReady = false;
  let bullMqReady = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  connection.on("ready", () => { redisReady = true; });
  connection.on("close", () => { redisReady = false; });
  connection.on("reconnecting", () => { redisReady = false; });
  worker = new Worker(
    leadJobsQueueName,
    (job) => processLeadJob(job, {
      leadRepository,
      sendLeadCreatedNotification,
      sendLeadFollowupReminder,
    }),
    { connection, concurrency },
  );

  worker.on("active", (job) => console.log(`[Lead jobs] Started ${job.name} (${job.id})`));
  worker.on("completed", (job) => console.log(`[Lead jobs] Completed ${job.name} (${job.id})`));
  worker.on("failed", (job, error) => {
    console.error(`[Lead jobs] Failed ${job?.name ?? "unknown job"} (${job?.id ?? "unknown id"}): ${error.message}`);
  });
  worker.on("ready", () => { bullMqReady = true; });
  worker.on("error", (error) => {
    bullMqReady = false;
    console.error("[Lead jobs] Worker error:", error.message);
  });

  try {
    let startupTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        worker.waitUntilReady(),
        new Promise<never>((_resolve, reject) => {
          startupTimeout = setTimeout(() => reject(new Error("BullMQ Redis readiness timed out")), 30_000);
        }),
      ]);
    } finally {
      if (startupTimeout) clearTimeout(startupTimeout);
    }
    redisReady = connection.status === "ready";
    bullMqReady = true;
    await updateWorkerHeartbeat(redisReady && bullMqReady && worker.isRunning());
    heartbeatTimer = setInterval(() => {
      void updateWorkerHeartbeat(redisReady && bullMqReady && worker.isRunning()).catch(() => {
        console.error("[Lead jobs] Could not update worker health state");
      });
    }, 10_000);
    heartbeatTimer.unref();
  } catch (error) {
    await Promise.allSettled([worker.close(), clearWorkerHeartbeat()]);
    connection.disconnect();
    throw error;
  }
  console.log(`[Lead jobs] Worker listening on ${leadJobsQueueName}`);

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      console.log("[Lead jobs] Shutting down worker");
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await clearWorkerHeartbeat();
      await worker.close();
      await connection.quit();
      await Promise.allSettled([pool.end(), closeMySqlPool(), disconnectMongoDB()]);
    })();
    return closing;
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void close().finally(() => process.exit(0)));
  }
}

void startWorker().catch(async (error: unknown) => {
  console.error("[Lead jobs] Worker failed to start:", error instanceof Error ? error.message : "unknown error");
  await clearWorkerHeartbeat();
  await Promise.allSettled([pool.end(), closeMySqlPool(), disconnectMongoDB()]);
  process.exitCode = 1;
});
