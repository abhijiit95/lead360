export type ConfiguredLeadDatabase = "postgres" | "mysql" | "mongodb";

export interface ApiDatabaseStartupDependencies {
  production: boolean;
  leadDatabaseType: ConfiguredLeadDatabase;
  verifyPostgres: () => Promise<unknown>;
  initializePostgres: () => Promise<void>;
  verifyMySql: () => Promise<void>;
  initializeMySql: () => Promise<void>;
  connectMongo: () => Promise<void>;
  warn: (message: string) => void;
}

export async function prepareApiDatabases(dependencies: ApiDatabaseStartupDependencies): Promise<void> {
  if (dependencies.production) await dependencies.verifyPostgres();
  else await dependencies.initializePostgres();

  if (dependencies.leadDatabaseType === "mysql") {
    try {
      await dependencies.verifyMySql();
      if (!dependencies.production) await dependencies.initializeMySql();
    } catch {
      dependencies.warn("[MySQL] Continuing startup without MySQL; lead requests may fail until it is available");
    }
  } else if (dependencies.leadDatabaseType === "mongodb") {
    try {
      await dependencies.connectMongo();
    } catch {
      dependencies.warn("[MongoDB] Continuing startup without MongoDB; lead requests may fail until it is available");
    }
  }
}
