import { connectMongo } from "../server_mongo";
import { log } from "./index";

export async function connectDB() {
  try {
    await connectMongo();
    log("Connected to MongoDB", "mongoose");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}
