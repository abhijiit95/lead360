import assert from "node:assert/strict";
import test from "node:test";
import { formatDatabaseInitializationError } from "../src/database-init-error.js";

test("database initialization error output includes the error message and stack", () => {
  const error = new Error("connection refused");
  const output = formatDatabaseInitializationError(error, {});

  assert.match(output, /connection refused/);
  assert.match(output, /database-init-error\.test\.ts/);
});

test("database initialization error output redacts credential-like environment values", () => {
  const environment = {
    DATABASE_PASSWORD: "test-db-password-value",
    JWT_SECRET: "test-jwt-secret-value",
    REDIS_URL: "rediss://user:test-redis-token@redis.internal:6379",
  };
  const error = new Error(
    `DB rejected ${environment.DATABASE_PASSWORD}; Redis was ${environment.REDIS_URL}; JWT ${environment.JWT_SECRET}`,
  );

  const output = formatDatabaseInitializationError(error, environment);

  assert.match(output, /DB rejected \[REDACTED\]/);
  assert.doesNotMatch(output, /test-db-password-value|test-jwt-secret-value|test-redis-token/);
  assert.match(output, /connection|Redis/);
});
