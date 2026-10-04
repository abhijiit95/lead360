import "./config/environment.js";
import { app } from "./app.js";
import { initializeDatabase, pool } from "./config/database.js";

const port = Number(process.env.PORT) || 4000;

async function startServer(): Promise<void> {
  try {
    await initializeDatabase();
    app.listen(port, () => {
      console.log(`LeadFlow360 API listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start LeadFlow360 API:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

void startServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0));
  });
}
