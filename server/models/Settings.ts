import mongoose, { Schema, Document } from "mongoose";

export interface ISettingsDoc extends Document {
  companyName: string;
  theme: string;
  reorderThreshold: number;
  lowStockThreshold: number;
  font: string;
  colorTheme: string;
  gradient: string;
  autoBackupEnabled: boolean;
  autoBackupIntervalValue: number;
  autoBackupIntervalUnit: string;
  gcashNumber: string;
  gcashQrImageUrl: string;
  storeAddress: string;
  storeContactNumber: string;
  autoApplyOffers: boolean;
  showSavingsSummary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettingsDoc>(
  {
    companyName: { type: String, default: "JOAP Hardware Trading" },
    theme: { type: String, default: "light" },
    reorderThreshold: { type: Number, default: 10 },
    lowStockThreshold: { type: Number, default: 20 },
    font: { type: String, default: "Inter" },
    colorTheme: { type: String, default: "blue" },
    gradient: { type: String, default: "none" },
    autoBackupEnabled: { type: Boolean, default: false },
    autoBackupIntervalValue: { type: Number, default: 24 },
    autoBackupIntervalUnit: { type: String, enum: ["hours", "days", "weeks"], default: "hours" },
    gcashNumber: { type: String, default: "" },
    gcashQrImageUrl: { type: String, default: "" },
    storeAddress: { type: String, default: "" },
    storeContactNumber: { type: String, default: "" },
    autoApplyOffers: { type: Boolean, default: true },
    showSavingsSummary: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISettingsDoc>("Settings", settingsSchema);
