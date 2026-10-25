import { readFileSync } from "node:fs";
import { isIP } from "node:net";

export interface DatabaseTlsOptions {
  rejectUnauthorized: true;
  ca?: string;
}

export function readDatabaseTlsOptions(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseTlsOptions | undefined {
  const configured = environment.DATABASE_SSL?.toLowerCase();
  if (configured !== undefined && configured !== "true" && configured !== "false") {
    throw new Error("DATABASE_SSL must be true or false");
  }

  const enabled = configured === "true";
  if (environment.NODE_ENV === "production" && !enabled) {
    throw new Error("DATABASE_SSL=true is required in production");
  }

  if (!enabled) {
    return undefined;
  }

  const production = environment.NODE_ENV === "production";
  const caPath = environment.DATABASE_CA_CERT_PATH?.trim();
  if (production && !caPath) {
    throw new Error("DATABASE_CA_CERT_PATH is required in production");
  }

  // node-postgres supplies DATABASE_HOST as TLS servername for DNS hosts;
  // Node's default checkServerIdentity then verifies that hostname.
  if (production && isIP(environment.DATABASE_HOST ?? "") !== 0) {
    throw new Error("DATABASE_HOST must be a DNS hostname in production for TLS hostname verification");
  }

  if (!caPath) {
    return { rejectUnauthorized: true };
  }

  let ca: string;
  try {
    ca = readFileSync(caPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown file error";
    throw new Error(`Could not read PostgreSQL CA certificate: ${reason}`);
  }

  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT_PATH must point to a PEM CA certificate or certificate bundle");
  }

  return { rejectUnauthorized: true, ca };
}
