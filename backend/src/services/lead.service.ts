import { AppError } from "../errors/app-error.js";
import { leadsCacheTtlSeconds, redisClient } from "../config/redis.js";
import { leadCacheNamespace, leadRepository } from "../repositories/lead-repository.factory.js";
import type { CreateLeadInput, LeadFilters, LeadUpdateInput } from "../repositories/lead.repository.js";
import { leadListCacheKey, leadListCachePattern } from "../utils/cache-keys.js";

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

export const leadService = {
  async createLead(input: CreateLeadInput) {
    const lead = await leadRepository.create(input);
    await invalidateLeadLists();
    return lead;
  },

  async getLeads(filters: LeadFilters) {
    const key = leadListCacheKey(filters, leadCacheNamespace);
    if (redisClient?.isReady) {
      try {
        const cached = await redisClient.get(key);
        if (cached !== null) {
          console.log(`[Redis] Cache HIT: ${key}`);
          return JSON.parse(cached) as Awaited<ReturnType<typeof leadRepository.findAll>>;
        }
      } catch (error) {
        console.error(`[Redis] Cache read failed for ${key}; using selected database:`, error);
      }
    } else {
      console.warn(`[Redis] Cache unavailable for ${key}; using selected database`);
    }
    console.log(`[Redis] Cache MISS: ${key}`);

    const leads = await leadRepository.findAll(filters);
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
    return ensureFound(await leadRepository.findById(id), id);
  },

  async updateLead(id: string, input: LeadUpdateInput) {
    if (Object.keys(input).length === 0) {
      throw new AppError("At least one lead field must be provided", 400);
    }
    const lead = ensureFound(await leadRepository.update(id, input), id);
    await invalidateLeadLists();
    return lead;
  },

  async deleteLead(id: string) {
    if (!(await leadRepository.delete(id))) {
      throw new AppError(`Lead ${id} was not found`, 404);
    }
    await invalidateLeadLists();
  },
};
