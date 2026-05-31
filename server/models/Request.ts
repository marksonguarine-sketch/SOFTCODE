import mongoose, { Schema, Document } from "mongoose";

/**
 * Universal request model for admin-approval workflows initiated by employees.
 *
 * Types:
 * - ADD_ITEM: employee requests to add a new inventory item
 * - TRANSFER_ORDER: employee requests to transfer one of their assigned orders to another employee
 * - LEAVE: employee requests time off (used by profile page)
 *
 * Status lifecycle:
 *   pending → accepted | declined | cancelled
 *
 * History tracks every status change for audit purposes.
 */

export type RequestType = "ADD_ITEM" | "TRANSFER_ORDER" | "LEAVE" | "PASSWORD_RESET";
export type RequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface IRequestHistoryEntry {
  status: RequestStatus;
  actor: string;
  timestamp: Date;
  note?: string;
}

export interface IRequestDoc extends Document {
  requestType: RequestType;
  requester: string; // username of employee
  requesterDisplay?: string;
  status: RequestStatus;
  reason?: string;
  // ADD_ITEM payload
  itemPayload?: {
    itemName?: string;
    sku?: string;
    category?: string;
    unitPrice?: number;
    currentQuantity?: number;
    unit?: string;
    description?: string;
    supplier?: string;
  };
  // TRANSFER_ORDER payload
  transferPayload?: {
    orderId?: string;
    trackingNumber?: string;
    targetUsername?: string;
  };
  // LEAVE payload
  leavePayload?: {
    startDate?: Date;
    endDate?: Date;
    type?: string; // "sick", "vacation", "personal"
  };
  approver?: string; // username of admin who accepted/declined
  approverNote?: string;
  decidedAt?: Date;
  history: IRequestHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<IRequestHistoryEntry>({
  status: { type: String, required: true },
  actor: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  note: { type: String },
}, { _id: false });

const requestSchema = new Schema<IRequestDoc>(
  {
    requestType: { type: String, required: true, enum: ["ADD_ITEM", "TRANSFER_ORDER", "LEAVE", "PASSWORD_RESET"] },
    requester: { type: String, required: true, index: true },
    requesterDisplay: { type: String },
    status: { type: String, default: "pending", enum: ["pending", "accepted", "declined", "cancelled"], index: true },
    reason: { type: String, default: "" },
    itemPayload: { type: Schema.Types.Mixed },
    transferPayload: { type: Schema.Types.Mixed },
    leavePayload: { type: Schema.Types.Mixed },
    approver: { type: String },
    approverNote: { type: String },
    decidedAt: { type: Date },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

requestSchema.index({ status: 1, createdAt: -1 });
requestSchema.index({ requester: 1, status: 1 });

export default mongoose.model<IRequestDoc>("Request", requestSchema);
