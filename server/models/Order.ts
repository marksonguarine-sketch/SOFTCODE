import mongoose, { Schema, Document } from "mongoose";

export interface IOrderItemSub {
  itemId: mongoose.Types.ObjectId;
  itemName: string;
  qty: number;
  originalUnitPrice: number;
  discountedUnitPrice: number;
  discountApplied: boolean;
  offerName: string;
  lineTotal: number;
  // Partial-release tracking. `releasedQty` is what's already left the
  // warehouse; `pendingQty` is what's still owed to the customer. An order
  // is fully complete only when every line has pendingQty === 0.
  releasedQty?: number;
  pendingQty?: number;
}

export interface IStatusEntrySub {
  status: string;
  timestamp: Date;
  actor: string;
  note: string;
}

export interface IAddressSub {
  street: string;
  unitNumber: string;
  city: string;
  province: string;
  zipCode: string;
}

export interface INoteEntrySub {
  note: string;
  addedBy: string;
  addedAt: Date;
}

export interface IOrderDoc extends Document {
  trackingNumber: string;
  customerId: mongoose.Types.ObjectId;
  customerName: string;
  items: IOrderItemSub[];
  totalAmount: number;
  subtotal: number;
  deliveryFee: number;
  orderType: string;
  orderChannel: string;
  paymentStatus: string;
  paymentMethod: string;
  fulfillmentStatus: string;
  sourceChannel: string;
  createdBy: string;
  notes: string;
  scheduledDate?: Date;
  currentStatus: string;
  statusHistory: IStatusEntrySub[];
  notesHistory: INoteEntrySub[];
  address?: IAddressSub;
  lockedBy: string;
  lockStartedAt?: Date;
  lockLastSeen?: Date;
  assignedTo: string;
  assignedToName: string;
  assignedAt?: Date;
  assignedBy: string;
  startedAt?: Date;
  completedProcessingAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItemSub>(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemName: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    originalUnitPrice: { type: Number, required: true, min: 0 },
    discountedUnitPrice: { type: Number, required: true, min: 0 },
    discountApplied: { type: Boolean, default: false },
    offerName: { type: String, default: "" },
    lineTotal: { type: Number, required: true },
    // Partial-release tracking — defaults so old orders keep working.
    releasedQty: { type: Number, default: 0, min: 0 },
    pendingQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const statusEntrySchema = new Schema<IStatusEntrySub>(
  {
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    actor: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrderDoc>(
  {
    trackingNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    customerName: { type: String, required: true },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    orderType: {
      type: String,
      enum: ["online_delivery", "online_pickup", "walkin_delivery", "walkin_pickup", "online_reservation", "walkin_reservation"],
      default: "walkin_pickup",
    },
    orderChannel: {
      type: String,
      enum: ["walkin", "email", "sms", "messenger", "phone"],
      default: "walkin",
    },
    paymentStatus: {
      type: String,
      enum: ["pending_payment", "partial", "paid", "reservation_only"],
      default: "pending_payment",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "gcash", "cod", "gcash_qr", "bank"],
      default: "cash",
    },
    fulfillmentStatus: {
      type: String,
      enum: ["pending", "processing", "ready", "out_for_delivery", "completed", "cancelled"],
      default: "pending",
    },
    sourceChannel: { type: String, default: "walkin" },
    createdBy: { type: String, default: "" },
    notes: { type: String, default: "" },
    scheduledDate: { type: Date },
    currentStatus: { type: String, default: "pending" },
    statusHistory: [statusEntrySchema],
    address: {
      type: {
        street: { type: String, default: "" },
        unitNumber: { type: String, default: "" },
        city: { type: String, default: "" },
        province: { type: String, default: "" },
        zipCode: { type: String, default: "" },
      },
      required: false,
      default: undefined,
    },
    lockedBy: { type: String, default: "" },
    lockStartedAt: { type: Date },
    lockLastSeen: { type: Date },
    assignedTo: { type: String, default: "" },
    assignedToName: { type: String, default: "" },
    assignedAt: { type: Date },
    assignedBy: { type: String, default: "" },
    startedAt: { type: Date },
    completedProcessingAt: { type: Date },
    notesHistory: {
      type: [{
        note: { type: String, required: true },
        addedBy: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

orderSchema.index({ fulfillmentStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ orderType: 1 });
orderSchema.index({ orderChannel: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ assignedTo: 1 });
orderSchema.index({ customerName: "text" });
orderSchema.index({ scheduledDate: 1 });
orderSchema.index({ updatedAt: -1 });

export default mongoose.model<IOrderDoc>("Order", orderSchema);
