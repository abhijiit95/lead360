import type { Lead } from "../repositories/lead.repository.js";

export interface LeadEventPayload {
  id: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LeadDeletedEventPayload {
  id: string;
}

export interface ServerToClientEvents {
  "lead:created": (lead: LeadEventPayload) => void;
  "lead:updated": (lead: LeadEventPayload) => void;
  "lead:deleted": (lead: LeadDeletedEventPayload) => void;
}

export interface ClientToServerEvents {}
export interface InterServerEvents {}
export interface SocketData {
  userId: string;
  role: "admin" | "agent";
}

export function toLeadEventPayload(lead: Lead): LeadEventPayload {
  return {
    id: lead.id,
    source: lead.source,
    status: lead.status,
    created_at: lead.created_at.toISOString(),
    updated_at: lead.updated_at.toISOString(),
  };
}
