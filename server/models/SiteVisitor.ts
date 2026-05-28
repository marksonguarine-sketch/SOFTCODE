import mongoose, { Schema, Document } from "mongoose";

export interface ISiteVisitorDoc extends Document {
  ip: string;
  visitCount: number;
  lastSeen: Date;
  createdAt: Date;
}

const siteVisitorSchema = new Schema<ISiteVisitorDoc>(
  {
    ip: { type: String, required: true, unique: true },
    visitCount: { type: Number, default: 1 },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model<ISiteVisitorDoc>("SiteVisitor", siteVisitorSchema);
