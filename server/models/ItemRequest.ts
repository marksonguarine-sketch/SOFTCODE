import mongoose, { Schema, Document } from "mongoose";

/**
 * Employee requests for write access to inventory.
 *
 * Workflow (REQUEST.pdf):
 *   1. Employee clicks "Add Item" / "Edit Stock"  →  request is created with
 *      status="pending" and a notification fires to every ADMIN +
 *      INVENTORY_MANAGER.
 *   2. Admin or IM opens the request, confirms with their password, and
 *      approves it — status becomes "approved". Notification fires back to
 *      the requester.
 *   3. The requester can now perform that one action (one add, or one stock
 *      edit). On the protected POST/PATCH endpoint the server consumes the
 *      grant: status → "used". To add again the employee must request again.
 *
 * Requests never expire on their own and survive logout — the employee can
 * log back in and still have an approved grant waiting.
 *
 * Race-safe approval: the approve route runs an atomic
 * `findOneAndUpdate({ _id, status: "pending" }, { status: "approved" })` so
 * two admins can't both approve the same request.
 */

export type ItemRequestAction = "ADD_ITEM" | "EDIT_STOCK" | "DELETE_ITEM";
export type ItemRequestStatus = "pending" | "approved" | "rejected" | "used" | "cancelled";

export interface IItemRequestDoc extends Document {
  requestedBy: string;
  action: ItemRequestAction;
  payload: Record<string, any>; // descriptive only — what they want to do
  status: ItemRequestStatus;
  approvedBy: string;
  approvedAt?: Date;
  rejectedBy: string;
  rejectedAt?: Date;
  rejectionReason: string;
  usedAt?: Date;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const itemRequestSchema = new Schema<IItemRequestDoc>(
  {
    requestedBy: { type: String, required: true, index: true },
    action: { type: String, enum: ["ADD_ITEM", "EDIT_STOCK", "DELETE_ITEM"], required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "used", "cancelled"],
      default: "pending",
      index: true,
    },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date },
    rejectedBy: { type: String, default: "" },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, default: "" },
    usedAt: { type: Date },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

itemRequestSchema.index({ requestedBy: 1, status: 1 });
itemRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IItemRequestDoc>("ItemRequest", itemRequestSchema);
