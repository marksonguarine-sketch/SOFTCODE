import { z } from "zod";

export const UserRole = { ADMIN: "ADMIN", EMPLOYEE: "EMPLOYEE" } as const;
export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

export const OrderStatus = {
  PENDING_PAYMENT: "Pending Payment",
  PAID: "Paid",
  PENDING_RELEASE: "Pending Release",
  RELEASED: "Released",
  IN_TRANSIT: "In Transit",
  COMPLETED: "Completed",
} as const;
export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_TYPES = [
  "online_delivery",
  "online_pickup",
  "walkin_delivery",
  "walkin_pickup",
  "online_reservation",
  "walkin_reservation",
] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_CHANNELS = ["walkin", "email", "sms", "messenger", "phone"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAYMENT_STATUSES = ["pending_payment", "partial", "paid", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "gcash", "cod", "gcash_qr", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FULFILLMENT_STATUSES = [
  "pending",
  "processing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const ALLOWED_PAYMENT_METHODS: Record<OrderType, PaymentMethod[]> = {
  online_delivery: ["cod", "gcash_qr"],
  online_pickup: ["gcash_qr", "cash"],
  walkin_delivery: ["cash", "cod", "gcash_qr"],
  walkin_pickup: ["gcash_qr", "cash"],
  online_reservation: ["gcash_qr"],
  walkin_reservation: ["cash", "gcash_qr"],
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  online_delivery: "Online Delivery",
  online_pickup: "Online Pickup",
  walkin_delivery: "Walk-in Delivery",
  walkin_pickup: "Walk-in Pickup",
  online_reservation: "Online Reservation",
  walkin_reservation: "Walk-in Reservation",
};

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  walkin: "Walk-in",
  email: "Email",
  sms: "SMS",
  messenger: "Messenger",
  phone: "Phone",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_payment: "Pending Payment",
  partial: "Partial",
  paid: "Paid",
  refunded: "Refunded",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  cod: "Cash on Delivery",
  gcash_qr: "GCash QR",
  bank: "Bank Transfer",
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const OFFER_TYPES = [
  "percentage_discount",
  "b1t1",
  "buy1_take_percentage",
  "flat_discount",
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  percentage_discount: "Percentage Discount",
  b1t1: "Buy 1 Take 1",
  buy1_take_percentage: "Buy 1, Take Another at % Off",
  flat_discount: "Flat Discount",
};

export const InventoryLogType = {
  RESTOCK: "restock",
  DEDUCTION: "deduction",
  ADJUSTMENT: "adjustment",
} as const;

export const DEFAULT_CATEGORIES = [
  "Fasteners",
  "Pipes & Fittings",
  "Cement & Masonry",
  "Lumber & Wood",
  "Paint & Coatings",
  "Electrical",
  "Plumbing",
  "Tools",
  "Hardware & Fixtures",
  "Safety Equipment",
] as const;

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["ADMIN", "EMPLOYEE"]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const createItemSchema = z.object({
  itemName: z.string().min(1, "Item name is required"),
  category: z.string().min(1, "Category is required"),
  supplierName: z.string().optional().default(""),
  unitPrice: z.number().min(0, "Unit price must be positive"),
  currentQuantity: z.number().int().min(0, "Quantity must be non-negative"),
  avgDailyUsage: z.number().min(0, "Average daily usage must be non-negative").default(0),
  leadTimeDays: z.number().min(0, "Lead time must be non-negative").default(0),
  safetyStock: z.number().min(0, "Safety stock must be non-negative").default(0),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  address: z.string().optional().default(""),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const orderItemSchema = z.object({
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  qty: z.number().int().min(1),
  originalUnitPrice: z.number().min(0),
  discountedUnitPrice: z.number().min(0),
  discountApplied: z.boolean().default(false),
  offerName: z.string().default(""),
  lineTotal: z.number().min(0),
});
export type OrderItemInput = z.infer<typeof orderItemSchema>;

export const createOrderItemSchema = z.object({
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
});

export const orderAddressSchema = z.object({
  street: z.string().optional().default(""),
  unitNumber: z.string().optional().default(""),
  city: z.string().optional().default(""),
  province: z.string().optional().default(""),
  zipCode: z.string().optional().default(""),
});

export const createOrderSchema = z.object({
  customerId: z.string().optional().default(""),
  customerName: z.string().min(1, "Customer name is required"),
  orderType: z.enum(ORDER_TYPES).default("walkin_pickup"),
  orderChannel: z.enum(ORDER_CHANNELS).default("walkin"),
  paymentStatus: z.enum(PAYMENT_STATUSES).default("pending_payment"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).default("pending"),
  deliveryFee: z.number().min(0).default(0),
  items: z.array(orderItemSchema).default([]),
  notes: z.string().optional().default(""),
  scheduledDate: z.string().optional().default(""),
  address: orderAddressSchema.optional(),
}).refine(
  (data) => {
    const allowed = ALLOWED_PAYMENT_METHODS[data.orderType];
    return allowed.includes(data.paymentMethod);
  },
  (data) => ({
    message: `Payment method "${data.paymentMethod}" is not allowed for order type "${data.orderType}". Allowed: ${ALLOWED_PAYMENT_METHODS[data.orderType].join(", ")}`,
    path: ["paymentMethod"],
  })
);
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  reason: z.string().min(1, "Reason is required"),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const bulkOrderStatusSchema = z.object({
  orderIds: z.array(z.string()).min(1),
  fulfillmentStatus: z.enum(FULFILLMENT_STATUSES),
  reason: z.string().optional().default("Bulk update"),
});
export type BulkOrderStatusInput = z.infer<typeof bulkOrderStatusSchema>;

export const quickPaySchema = z.object({
  orderId: z.string().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  gcashReferenceNumber: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type QuickPayInput = z.infer<typeof quickPaySchema>;

export const logPaymentSchema = z.object({
  orderId: z.string().min(1),
  paymentMethod: z.string().default("GCash"),
  gcashNumber: z.string().min(1, "GCash number is required"),
  gcashReferenceNumber: z.string().min(8, "Reference number must be at least 8 characters").max(20),
  amountPaid: z.number().min(0.01, "Amount must be greater than 0"),
  paymentDate: z.string().optional(),
  proofNote: z.string().optional().default(""),
});
export type LogPaymentInput = z.infer<typeof logPaymentSchema>;

export const processPaymentSchema = z.object({
  orderId: z.string().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
  // Customer & Recipient
  customerName: z.string().min(1, "Customer name required"),
  contactNumber: z.string().optional().default(""),
  recipientName: z.string().optional().default(""),
  companyName: z.string().optional().default(""),
  deliveryAddress: z.string().optional().default(""),
  // Item Verification
  allItemsComplete: z.boolean().optional().default(true),
  itemConditionNotes: z.string().optional().default(""),
  checkerName: z.string().optional().default(""),
  // Payment
  amountPaid: z.number().min(0.01, "Amount must be greater than 0"),
  amountTendered: z.number().optional(),
  orNumber: z.string().optional().default(""),
  // GCash / QR fields
  gcashSenderName: z.string().optional().default(""),
  gcashSenderNumber: z.string().optional().default(""),
  gcashReferenceNumber: z.string().optional().default(""),
  // Bank
  bankName: z.string().optional().default(""),
  bankReference: z.string().optional().default(""),
  // Proof uploads
  receiptImagePath: z.string().optional().default(""),
  proofOfDeliveryPath: z.string().optional().default(""),
  // Logistics
  driverName: z.string().optional().default(""),
  plateNumber: z.string().optional().default(""),
  // Balance
  isFullPayment: z.boolean().optional().default(true),
  remainingBalance: z.number().optional().default(0),
  balanceDueDate: z.string().optional().default(""),
  // Meta
  transactionCode: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  paymentDate: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.paymentMethod === "gcash" || data.paymentMethod === "gcash_qr") {
    if (!data.gcashSenderNumber || data.gcashSenderNumber.length < 11) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid 11-digit GCash number", path: ["gcashSenderNumber"] });
    }
    if (!data.gcashReferenceNumber || data.gcashReferenceNumber.length < 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reference number must be at least 8 characters", path: ["gcashReferenceNumber"] });
    }
  }
  if ((data.paymentMethod === "cash" || data.paymentMethod === "cod") && data.amountTendered !== undefined) {
    if (data.amountTendered < data.amountPaid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount tendered must be at least the total amount", path: ["amountTendered"] });
    }
  }
  if (data.isFullPayment === false && (!data.remainingBalance || data.remainingBalance <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the remaining balance amount", path: ["remainingBalance"] });
  }
});
export type ProcessPaymentInput = z.infer<typeof processPaymentSchema>;

export const inventoryLogSchema = z.object({
  itemId: z.string().min(1),
  type: z.enum(["restock", "deduction", "adjustment"]),
  quantity: z.number().int(),
  reason: z.string().optional().default(""),
});
export type InventoryLogInput = z.infer<typeof inventoryLogSchema>;

export const settingsSchema = z.object({
  companyName: z.string().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  font: z.string().optional().default("Inter"),
  fontSize: z.string().optional().default("medium"),
  colorTheme: z.string().optional().default("blue"),
  gradient: z.string().optional().default("none"),
  storeAddress: z.string().optional().default(""),
  storeContactNumber: z.string().optional().default(""),
  storeEmail: z.string().optional().default(""),
  storeName: z.string().optional().default(""),
  autoApplyOffers: z.boolean().optional(),
  showSavingsSummary: z.boolean().optional(),
  ttsVoice: z.string().optional().default("en-US-AriaNeural"),
  dailySalesGoal: z.number().min(0).optional().default(100000),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const ledgerEntrySchema = z.object({
  date: z.string(),
  accountName: z.string().min(1),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().optional().default(""),
  referenceType: z.string().optional().default(""),
  referenceId: z.string().optional().default(""),
});
export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;

export const offerItemSchema = z.object({
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  discountValue: z.number().min(0).default(0),
});
export type OfferItemInput = z.infer<typeof offerItemSchema>;

export const createOfferBaseSchema = z.object({
  name: z.string().min(1, "Offer name is required"),
  description: z.string().optional().default(""),
  isActive: z.boolean().default(true),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  offerType: z.enum(OFFER_TYPES),
  items: z.array(offerItemSchema).min(1, "Add at least one item to the offer"),
});

export const createOfferSchema = createOfferBaseSchema.refine(
  (data) => new Date(data.endDate) >= new Date(data.startDate),
  { message: "End date must be after or equal to start date", path: ["endDate"] }
).refine(
  (data) => new Date(data.endDate) >= new Date(new Date().setHours(0, 0, 0, 0)),
  { message: "End date cannot be in the past", path: ["endDate"] }
);
export type CreateOfferInput = z.infer<typeof createOfferBaseSchema>;

export const updateOfferSchema = createOfferBaseSchema.partial();
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export interface IUser {
  _id: string;
  username: string;
  role: UserRoleType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string | null;
}

export interface IItem {
  _id: string;
  itemName: string;
  category: string;
  supplierName: string;
  unitPrice: number;
  currentQuantity: number;
  reorderLevel: number;
  barcode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ICustomer {
  _id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface IOrderItem {
  itemId: string;
  itemName: string;
  qty: number;
  originalUnitPrice: number;
  discountedUnitPrice: number;
  discountApplied: boolean;
  offerName: string;
  lineTotal: number;
}

export interface IStatusEntry {
  status: OrderStatusType;
  timestamp: string;
  actor: string;
  note: string;
}

export interface IOrderAddress {
  street: string;
  unitNumber: string;
  city: string;
  province: string;
  zipCode: string;
}

export interface IOrder {
  _id: string;
  trackingNumber: string;
  customerId: string;
  customerName: string;
  items: IOrderItem[];
  totalAmount: number;
  subtotal: number;
  deliveryFee: number;
  orderType: OrderType;
  orderChannel: OrderChannel;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  fulfillmentStatus: FulfillmentStatus;
  sourceChannel: string;
  notes: string;
  scheduledDate?: string;
  currentStatus: string;
  statusHistory: IStatusEntry[];
  address?: IOrderAddress;
  lockedBy?: string;
  lockStartedAt?: string;
  lockLastSeen?: string;
  assignedTo?: string;
  assignedToName?: string;
  assignedAt?: string;
  assignedBy?: string;
  startedAt?: string;
  completedProcessingAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Assignment event payloads (Socket.io) ────────────────────────────────────

export interface IOrderAssignedEvent {
  orderId: string;
  trackingNumber: string;
  assignedTo: string;
  assignedBy: string;
  customerName: string;
  items: Array<{ itemName: string; qty: number }>;
  totalAmount: number;
  paymentMethod: string;
  orderType: string;
  notes?: string;
  isReassignment: boolean;
  previousAssignedTo?: string;
}

export interface IOrderUnassignedEvent {
  orderId: string;
  trackingNumber: string;
  previousAssignedTo: string;
  actor: string;
}

export interface IBillingPayment {
  _id: string;
  orderId: string;
  paymentMethod: string;
  gcashNumber: string;
  gcashReferenceNumber: string;
  amountPaid: number;
  paymentDate: string;
  proofNote: string;
  loggedBy: string;
  createdAt: string;
}

export interface IInventoryLog {
  _id: string;
  itemId: string;
  itemName: string;
  type: string;
  quantity: number;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface IAccountingAccount {
  _id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  balance: number;
}

export interface IGeneralLedgerEntry {
  _id: string;
  date: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
  referenceType: string;
  referenceId: string;
  isReversing: boolean;
  createdAt: string;
}

export interface ISystemLog {
  _id: string;
  action: string;
  actor: string;
  target: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface ISettings {
  _id: string;
  companyName: string;
  theme: string;
  font: string;
  fontSize: string;
  colorTheme: string;
  gradient: string;
  storeAddress: string;
  storeContactNumber: string;
  storeEmail: string;
  storeName: string;
  autoApplyOffers: boolean;
  showSavingsSummary: boolean;
  ttsVoice: string;
  dailySalesGoal: number;
}

export interface IOfferItem {
  itemId: string;
  itemName: string;
  discountValue: number;
}

export interface IOffer {
  _id: string;
  name: string;
  description: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
  offerType: OfferType;
  items: IOfferItem[];
  createdBy: string;
  usageCount: number;
  totalSavingsGenerated: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalOrdersToday: number;
  completedOrders: number;
  pendingPayments: number;
  pendingReleases: number;
  todayRevenue: number;
  totalRevenue: number;
  activeUsers: number;
  totalItems: number;
  criticalStock: number;
  lowStock: number;
  totalInventoryValue: number;
  paymentStatusCounts: Record<string, number>;
  orderTypeCounts: Record<string, number>;
  orderChannelCounts: Record<string, number>;
  activeOffersCount: number;
  activeOfferNames: string[];
  recentOrders: IOrder[];
  upcomingReservations: IOrder[];
}
