import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { redisClient } from "../config/redis.js";
import { AppError } from "../errors/app-error.js";

interface RevocationStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function createSessionRevocationService(deps?: { store: RevocationStore; now?: () => number }) {
  const store = deps?.store ?? {
    async get(key: string) {
      if (!redisClient?.isReady) throw new AppError("Session validation is unavailable", 503);
      return redisClient.get(key);
    },
    async set(key: string, value: string, ttlSeconds: number) {
      if (!redisClient?.isReady) throw new AppError("Session revocation is unavailable", 503);
      await redisClient.set(key, value, { EX: ttlSeconds });
    },
  };
  const now = deps?.now ?? Date.now;
  const keyFor = (token: string) => `oidc:session:revoked:${createHash("sha256").update(token).digest("hex")}`;

  return {
    async isRevoked(token: string): Promise<boolean> {
      return (await store.get(keyFor(token))) !== null;
    },
    async revoke(token: string): Promise<void> {
      const payload = jwt.decode(token);
      const exp = typeof payload === "object" && payload !== null ? payload.exp : undefined;
      if (typeof exp !== "number") throw new AppError("Session token has no expiry", 400);
      const ttlSeconds = Math.ceil(exp - now() / 1000);
      if (ttlSeconds > 0) await store.set(keyFor(token), "revoked", ttlSeconds);
    },
  };
}

export const sessionRevocationService = createSessionRevocationService();
