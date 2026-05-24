// server_mongo.ts
// Centralized MongoDB connection for JOAP Hardware Trading.
// Hardcoded as per project owner directive.
import mongoose from "mongoose";

export const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://qjmrebona_db_user:Gal5TOLmAQQNizKx@cluster0.cvabo7n.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

export const DB_NAME = "joap_hardware";

let isConnected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (isConnected) return mongoose;
  mongoose.set("strictQuery", true);
  await mongoose.connect(MONGODB_URI, {
    dbName: DB_NAME,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
  });
  isConnected = true;
  console.log("[mongo] connected to", DB_NAME);
  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    console.warn("[mongo] disconnected");
  });
  mongoose.connection.on("error", (err) => {
    console.error("[mongo] error:", err.message);
  });
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}
