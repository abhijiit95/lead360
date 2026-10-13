import { AppError } from "../errors/app-error.js";
import { leadsCacheTtlSeconds, redisClient } from "../config/redis.js";
import { leadCacheNamespace, leadRepository } from "../repositories/lead-repository.factory.js";
import type { CreateLeadInput, LeadFilters, LeadUpdateInput } from "../repositories/lead.repository.js";
import { leadListCacheKey, leadListCachePattern } from "../utils/cache-keys.js";
import { enqueueLeadCreatedJobs } from "../jobs/lead-job.queue.js";
import type { Lead, LeadRepository } from "../repositories/lead.repository.js";
import { emitLeadCreated, emitLeadDeleted, emitLeadUpdated } from "../config/socket.js";
import { toLeadEventPayload } from "../realtime/lead-events.js";

async function invalidateLeadLists(): Promise<void> {
  if (!redisClient?.isReady) {
    console.warn("[Redis] Cache invalidation skipped; Redis is unavailable");
    return;
  }
  try {
    let deleted = 0;
    for await (const keys of redisClient.scanIterator({ MATCH: leadListCachePattern(leadCacheNamespace), COUNT: 100 })) {
      if (keys.length > 0) deleted += await redisClient.del(keys);
    }
    console.log(`[Redis] Cache invalidation: ${deleted} lead-list key(s)`);
  } catch (error) {
    console.error("[Redis] Lead-list cache invalidation failed:", error);
  }
}

function ensureFound<T>(value: T | null, id: string): T {
  if (value === null) {
    throw new AppError(`Lead ${id} was not found`, 404);
  }
  return value;
}

interface LeadServiceDependencies {
  repository: LeadRepository;
  invalidateLeadLists: () => Promise<void>;
  enqueueLeadCreatedJobs: (leadId: string) => Promise<void>;
  emitCreated: (lead: Lead) => void;
  emitUpdated: (lead: Lead) => void;
  emitDeleted: (leadId: string) => void;
}

export function createLeadService(
  overrides: Partial<LeadServiceDependencies> = {},
) {
  const dependencies: LeadServiceDependencies = {
    repository: leadRepository,
    invalidateLeadLists,
    enqueueLeadCreatedJobs,
    emitCreated: (lead) => emitLeadCreated(toLeadEventPayload(lead)),
    emitUpdated: (lead) => emitLeadUpdated(toLeadEventPayload(lead)),
    emitDeleted: (leadId) => emitLeadDeleted({ id: leadId }),
    ...overrides,
  };

  return {
    async createLead(input: CreateLeadInput) {
      const lead = await dependencies.repository.create(input);
      await dependencies.invalidateLeadLists();
      try {
        await dependencies.enqueueLeadCreatedJobs(lead.id);
      } catch (error) {
        console.error(
          `[Lead jobs] Lead ${lead.id} was created, but background jobs could not be enqueued:`,
          error,
        );
      }
      dependencies.emitCreated(lead);
      return lead;
    },

    async getLeads(filters: LeadFilters) {
      const key = leadListCacheKey(filters, leadCacheNamespace);
      if (redisClient?.isReady) {
        try {
          const cached = await redisClient.get(key);
          if (cached !== null) {
            console.log(`[Redis] Cache HIT: ${key}`);
            return JSON.parse(cached) as Awaited<ReturnType<typeof dependencies.repository.findAll>>;
          }
        } catch (error) {
          console.error(`[Redis] Cache read failed for ${key}; using selected database:`, error);
        }
      } else {
        console.warn(`[Redis] Cache unavailable for ${key}; using selected database`);
      }
      console.log(`[Redis] Cache MISS: ${key}`);

      const leads = await dependencies.repository.findAll(filters);
      if (redisClient?.isReady) {
        try {
          await redisClient.set(key, JSON.stringify(leads), { EX: leadsCacheTtlSeconds });
          console.log(`[Redis] Cache SET: ${key} (TTL ${leadsCacheTtlSeconds}s)`);
        } catch (error) {
          console.error(`[Redis] Cache write failed for ${key}; returning database result:`, error);
        }
      } else {
        console.warn(`[Redis] Cache SET skipped for ${key}; Redis is unavailable`);
      }
      return leads;
    },

    async getLeadById(id: string) {
      return ensureFound(await dependencies.repository.findById(id), id);
    },

    async updateLead(id: string, input: LeadUpdateInput) {
      if (Object.keys(input).length === 0) {
        throw new AppError("At least one lead field must be provided", 400);
      }
      const lead = ensureFound(await dependencies.repository.update(id, input), id);
      await dependencies.invalidateLeadLists();
      dependencies.emitUpdated(lead);
      return lead;
    },

    async deleteLead(id: string) {
      if (!(await dependencies.repository.delete(id))) {
        throw new AppError(`Lead ${id} was not found`, 404);
      }
      await dependencies.invalidateLeadLists();
      dependencies.emitDeleted(id);
    },
  };
}

export const leadService = createLeadService();
