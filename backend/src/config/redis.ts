import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;

export const redisClient = redisUrl ? createClient({ url: redisUrl, disableOfflineQueue: true }) : null;

if (!redisUrl) {
  console.warn("[Redis] REDIS_URL is not configured; caching is disabled");
}

if (redisClient) {
  redisClient.on("connect", () => console.log("[Redis] Connected"));
  redisClient.on("ready", () => console.log("[Redis] Ready"));
  redisClient.on("reconnecting", () => console.warn("[Redis] Reconnecting"));
  redisClient.on("error", (error) => console.error("[Redis] Client error:", error.message));
  redisClient.on("end", () => console.log("[Redis] Disconnected"));
}

export async function connectRedis(): Promise<void> {
  if (!redisClient || redisClient.isOpen) return;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      redisClient.connect(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 3000);
      }),
    ]);
    if (!redisClient.isReady) {
      console.warn("[Redis] Connection is still unavailable; starting API without cache");
    }
  } catch (error) {
    console.error("[Redis] Initial connection failed; continuing without cache:", error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient?.isOpen) return;
  try {
    await redisClient.quit();
  } catch (error) {
    console.error("[Redis] Graceful disconnect failed:", error);
    redisClient.disconnect();
  }
}

const configuredTtl = Number(process.env.LEADS_CACHE_TTL_SECONDS ?? 60);
if (!Number.isSafeInteger(configuredTtl) || configuredTtl < 1) {
  throw new Error("LEADS_CACHE_TTL_SECONDS must be a positive integer");
}

export const leadsCacheTtlSeconds = configuredTtl;
