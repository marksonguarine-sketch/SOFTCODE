import mongoose, { Schema, Document } from "mongoose";

/**
 * PaymentAudit — append-only fraud / anomaly log for the Billing & Payment
 * module. Every time a payment is logged the server runs a battery of cheap
 * checks and writes one PaymentAudit row per detected anomaly. The Daily
 * Payment Audit Report endpoint reads from this collection.
 *
 * This is the detection half of the "direct save + correct via reversing
 * entry" policy laid out in the proposal: the system never silently rejects
 * a flagged payment, it accepts the direct-save and surfaces the anomaly
 * for the admin to follow up with a Reversing Entry if needed.
 *
 * Flag taxonomy
 *   gcash_format_invalid  — reference not 8–15 alphanumerics
 *   gcash_ref_duplicate   — another payment already has the same ref
 *   amount_mismatch       — amountPaid does not match an outstanding balance
 *   amount_below_min      — partial payment < 50% of order total
 *   actor_not_assignee    — non-admin tried to log against someone else's order
 *   after_hours           — logged outside 06:00–22:00 PHT
 *   order_already_paid    — paying an already-fully-paid order
 *   order_missing         — referenced order not found (only logged via /pay)
 */

export type PaymentAuditFlag =
  | "gcash_format_invalid"
  | "gcash_ref_duplicate"
  | "amount_mismatch"
  | "amount_below_min"
  | "actor_not_assignee"
  | "after_hours"
  | "order_already_paid"
  | "order_missing";

export interface IPaymentAuditDoc extends Document {
  paymentId?: string;            // BillingPayment._id if the payment was still booked
  orderId?: string;              // Order._id (may be missing)
  trackingNumber?: string;
  flag: PaymentAuditFlag;
  severity: "info" | "warn" | "alert";
  detail: string;                // human-readable
  amount?: number;
  paymentMethod?: string;
  gcashReferenceNumber?: string;
  loggedBy: string;              // username of actor
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
  createdAt: Date;
}

const schema = new Schema<IPaymentAuditDoc>(
  {
    paymentId: { type: String, index: true },
    orderId: { type: String, index: true },
    trackingNumber: { type: String },
    flag: { type: String, required: true, index: true,
      enum: [
        "gcash_format_invalid",
        "gcash_ref_duplicate",
        "amount_mismatch",
        "amount_below_min",
        "actor_not_assignee",
        "after_hours",
        "order_already_paid",
        "order_missing",
      ],
    },
    severity: { type: String, default: "warn", enum: ["info", "warn", "alert"] },
    detail: { type: String, default: "" },
    amount: { type: Number },
    paymentMethod: { type: String },
    gcashReferenceNumber: { type: String },
    loggedBy: { type: String, required: true, index: true },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionNote: { type: String },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ flag: 1, createdAt: -1 });

export default mongoose.model<IPaymentAuditDoc>("PaymentAudit", schema);
