import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { createLeadJobsRedisConnection, leadJobsQueueName } from "../src/jobs/lead-job.redis.js";
import { closeLeadJobsQueue, enqueueLeadCreatedJobs } from "../src/jobs/lead-job.queue.js";
import { LEAD_CREATED_NOTIFICATION, LEAD_FOLLOWUP_REMINDER } from "../src/jobs/lead-job.types.js";
import { processLeadJob } from "../src/jobs/lead-job.processor.js";
import type { Lead } from "../src/repositories/lead.repository.js";

async function removeAfterProcessing(queue: Queue, jobId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state !== "active") {
      await job.remove();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting to clean up test job ${jobId}`);
}

test("producer inserts one notification and one delayed reminder into Redis", async (context) => {
  if (!process.env.REDIS_URL) {
    context.skip("REDIS_URL is not configured");
    return;
  }
  const redisConnection = createLeadJobsRedisConnection();
  const queue = new Queue(leadJobsQueueName, { connection: redisConnection });
  const leadId = `integration-${randomUUID()}`;
  const notificationId = `lead-created-${leadId}`;
  const reminderId = `lead-followup-${leadId}`;
  process.env.LEAD_FOLLOWUP_DELAY_SECONDS = "3600";

  try {
    await enqueueLeadCreatedJobs(leadId);
    const notification = await queue.getJob(notificationId);
    const reminder = await queue.getJob(reminderId);
    assert.ok(notification, "notification job should exist");
    assert.ok(reminder, "follow-up job should exist");
    assert.equal(notification.name, LEAD_CREATED_NOTIFICATION);
    assert.equal(reminder.name, LEAD_FOLLOWUP_REMINDER);
    assert.equal(notification.data.leadId, leadId);
    assert.equal(reminder.data.leadId, leadId);
    assert.equal(notification.opts.attempts, 5);
    assert.equal(notification.opts.backoff?.type, "exponential");
    assert.equal(await reminder.getState(), "delayed");
  } finally {
    await Promise.all([
      removeAfterProcessing(queue, notificationId),
      removeAfterProcessing(queue, reminderId),
    ]);
    await queue.close();
    await redisConnection.quit();
    await closeLeadJobsQueue();
  }
});

test("BullMQ retries a failing job and completes it on a later attempt", async (context) => {
  if (!process.env.REDIS_URL) {
    context.skip("REDIS_URL is not configured");
    return;
  }
  const queueName = `leadflow360-retry-test-${randomUUID()}`;
  const producerConnection = createLeadJobsRedisConnection();
  const workerConnection = createLeadJobsRedisConnection();
  const queue = new Queue(queueName, { connection: producerConnection });
  let attempts = 0;
  const worker = new Worker(queueName, async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary test failure");
  }, { connection: workerConnection });
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("retry test timed out")), 10_000);
    worker.once("completed", () => {
      clearTimeout(timeout);
      resolve();
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  try {
    await worker.waitUntilReady();
    await queue.add("retry-test", {}, { attempts: 3, backoff: { type: "exponential", delay: 10 } });
    await completed;
    assert.equal(attempts, 3);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([producerConnection.quit(), workerConnection.quit()]);
  }
});

test("a BullMQ worker passes a queued notification through the lead processor", async (context) => {
  if (!process.env.REDIS_URL) {
    context.skip("REDIS_URL is not configured");
    return;
  }
  const queueName = `leadflow360-worker-test-${randomUUID()}`;
  const connection = createLeadJobsRedisConnection();
  const queueConnection = createLeadJobsRedisConnection();
  const queue = new Queue(queueName, { connection: queueConnection });
  const lead: Lead = {
    id: `worker-${randomUUID()}`,
    name: "Worker test lead",
    email: "worker-test@example.test",
    phone: "0000000000",
    source: "integration-test",
    status: "new",
    created_at: new Date(),
    updated_at: new Date(),
  };
  let notifiedLead: Lead | undefined;
  let jobId = "";
  let resolveCompleted!: () => void;
  let rejectCompleted!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("worker processor test timed out")), 10_000);
    resolveCompleted = () => { clearTimeout(timeout); resolve(); };
    rejectCompleted = (error) => { clearTimeout(timeout); reject(error); };
  });
  const worker = new Worker(queueName, (job) => processLeadJob(job, {
    leadRepository: { findById: async (id) => id === lead.id ? lead : null },
    sendLeadCreatedNotification: async (currentLead) => { notifiedLead = currentLead; },
    sendLeadFollowupReminder: async () => assert.fail("wrong handler invoked"),
  }), { connection, concurrency: 1 });
  worker.on("completed", (job) => { if (job.id === jobId) resolveCompleted(); });
  worker.on("failed", (job, error) => { if (job?.id === jobId) rejectCompleted(error); });
  worker.on("error", rejectCompleted);

  try {
    await worker.waitUntilReady();
    jobId = `worker-test-${randomUUID()}`;
    const job = await queue.add(LEAD_CREATED_NOTIFICATION, { leadId: lead.id }, { jobId });
    await completed;
    assert.deepEqual(notifiedLead, lead);
    const processedJob = await queue.getJob(jobId);
    assert.equal(await processedJob?.getState(), "completed");
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([connection.quit(), queueConnection.quit()]);
  }
});

test("a job becomes permanently failed after exhausting its attempts", async (context) => {
  if (!process.env.REDIS_URL) {
    context.skip("REDIS_URL is not configured");
    return;
  }
  const queueName = `leadflow360-permanent-failure-test-${randomUUID()}`;
  const producerConnection = createLeadJobsRedisConnection();
  const workerConnection = createLeadJobsRedisConnection();
  const queue = new Queue(queueName, { connection: producerConnection });
  let attempts = 0;
  let failedJobId = "";
  let resolveFailed!: () => void;
  let rejectFailed!: (error: Error) => void;
  const permanentlyFailed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("permanent failure test timed out")), 10_000);
    resolveFailed = () => { clearTimeout(timeout); resolve(); };
    rejectFailed = (error) => { clearTimeout(timeout); reject(error); };
  });
  const worker = new Worker(queueName, async () => {
    attempts += 1;
    throw new Error("permanent test failure");
  }, { connection: workerConnection, concurrency: 1 });
  worker.on("failed", (job) => { if (job?.id === failedJobId && job.attemptsMade >= 2) resolveFailed(); });
  worker.on("error", rejectFailed);

  try {
    await worker.waitUntilReady();
    failedJobId = `permanent-failure-test-${randomUUID()}`;
    const job = await queue.add("permanent-failure-test", {}, {
      jobId: failedJobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 10 },
    });
    await permanentlyFailed;
    assert.equal(attempts, 2);
    const failedJob = await queue.getJob(failedJobId);
    assert.equal(await failedJob?.getState(), "failed");
    assert.equal(failedJob?.attemptsMade, 2);
    assert.equal((await queue.getFailed(0, 10)).some((failed) => failed.id === failedJobId), true);
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([producerConnection.quit(), workerConnection.quit()]);
  }
});

test("enqueue rejects quickly and reports connection errors when Redis is unavailable", async () => {
  const expectedPort = 6399;
  const childCode = `void (async () => {
    const { enqueueLeadCreatedJobs, closeLeadJobsQueue } = await import("./src/jobs/lead-job.queue.ts");
    try {
      await enqueueLeadCreatedJobs("redis-outage-test");
      console.error("UNEXPECTED_ENQUEUE_SUCCESS");
      process.exitCode = 1;
    } catch (error) {
      console.log("EXPECTED_ENQUEUE_REJECTION:" + (error instanceof Error ? error.message : String(error)));
    } finally {
      await closeLeadJobsQueue();
      console.log("QUEUE_SHUTDOWN_COMPLETED");
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", childCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REDIS_URL: `redis://127.0.0.1:${expectedPort}`,
      LEAD_JOB_ENQUEUE_TIMEOUT_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errorOutput = "";
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Redis outage probe timed out"));
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(output, /EXPECTED_ENQUEUE_REJECTION:Queue insertion timed out after 250ms/);
  assert.match(output, /QUEUE_SHUTDOWN_COMPLETED/);
  assert.doesNotMatch(`${output}\n${errorOutput}`, /Unhandled error event/);
});
