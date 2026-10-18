import assert from "node:assert/strict";
import test from "node:test";
import { closeMySqlPool, getMySqlPool } from "../src/config/mysql.js";

const mysqlEnvironmentNames = [
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
] as const;

test("MySQL configuration is not required until the MySQL adapter is requested", async () => {
  const previousValues = new Map(mysqlEnvironmentNames.map((name) => [name, process.env[name]]));

  try {
    for (const name of mysqlEnvironmentNames) delete process.env[name];
    assert.throws(() => getMySqlPool(), /Missing required environment variable: MYSQL_PORT/);

    process.env.MYSQL_HOST = "127.0.0.1";
    process.env.MYSQL_PORT = "3306";
    process.env.MYSQL_DATABASE = "leadflow360_test";
    process.env.MYSQL_USER = "test_user";
    process.env.MYSQL_PASSWORD = "test_password";

    assert.ok(getMySqlPool());
  } finally {
    await closeMySqlPool();
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
