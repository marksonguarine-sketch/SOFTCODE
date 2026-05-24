import mongoose, { Schema, Document } from "mongoose";

/**
 * Internal messaging between admin and employees.
 *
 * Direction:
 * - admin → employee: admin sends to a specific employee
 * - employee → admin: employee sends a help message (visible in admin Help/Messages list)
 *
 * Read tracking: `isRead` flips when the recipient views their inbox.
 * Admins can bulk-delete or individually delete messages with password
 * confirmation on the client side.
 */

export type MessageDirection = "ADMIN_TO_EMPLOYEE" | "EMPLOYEE_TO_ADMIN";

export interface IMessageDoc extends Document {
  direction: MessageDirection;
  fromUsername: string;
  toUsername: string; // for ADMIN_TO_EMPLOYEE this is the recipient employee; for EMPLOYEE_TO_ADMIN this is "admin" or specific admin
  subject?: string;
  body: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessageDoc>(
  {
    direction: { type: String, required: true, enum: ["ADMIN_TO_EMPLOYEE", "EMPLOYEE_TO_ADMIN"], index: true },
    fromUsername: { type: String, required: true, index: true },
    toUsername: { type: String, required: true, index: true },
    subject: { type: String, default: "" },
    body: { type: String, required: true },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
  },
  { timestamps: true }
);

messageSchema.index({ toUsername: 1, isRead: 1, createdAt: -1 });

export default mongoose.model<IMessageDoc>("Message", messageSchema);
