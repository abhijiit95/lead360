import assert from "node:assert/strict";
import test from "node:test";
import type { Lead } from "../src/repositories/lead.repository.js";
import { processLeadJob } from "../src/jobs/lead-job.processor.js";
import {
  LEAD_CREATED_NOTIFICATION,
  LEAD_FOLLOWUP_REMINDER,
  readFollowupDelayMs,
  validateLeadJobData,
} from "../src/jobs/lead-job.types.js";

const lead: Lead = {
  id: "lead-123",
  name: "Test Lead",
  email: "test@example.com",
  phone: "1234567890",
  source: "website",
  status: "new",
  created_at: new Date(),
  updated_at: new Date(),
};

test("validates stable lead identifiers in queue payloads", () => {
  assert.deepEqual(validateLeadJobData({ leadId: " lead-123 " }), { leadId: "lead-123" });
  assert.throws(() => validateLeadJobData({ leadId: " " }), /leadId/);
  assert.throws(() => validateLeadJobData(null), /leadId/);
});

test("uses the configured delay and rejects invalid delay values", () => {
  assert.equal(readFollowupDelayMs("60"), 60_000);
  assert.throws(() => readFollowupDelayMs("0"), /2592000/);
  assert.throws(() => readFollowupDelayMs("1.5"), /2592000/);
});

test("processes a created-lead notification using current repository data", async () => {
  const sent: Lead[] = [];
  await processLeadJob({ id: "job-1", name: LEAD_CREATED_NOTIFICATION, data: { leadId: lead.id } }, {
    leadRepository: { findById: async (id) => id === lead.id ? lead : null },
    sendLeadCreatedNotification: async (currentLead) => { sent.push(currentLead); },
    sendLeadFollowupReminder: async () => assert.fail("wrong handler invoked"),
  });
  assert.deepEqual(sent, [lead]);
});

test("processes follow-up reminders and rejects unsupported or invalid jobs", async () => {
  let reminderCount = 0;
  const dependencies = {
    leadRepository: { findById: async () => lead },
    sendLeadCreatedNotification: async () => assert.fail("wrong handler invoked"),
    sendLeadFollowupReminder: async () => { reminderCount += 1; },
  };
  await processLeadJob({ name: LEAD_FOLLOWUP_REMINDER, data: { leadId: lead.id } }, dependencies);
  assert.equal(reminderCount, 1);
  await assert.rejects(processLeadJob({ name: "unknown", data: { leadId: lead.id } }, dependencies), /Unsupported/);
  await assert.rejects(processLeadJob({ name: LEAD_FOLLOWUP_REMINDER, data: {} }, dependencies), /leadId/);
});

test("does not notify after the lead has been deleted", async () => {
  await processLeadJob({ name: LEAD_FOLLOWUP_REMINDER, data: { leadId: lead.id } }, {
    leadRepository: { findById: async () => null },
    sendLeadCreatedNotification: async () => assert.fail("must not notify"),
    sendLeadFollowupReminder: async () => assert.fail("must not notify"),
  });
});
