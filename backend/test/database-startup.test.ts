import assert from "node:assert/strict";
import test from "node:test";
import { prepareApiDatabases, type ApiDatabaseStartupDependencies } from "../src/startup/database-startup.js";

function dependencies(overrides: Partial<ApiDatabaseStartupDependencies> = {}): ApiDatabaseStartupDependencies {
  return {
    production: false,
    leadDatabaseType: "postgres",
    verifyPostgres: async () => undefined,
    initializePostgres: async () => undefined,
    verifyMySql: async () => undefined,
    initializeMySql: async () => undefined,
    connectMongo: async () => undefined,
    warn: () => undefined,
    ...overrides,
  };
}

test("production API verifies PostgreSQL without running schema initialization", async () => {
  const calls: string[] = [];
  await prepareApiDatabases(dependencies({
    production: true,
    verifyPostgres: async () => { calls.push("verify-postgres"); },
    initializePostgres: async () => { calls.push("init-postgres"); },
  }));
  assert.deepEqual(calls, ["verify-postgres"]);
});

test("PostgreSQL selection never verifies or initializes unselected MySQL or MongoDB", async () => {
  const calls: string[] = [];
  await prepareApiDatabases(dependencies({
    leadDatabaseType: "postgres",
    verifyPostgres: async () => { calls.push("verify-postgres"); },
    initializePostgres: async () => { calls.push("init-postgres"); },
    verifyMySql: async () => { calls.push("verify-mysql"); },
    initializeMySql: async () => { calls.push("init-mysql"); },
    connectMongo: async () => { calls.push("connect-mongo"); },
  }));
  assert.deepEqual(calls, ["init-postgres"]);
});

test("development API preserves PostgreSQL and selected MySQL initialization", async () => {
  const calls: string[] = [];
  await prepareApiDatabases(dependencies({
    leadDatabaseType: "mysql",
    initializePostgres: async () => { calls.push("init-postgres"); },
    verifyMySql: async () => { calls.push("verify-mysql"); },
    initializeMySql: async () => { calls.push("init-mysql"); },
  }));
  assert.deepEqual(calls, ["init-postgres", "verify-mysql", "init-mysql"]);
});

test("production API checks the selected adapter without running its schema initializer", async () => {
  const calls: string[] = [];
  await prepareApiDatabases(dependencies({
    production: true,
    leadDatabaseType: "mysql",
    verifyPostgres: async () => { calls.push("verify-postgres"); },
    initializePostgres: async () => { calls.push("init-postgres"); },
    verifyMySql: async () => { calls.push("verify-mysql"); },
    initializeMySql: async () => { calls.push("init-mysql"); },
  }));
  assert.deepEqual(calls, ["verify-postgres", "verify-mysql"]);
});

test("development API preserves MongoDB selection without touching MySQL", async () => {
  const calls: string[] = [];
  await prepareApiDatabases(dependencies({
    leadDatabaseType: "mongodb",
    initializePostgres: async () => { calls.push("init-postgres"); },
    verifyMySql: async () => { calls.push("verify-mysql"); },
    initializeMySql: async () => { calls.push("init-mysql"); },
    connectMongo: async () => { calls.push("connect-mongo"); },
  }));
  assert.deepEqual(calls, ["init-postgres", "connect-mongo"]);
});
