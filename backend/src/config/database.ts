import { Pool } from "pg";

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const port = Number(process.env.DATABASE_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DATABASE_PORT must be a valid port number");
}

export const pool = new Pool({
  host: requiredEnvironmentVariable("DATABASE_HOST"),
  port,
  database: requiredEnvironmentVariable("DATABASE_NAME"),
  user: requiredEnvironmentVariable("DATABASE_USER"),
  password: requiredEnvironmentVariable("DATABASE_PASSWORD"),
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      source VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_name_non_empty_check') THEN
        ALTER TABLE leads ADD CONSTRAINT leads_name_non_empty_check CHECK (length(btrim(name)) > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_email_non_empty_check') THEN
        ALTER TABLE leads ADD CONSTRAINT leads_email_non_empty_check CHECK (length(btrim(email)) > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_phone_non_empty_check') THEN
        ALTER TABLE leads ADD CONSTRAINT leads_phone_non_empty_check CHECK (length(btrim(phone)) > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_non_empty_check') THEN
        ALTER TABLE leads ADD CONSTRAINT leads_source_non_empty_check CHECK (length(btrim(source)) > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_non_empty_check') THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_non_empty_check CHECK (length(btrim(status)) > 0);
      END IF;
    END $$
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL CHECK (length(btrim(name)) > 0),
      email VARCHAR(255) NOT NULL UNIQUE CHECK (length(btrim(email)) > 0),
      password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
      role VARCHAR(20) NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_provider_tokens (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(100) NOT NULL,
      token_ciphertext TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, provider)
    )
  `);

  // Google identity links are separate from Drive API tokens and password credentials.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL,
      provider_subject VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_subject),
      UNIQUE (user_id, provider)
    )
  `);
}
