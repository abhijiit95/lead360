import type { LeadRepository } from "../repositories/lead.repository.js";
import type { LeadJobData } from "./lead-job.types.js";
import { validateLeadJobData, LEAD_CREATED_NOTIFICATION, LEAD_FOLLOWUP_REMINDER } from "./lead-job.types.js";

export interface LeadJobLike {
  id?: string;
  name: string;
  data: unknown;
}

export interface LeadJobProcessorDependencies {
  leadRepository: Pick<LeadRepository, "findById">;
  sendLeadCreatedNotification(lead: NonNullable<Awaited<ReturnType<LeadRepository["findById"]>>>): Promise<void>;
  sendLeadFollowupReminder(lead: NonNullable<Awaited<ReturnType<LeadRepository["findById"]>>>): Promise<void>;
}

export async function processLeadJob(
  job: LeadJobLike,
  dependencies: LeadJobProcessorDependencies,
): Promise<void> {
  if (job.name !== LEAD_CREATED_NOTIFICATION && job.name !== LEAD_FOLLOWUP_REMINDER) {
    throw new Error(`Unsupported lead job type: ${job.name}`);
  }
  const { leadId }: LeadJobData = validateLeadJobData(job.data);
  const lead = await dependencies.leadRepository.findById(leadId);
  if (!lead) {
    console.warn(`[Lead jobs] Skipping ${job.name}; lead ${leadId} no longer exists`);
    return;
  }

  if (job.name === LEAD_CREATED_NOTIFICATION) {
    await dependencies.sendLeadCreatedNotification(lead);
  } else {
    await dependencies.sendLeadFollowupReminder(lead);
  }
}
