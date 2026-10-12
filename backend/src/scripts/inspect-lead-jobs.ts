import "../config/environment.js";
import { Queue } from "bullmq";
import { createLeadJobsRedisConnection, leadJobsQueueName } from "../jobs/lead-job.redis.js";

const connection = createLeadJobsRedisConnection();
const queue = new Queue(leadJobsQueueName, { connection });

async function inspectJobs(): Promise<void> {
  try {
    const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    console.log("Lead job counts:", counts);
    const failed = await queue.getFailed(0, 9);
    console.log("Recent failed jobs:", failed.map((job) => ({
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
    })));
  } finally {
    await queue.close();
    await connection.quit();
  }
}

void inspectJobs().catch((error: unknown) => {
  console.error("Could not inspect lead jobs:", error);
  process.exitCode = 1;
});
