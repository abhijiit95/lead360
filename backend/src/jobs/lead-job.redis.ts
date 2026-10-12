import IORedis from "ioredis";

export const leadJobsQueueName = "leadflow360-lead-jobs";

export function createLeadJobsRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for lead background jobs");
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 3_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  connection.on("error", (error) => {
    console.error("[Lead jobs] Redis connection error:", error.message);
  });
  return connection;
}
