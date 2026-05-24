import mongoose, { Schema, Document } from "mongoose";

export interface ISettingsDoc extends Document {
  companyName: string;
  theme: string;
  font: string;
  fontSize: string;
  colorTheme: string;
  gradient: string;
  autoBackupEnabled: boolean;
  autoBackupIntervalValue: number;
  autoBackupIntervalUnit: string;
  storeAddress: string;
  storeContactNumber: string;
  storeEmail: string;
  storeName: string;
  autoApplyOffers: boolean;
  showSavingsSummary: boolean;
  ttsVoice: string;
  dailySalesGoal: number;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettingsDoc>(
  {
    companyName: { type: String, default: "JOAP Hardware Trading" },
    theme: { type: String, default: "light" },
    font: { type: String, default: "Inter" },
    fontSize: { type: String, default: "medium" },
    colorTheme: { type: String, default: "blue" },
    gradient: { type: String, default: "none" },
    autoBackupEnabled: { type: Boolean, default: false },
    autoBackupIntervalValue: { type: Number, default: 24 },
    autoBackupIntervalUnit: { type: String, enum: ["hours", "days", "weeks"], default: "hours" },
    storeAddress: { type: String, default: "" },
    storeContactNumber: { type: String, default: "" },
    storeEmail: { type: String, default: "" },
    storeName: { type: String, default: "JOAP Hardware Trading" },
    autoApplyOffers: { type: Boolean, default: true },
    showSavingsSummary: { type: Boolean, default: true },
    ttsVoice: { type: String, default: "en-US-AriaNeural" },
    dailySalesGoal: { type: Number, default: 100000 },
  },
  { timestamps: true }
);

export default mongoose.model<ISettingsDoc>("Settings", settingsSchema);
