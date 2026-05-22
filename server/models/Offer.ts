import mongoose, { Schema, Document } from "mongoose";

export interface IOfferItemSub {
  itemId: mongoose.Types.ObjectId;
  itemName: string;
  discountValue: number;
}

export interface IOfferDoc extends Document {
  name: string;
  description: string;
  isActive: boolean;
  startDate: Date;
  endDate: Date;
  offerType: "percentage_discount" | "b1t1" | "buy1_take_percentage" | "flat_discount";
  items: IOfferItemSub[];
  createdBy: mongoose.Types.ObjectId;
  usageCount: number;
  totalSavingsGenerated: number;
  createdAt: Date;
  updatedAt: Date;
}

const offerItemSchema = new Schema<IOfferItemSub>(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemName: { type: String, required: true },
    discountValue: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const offerSchema = new Schema<IOfferDoc>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    offerType: {
      type: String,
      enum: ["percentage_discount", "b1t1", "buy1_take_percentage", "flat_discount"],
      required: true,
    },
    items: [offerItemSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    usageCount: { type: Number, default: 0 },
    totalSavingsGenerated: { type: Number, default: 0 },
  },
  { timestamps: true }
);

offerSchema.index({ isActive: 1 });
offerSchema.index({ startDate: 1, endDate: 1 });

export default mongoose.model<IOfferDoc>("Offer", offerSchema);
