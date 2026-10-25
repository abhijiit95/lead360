import "./config/environment.js";
import { initializeDatabase, pool } from "./config/database.js";
import { closeMySqlPool, testMySqlConnection } from "./config/mysql.js";
import { initializeMySqlSchema } from "./config/mysql-schema.js";
import { connectMongoDB, disconnectMongoDB } from "./config/mongodb.js";
import { leadDatabaseType } from "./repositories/lead-repository.factory.js";
import { formatDatabaseInitializationError } from "./database-init-error.js";

async function initialize(): Promise<void> {
  try {
    await initializeDatabase();
    if (leadDatabaseType === "mysql") {
      await testMySqlConnection();
      await initializeMySqlSchema();
    } else if (leadDatabaseType === "mongodb") {
      // MongoDB creates its collection on first write; this verifies deployment connectivity.
      await connectMongoDB();
    }
    console.log("Database initialization completed");
  } finally {
    await Promise.allSettled([pool.end(), closeMySqlPool(), disconnectMongoDB()]);
  }
}

void initialize().catch((error: unknown) => {
  console.error("Database initialization failed:\n" + formatDatabaseInitializationError(error));
  process.exitCode = 1;
});
