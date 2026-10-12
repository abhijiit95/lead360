import type { Lead } from "../repositories/lead.repository.js";

/** Development-only stand-in. It intentionally sends no real WhatsApp message. */
export async function sendLeadCreatedNotification(lead: Lead): Promise<void> {
  console.log(`[Mock notification] Development-only: would notify for lead ${lead.id}`);
}

/** Development-only stand-in for a follow-up reminder. */
export async function sendLeadFollowupReminder(lead: Lead): Promise<void> {
  console.log(`[Mock reminder] Development-only: follow up with lead ${lead.id}`);
}
