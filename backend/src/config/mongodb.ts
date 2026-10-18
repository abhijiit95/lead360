import mongoose from "mongoose";

const connection = mongoose.connection;

connection.on("connected", () => console.log("[MongoDB] Connected"));
connection.on("disconnected", () => console.warn("[MongoDB] Disconnected"));
connection.on("error", (error) => console.error("[MongoDB] Connection error:", error.message));

export async function connectMongoDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DATABASE;
  if (!uri) throw new Error("Missing required environment variable: MONGODB_URI");
  if (!database) throw new Error("Missing required environment variable: MONGODB_DATABASE");

  if (connection.readyState === 1) return;
  try {
    await mongoose.connect(uri, { dbName: database });
    console.log(`[MongoDB] Using database ${database}`);
  } catch (error) {
    console.error("[MongoDB] Connection failed:", error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function pingMongoDB(): Promise<void> {
  if (connection.readyState !== 1 || !connection.db) throw new Error("MongoDB is not connected");
  await connection.db.admin().ping();
}

export async function disconnectMongoDB(): Promise<void> {
  if (connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
