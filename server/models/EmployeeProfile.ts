import mongoose, { Schema, Document } from "mongoose";

/**
 * Extended employee profile data — separate from the User model to keep
 * authentication concerns lean. Stores photo (base64 data URL), contact info,
 * employee ID (e.g. JOAP-00001), and aggregated attendance counters.
 *
 * Photos are stored as data-URL strings inline. For larger deployments this
 * should move to a separate uploads collection or S3-backed object store.
 */

export interface IEmployeeProfileDoc extends Document {
  username: string; // unique link to User.username
  employeeId: string; // human-readable e.g. JOAP-00001
  photoDataUrl?: string;
  email?: string;
  contactNumber?: string;
  hireDate?: Date;
  lateCount: number;
  approvedLeaves: number;
  rejectedLeaves: number;
  adminRemarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const employeeProfileSchema = new Schema<IEmployeeProfileDoc>(
  {
    username: { type: String, required: true, unique: true, index: true },
    employeeId: { type: String, required: true, unique: true },
    photoDataUrl: { type: String },
    email: { type: String, default: "" },
    contactNumber: { type: String, default: "" },
    hireDate: { type: Date },
    lateCount: { type: Number, default: 0 },
    approvedLeaves: { type: Number, default: 0 },
    rejectedLeaves: { type: Number, default: 0 },
    adminRemarks: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model<IEmployeeProfileDoc>("EmployeeProfile", employeeProfileSchema);
