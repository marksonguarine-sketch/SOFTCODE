import mongoose, { Schema, Document } from "mongoose";

/**
 * In-system notifications.
 *
 * Every important event (new order, payment posted, item request, low stock,
 * partial release, delivery confirmed, …) writes one of these. The bell icon
 * in the header polls + listens for socket events to surface them.
 *
 * Recipient model:
 *   • `recipientUsername` — targets a specific user (e.g. "your request was
 *     approved" goes to the requester).
 *   • `recipientRole`     — broadcasts to every user with that role (e.g.
 *     "new item request" goes to every ADMIN + INVENTORY_MANAGER).
 *   • If both are blank → broadcast to everyone (rare, mostly system alerts).
 *
 * `category` is what the UI groups by — [REQUEST] / [ORDER] / [PAYMENT] /
 * [INVENTORY] / [DELIVERY] / [SYSTEM]. `link` is the in-app route the "Open"
 * button navigates to.
 */
export type NotifCategory =
  | "REQUEST"
  | "ORDER"
  | "PAYMENT"
  | "INVENTORY"
  | "DELIVERY"
  | "RESERVATION"
  | "SYSTEM";

export interface INotificationDoc extends Document {
  category: NotifCategory;
  title: string;
  body: string;
  link: string;
  recipientUsername: string;
  recipientRole: string;
  readBy: string[];
  createdBy: string;
  createdAt: Date;
}

const notificationSchema = new Schema<INotificationDoc>(
  {
    category: {
      type: String,
      enum: ["REQUEST", "ORDER", "PAYMENT", "INVENTORY", "DELIVERY", "RESERVATION", "SYSTEM"],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    // Targeted user (empty = role-based or global broadcast)
    recipientUsername: { type: String, default: "", index: true },
    // Role-based broadcast (empty = no role filter)
    recipientRole: { type: String, default: "", index: true },
    // Per-user read tracking — every user that has opened this notif gets
    // pushed into the array. This lets one role-broadcast notif show as
    // "unread" for users who haven't seen it but "read" for those who have.
    readBy: { type: [String], default: [] },
    createdBy: { type: String, default: "system" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipientUsername: 1, createdAt: -1 });

export default mongoose.model<INotificationDoc>("Notification", notificationSchema);
