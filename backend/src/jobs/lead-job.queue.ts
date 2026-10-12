import { Queue } from "bullmq";
import { createLeadJobsRedisConnection, leadJobsQueueName } from "./lead-job.redis.js";
import {
  LEAD_CREATED_NOTIFICATION,
  LEAD_FOLLOWUP_REMINDER,
  readFollowupDelayMs,
  readQueueEnqueueTimeoutMs,
  type LeadJobData,
} from "./lead-job.types.js";

let connection: ReturnType<typeof createLeadJobsRedisConnection> | undefined;
let leadJobsQueue: Queue<LeadJobData> | undefined;
let closePromise: Promise<void> | undefined;

function getLeadJobsQueue(): Queue<LeadJobData> {
  if (!leadJobsQueue) {
    connection = createLeadJobsRedisConnection();
    leadJobsQueue = new Queue<LeadJobData>(leadJobsQueueName, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1_000 },
      },
    });
    leadJobsQueue.on("error", (error) => {
      console.error("[Lead jobs] Queue error:", error.message);
    });
  }
  return leadJobsQueue;
}

export async function enqueueLeadCreatedJobs(leadId: string): Promise<void> {
  if (typeof leadId !== "string" || leadId.trim().length === 0 || leadId.length > 128) {
    throw new Error("Cannot enqueue lead jobs with an invalid leadId");
  }
  const delay = readFollowupDelayMs();
  const timeoutMs = readQueueEnqueueTimeoutMs();
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getLeadJobsQueue().addBulk([
        {
          name: LEAD_CREATED_NOTIFICATION,
          data: { leadId },
          opts: { jobId: `lead-created-${leadId}` },
        },
        {
          name: LEAD_FOLLOWUP_REMINDER,
          data: { leadId },
          opts: { jobId: `lead-followup-${leadId}`, delay },
        },
      ]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Queue insertion timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    console.log(`[Lead jobs] Enqueued notification and follow-up for lead ${leadId}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function closeLeadJobsQueue(): Promise<void> {
  if (!leadJobsQueue || !connection) return;
  closePromise ??= (async () => {
    await leadJobsQueue?.close();
    if (connection?.status === "ready") {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    } else {
      connection.disconnect();
    }
  })();
  await closePromise;
}
