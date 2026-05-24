import mongoose, { Schema, Document } from "mongoose";

export interface IBillingPaymentDoc extends Document {
  orderId: mongoose.Types.ObjectId;
  paymentMethod: string;
  gcashNumber: string;
  gcashReferenceNumber: string;
  amountPaid: number;
  amountTendered?: number;
  transactionCode: string;
  receiptImagePath: string;
  deliveryAddress: string;
  paymentDate: Date;
  proofNote: string;
  loggedBy: string;
  createdAt: Date;
}

const billingPaymentSchema = new Schema<IBillingPaymentDoc>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    paymentMethod: { type: String, default: "cash" },
    gcashNumber: { type: String, default: "" },
    gcashReferenceNumber: { type: String, default: "" },
    amountPaid: { type: Number, required: true, min: 0 },
    amountTendered: { type: Number },
    transactionCode: { type: String, default: "" },
    receiptImagePath: { type: String, default: "" },
    deliveryAddress: { type: String, default: "" },
    paymentDate: { type: Date, default: Date.now },
    proofNote: { type: String, default: "" },
    loggedBy: { type: String, required: true },
  },
  { timestamps: true }
);

billingPaymentSchema.index({ orderId: 1 });
billingPaymentSchema.index({ transactionCode: 1 });

export default mongoose.model<IBillingPaymentDoc>("BillingPayment", billingPaymentSchema);
