export const LEAD_CREATED_NOTIFICATION = "lead.created.notification" as const;
export const LEAD_FOLLOWUP_REMINDER = "lead.followup.reminder" as const;

export interface LeadJobData {
  leadId: string;
}

export type LeadJobName = typeof LEAD_CREATED_NOTIFICATION | typeof LEAD_FOLLOWUP_REMINDER;

export function validateLeadJobData(value: unknown): LeadJobData {
  if (typeof value !== "object" || value === null || !("leadId" in value)) {
    throw new Error("Lead job data must include a leadId");
  }
  const leadId = (value as { leadId?: unknown }).leadId;
  if (typeof leadId !== "string" || leadId.trim().length === 0 || leadId.length > 128) {
    throw new Error("Lead job leadId must be a non-empty string of at most 128 characters");
  }
  return { leadId: leadId.trim() };
}

export function readFollowupDelayMs(value = process.env.LEAD_FOLLOWUP_DELAY_SECONDS): number {
  const seconds = value === undefined ? 86_400 : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 30 * 24 * 60 * 60) {
    throw new Error("LEAD_FOLLOWUP_DELAY_SECONDS must be an integer from 1 to 2592000");
  }
  return seconds * 1000;
}

export function readQueueEnqueueTimeoutMs(value = process.env.LEAD_JOB_ENQUEUE_TIMEOUT_MS): number {
  const milliseconds = value === undefined ? 3_000 : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 60_000) {
    throw new Error("LEAD_JOB_ENQUEUE_TIMEOUT_MS must be an integer from 100 to 60000");
  }
  return milliseconds;
}

export function readWorkerConcurrency(value = process.env.LEAD_JOB_WORKER_CONCURRENCY): number {
  const concurrency = value === undefined ? 5 : Number(value);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100) {
    throw new Error("LEAD_JOB_WORKER_CONCURRENCY must be an integer from 1 to 100");
  }
  return concurrency;
}
