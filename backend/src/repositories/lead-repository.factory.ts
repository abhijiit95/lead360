import { MySqlLeadRepository } from "./mysql-lead.repository.js";
import { MongoDBLeadRepository } from "./mongodb-lead.repository.js";
import { PostgresLeadRepository } from "./postgres-lead.repository.js";
import type { LeadRepository } from "./lead.repository.js";

export type LeadDatabaseType = "postgres" | "mysql" | "mongodb";

function readLeadDatabaseType(value = process.env.DATABASE_TYPE): LeadDatabaseType {
  const databaseType = value ?? "postgres";
  if (databaseType !== "postgres" && databaseType !== "mysql" && databaseType !== "mongodb") {
    throw new Error(`Invalid DATABASE_TYPE "${databaseType}". Allowed values: postgres, mysql, mongodb`);
  }
  return databaseType;
}

export const leadDatabaseType = readLeadDatabaseType();
export const leadCacheNamespace = `leadflow360:${leadDatabaseType}`;

export const leadRepository: LeadRepository = (() => {
  switch (leadDatabaseType) {
    case "postgres": return new PostgresLeadRepository();
    case "mysql": return new MySqlLeadRepository();
    case "mongodb": return new MongoDBLeadRepository();
  }
})();
