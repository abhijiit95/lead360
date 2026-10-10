import mysql, { type Pool } from "mysql2/promise";

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const mysqlPort = Number(process.env.MYSQL_PORT);
if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
  throw new Error("MYSQL_PORT must be a valid port number");
}

export const mysqlPool: Pool = mysql.createPool({
  host: requiredEnvironmentVariable("MYSQL_HOST"),
  port: mysqlPort,
  database: requiredEnvironmentVariable("MYSQL_DATABASE"),
  user: requiredEnvironmentVariable("MYSQL_USER"),
  password: requiredEnvironmentVariable("MYSQL_PASSWORD"),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function testMySqlConnection(): Promise<void> {
  let connection;
  try {
    connection = await mysqlPool.getConnection();
    await connection.query("SELECT 1");
    console.log("[MySQL] Connection test succeeded");
  } catch (error) {
    console.error("[MySQL] Connection test failed:", error);
    throw error;
  } finally {
    connection?.release();
  }
}
