import assert from "node:assert/strict";
import test from "node:test";
import { readDatabaseTlsOptions } from "../src/config/database-tls.js";

test("local configuration keeps PostgreSQL TLS optional by default", () => {
  assert.equal(readDatabaseTlsOptions({ NODE_ENV: "development" }), undefined);
});

test("production requires PostgreSQL TLS with certificate verification", () => {
  assert.throws(
    () => readDatabaseTlsOptions({ NODE_ENV: "production" }),
    /DATABASE_SSL=true is required in production/,
  );
  assert.deepEqual(
    readDatabaseTlsOptions({ NODE_ENV: "production", DATABASE_SSL: "true" }),
    { rejectUnauthorized: true },
  );
});

test("invalid PostgreSQL TLS configuration is rejected", () => {
  assert.throws(
    () => readDatabaseTlsOptions({ NODE_ENV: "development", DATABASE_SSL: "sometimes" }),
    /DATABASE_SSL must be true or false/,
  );
  assert.throws(
    () => readDatabaseTlsOptions({ NODE_ENV: "production", DATABASE_SSL: "false" }),
    /DATABASE_SSL=true is required in production/,
  );
});
