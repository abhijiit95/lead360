import { mysqlPool } from "./mysql.js";

const createLeadsTableQuery = `
  CREATE TABLE IF NOT EXISTS leads (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    source VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_leads_name_nonblank CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_leads_email_nonblank CHECK (CHAR_LENGTH(TRIM(email)) > 0),
    CONSTRAINT chk_leads_phone_nonblank CHECK (CHAR_LENGTH(TRIM(phone)) > 0),
    CONSTRAINT chk_leads_source_nonblank CHECK (CHAR_LENGTH(TRIM(source)) > 0),
    CONSTRAINT chk_leads_status_nonblank CHECK (CHAR_LENGTH(TRIM(status)) > 0)
  ) ENGINE=InnoDB
`;

export async function initializeMySqlSchema(): Promise<void> {
  try {
    await mysqlPool.query(createLeadsTableQuery);
    console.log("[MySQL] Leads schema initialized");
  } catch (error) {
    console.error("[MySQL] Leads schema initialization failed:", error);
    throw error;
  }
}
