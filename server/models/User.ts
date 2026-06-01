import mongoose, { Schema, Document } from "mongoose";

export interface IUserDoc extends Document {
  username: string;
  password: string;
  role: "ADMIN" | "EMPLOYEE" | "INVENTORY_MANAGER";
  isActive: boolean;
  resetToken?: string;
  resetTokenExpiry?: Date;
  // First time this user accepted the Terms of Service. Null/missing for new
  // users — the client uses this to decide whether to show the TOS dialog.
  // Server-tracked instead of localStorage so the prompt follows the account
  // across browsers / devices.
  tosAcceptedAt?: Date;
  tosVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDoc>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "EMPLOYEE", "INVENTORY_MANAGER"], default: "EMPLOYEE" },
    isActive: { type: Boolean, default: true },
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },
    tosAcceptedAt: { type: Date },
    tosVersion: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IUserDoc>("User", userSchema);
