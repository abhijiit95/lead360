import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readDatabaseTlsOptions } from "../src/config/database-tls.js";

test("local configuration keeps PostgreSQL TLS optional by default", () => {
  assert.equal(readDatabaseTlsOptions({ NODE_ENV: "development" }), undefined);
});

test("production requires PostgreSQL TLS and a trusted CA file", () => {
  assert.throws(
    () => readDatabaseTlsOptions({ NODE_ENV: "production", DATABASE_HOST: "postgres.internal" }),
    /DATABASE_SSL=true is required in production/,
  );
  assert.throws(
    () => readDatabaseTlsOptions({ NODE_ENV: "production", DATABASE_SSL: "true", DATABASE_HOST: "postgres.internal" }),
    /DATABASE_CA_CERT_PATH is required in production/,
  );
});

test("production TLS loads the configured CA with certificate validation enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lead360-postgres-ca-"));
  const caPath = join(directory, "postgres-ca.crt");
  const caCertificate = "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n";
  await writeFile(caPath, caCertificate, { mode: 0o600 });

  try {
    assert.deepEqual(
      readDatabaseTlsOptions({
        NODE_ENV: "production",
        DATABASE_SSL: "true",
        DATABASE_HOST: "postgres.internal",
        DATABASE_CA_CERT_PATH: caPath,
      }),
      { rejectUnauthorized: true, ca: caCertificate },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production TLS requires a DNS hostname for hostname verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lead360-postgres-ca-"));
  const caPath = join(directory, "postgres-ca.crt");
  await writeFile(caPath, "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n");

  try {
    assert.throws(
      () => readDatabaseTlsOptions({
        NODE_ENV: "production",
        DATABASE_SSL: "true",
        DATABASE_HOST: "127.0.0.1",
        DATABASE_CA_CERT_PATH: caPath,
      }),
      /DATABASE_HOST must be a DNS hostname in production/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an invalid CA file is rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lead360-postgres-ca-"));
  const caPath = join(directory, "not-a-certificate.crt");
  await writeFile(caPath, "not a PEM certificate");

  try {
    assert.throws(
      () => readDatabaseTlsOptions({
        NODE_ENV: "production",
        DATABASE_SSL: "true",
        DATABASE_HOST: "postgres.internal",
        DATABASE_CA_CERT_PATH: caPath,
      }),
      /DATABASE_CA_CERT_PATH must point to a PEM CA certificate/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
