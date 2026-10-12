import "./config/environment.js";
import { Worker } from "bullmq";
import { initializeDatabase, pool } from "./config/database.js";
import { disconnectMongoDB, connectMongoDB } from "./config/mongodb.js";
import { mysqlPool, testMySqlConnection } from "./config/mysql.js";
import { initializeMySqlSchema } from "./config/mysql-schema.js";
import { leadDatabaseType, leadRepository } from "./repositories/lead-repository.factory.js";
import { sendLeadCreatedNotification, sendLeadFollowupReminder } from "./services/mock-notification.service.js";
import { createLeadJobsRedisConnection, leadJobsQueueName } from "./jobs/lead-job.redis.js";
import { processLeadJob } from "./jobs/lead-job.processor.js";
import { readWorkerConcurrency } from "./jobs/lead-job.types.js";

async function initializeSelectedDatabase(): Promise<void> {
  await initializeDatabase();
  if (leadDatabaseType === "mysql") {
    await testMySqlConnection();
    await initializeMySqlSchema();
  } else if (leadDatabaseType === "mongodb") {
    await connectMongoDB();
  }
}

async function startWorker(): Promise<void> {
  await initializeSelectedDatabase();
  const concurrency = readWorkerConcurrency();
  const connection = createLeadJobsRedisConnection();
  const worker = new Worker(
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
  worker.on("error", (error) => console.error("[Lead jobs] Worker error:", error.message));
  console.log(`[Lead jobs] Worker listening on ${leadJobsQueueName}`);

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      console.log("[Lead jobs] Shutting down worker");
      await worker.close();
      await connection.quit();
      await Promise.allSettled([pool.end(), mysqlPool.end(), disconnectMongoDB()]);
    })();
    return closing;
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void close().finally(() => process.exit(0)));
  }
}

void startWorker().catch(async (error: unknown) => {
  console.error("[Lead jobs] Worker failed to start:", error);
  await Promise.allSettled([pool.end(), mysqlPool.end(), disconnectMongoDB()]);
  process.exitCode = 1;
});
