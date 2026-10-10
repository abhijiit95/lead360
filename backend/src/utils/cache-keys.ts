import type { LeadFilters } from "../repositories/lead.repository.js";

const leadListCachePrefix = "leads:list:";

export function leadListCacheKey(filters: LeadFilters, namespace: string): string {
  const status = filters.status === undefined ? "*" : encodeURIComponent(filters.status);
  const source = filters.source === undefined ? "*" : encodeURIComponent(filters.source);
  return `${namespace}:${leadListCachePrefix}page:${filters.page}:limit:${filters.limit}:status:${status}:source:${source}`;
}

export function leadListCachePattern(namespace: string): string {
  return `${namespace}:${leadListCachePrefix}*`;
}
