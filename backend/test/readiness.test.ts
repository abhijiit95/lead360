import assert from "node:assert/strict";
import test from "node:test";
import { createReadinessCheck } from "../src/health/readiness.js";

test("readiness requires PostgreSQL, Redis, and the selected MySQL lead database", async () => {
  const calls: string[] = [];
  const ready = createReadinessCheck("mysql", {
    postgres: async () => { calls.push("postgres"); },
    redis: async () => { calls.push("redis"); },
    mysql: async () => { calls.push("mysql"); },
    mongodb: async () => { calls.push("mongodb"); },
  });

  assert.equal(await ready(), true);
  assert.deepEqual(calls.sort(), ["mysql", "postgres", "redis"]);
});

test("readiness requires PostgreSQL, Redis, and selected MongoDB", async () => {
  const ready = createReadinessCheck("mongodb", {
    postgres: async () => undefined,
    redis: async () => undefined,
    mongodb: async () => undefined,
  });

  assert.equal(await ready(), true);
});

test("readiness fails when any required dependency fails or is not configured", async () => {
  const failedRedis = createReadinessCheck("postgres", {
    postgres: async () => undefined,
    redis: async () => { throw new Error("private connection detail"); },
  });
  const missingMongo = createReadinessCheck("mongodb", {
    postgres: async () => undefined,
    redis: async () => undefined,
  });

  assert.equal(await failedRedis(), false);
  assert.equal(await missingMongo(), false);
});
