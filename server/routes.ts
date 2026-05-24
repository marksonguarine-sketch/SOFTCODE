import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import cron from "node-cron";
import { spawn } from "child_process";
import os from "os";
import { randomUUID } from "crypto";

import { authMiddleware, adminOnly, generateToken, clearSessionCache, clearAllSessionsForUser, AuthRequest } from "./middleware/auth";
import User from "./models/User";
import UserSession from "./models/UserSession";
import Item from "./models/Item";
import Customer from "./models/Customer";
import Order from "./models/Order";
import BillingPayment from "./models/BillingPayment";
import InventoryLog from "./models/InventoryLog";
import AccountingAccount from "./models/AccountingAccount";
import GeneralLedgerEntry from "./models/GeneralLedgerEntry";
import SystemLog from "./models/SystemLog";
import Settings from "./models/Settings";
import BackupHistory from "./models/BackupHistory";
import ImageApproval from "./models/ImageApproval";

import {
  loginSchema,
  createUserSchema,
  createItemSchema,
  createCustomerSchema,
  createOrderSchema,
  logPaymentSchema,
  processPaymentSchema,
  inventoryLogSchema,
  settingsSchema,
  ledgerEntrySchema,
  updateOrderStatusSchema,
  bulkOrderStatusSchema,
  quickPaySchema,
  createOfferSchema,
  updateOfferSchema,
  ALLOWED_PAYMENT_METHODS,
} from "@shared/schema";
import Offer from "./models/Offer";
import RequestModel from "./models/Request";
import Message from "./models/Message";
import EmployeeProfile from "./models/EmployeeProfile";

let io: SocketIOServer;

function emitEvent(event: string, data?: any) {
  if (io) io.emit(event, data);
}

async function logAction(action: string, actor: string, target = "", metadata: Record<string, any> = {}) {
  await SystemLog.create({ action, actor, target, metadata });
}

function ok(res: Response, data: any) {
  return res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string, fieldErrors?: Record<string, string>) {
  return res.status(status).json({ success: false, error, fieldErrors });
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const BACKUPS_DIR = path.join(process.cwd(), "backups");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `item-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

function generateTransactionCode() {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `TXN-${d}-${rand}`;
}

async function createBackupData() {
  const [items, customers, orders, payments, inventoryLogs, accounts, ledger, settings, systemLogs, users] =
    await Promise.all([
      Item.find().lean(),
      Customer.find().lean(),
      Order.find().lean(),
      BillingPayment.find().lean(),
      InventoryLog.find().lean(),
      AccountingAccount.find().lean(),
      GeneralLedgerEntry.find().lean(),
      Settings.find().lean(),
      SystemLog.find().lean(),
      User.find().select("-password").lean(),
    ]);
  return { items, customers, orders, payments, inventoryLogs, accounts, ledger, settings, systemLogs, users, exportDate: new Date() };
}

async function performAutoBackup() {
  try {
    const data = await createBackupData();
    const json = JSON.stringify(data, null, 2);
    const filename = `auto-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(path.join(BACKUPS_DIR, filename), json);
    await BackupHistory.create({ filename, size: Buffer.byteLength(json), source: "auto", createdBy: "system" });
    console.log(`[auto-backup] Created ${filename}`);
  } catch (err) {
    console.error("[auto-backup] Failed:", err);
  }
}

cron.schedule("0 * * * *", async () => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcoming = await Order.find({
      orderType: { $in: ["online_reservation", "walkin_reservation"] },
      scheduledDate: { $gte: now, $lte: in24h },
      fulfillmentStatus: { $nin: ["completed", "cancelled"] },
    }).lean();
    if (upcoming.length > 0 && io) {
      io.emit("reservations:upcoming_24h", {
        count: upcoming.length,
        reservations: upcoming.map((r: any) => ({
          _id: r._id, customerName: r.customerName,
          scheduledDate: r.scheduledDate, trackingNumber: r.trackingNumber,
        })),
      });
    }
  } catch (err) {
    console.error("[cron] Reservation notification check failed:", err);
  }
});

cron.schedule("0 0 * * *", async () => {
  try {
    const now = new Date();
    const expiredOffers = await Offer.find({ isActive: true, endDate: { $lt: now } });
    for (const offer of expiredOffers) {
      offer.isActive = false;
      await offer.save();
      await SystemLog.create({
        action: "OFFER_TOGGLED", actor: "system", target: offer.name,
        metadata: { from: true, to: false, reason: "auto_expired" },
      });
    }
    if (expiredOffers.length > 0) {
      console.log(`[cron] Auto-deactivated ${expiredOffers.length} expired offer(s)`);
    }
  } catch (err) {
    console.error("[cron] Offer expiry check failed:", err);
  }
});

let autoBackupJob: ReturnType<typeof cron.schedule> | null = null;

function setupAutoBackupScheduler(intervalValue: number, intervalUnit: string, enabled: boolean) {
  if (autoBackupJob) { autoBackupJob.stop(); autoBackupJob = null; }
  if (!enabled) return;

  let cronExpr: string;
  if (intervalUnit === "hours") {
    cronExpr = `0 */${Math.max(1, intervalValue)} * * *`;
  } else if (intervalUnit === "days") {
    cronExpr = `0 0 */${Math.max(1, intervalValue)} * *`;
  } else {
    cronExpr = `0 0 * * ${Math.max(1, intervalValue) === 1 ? "0" : `0/${Math.max(1, intervalValue)}`}`;
  }

  try {
    autoBackupJob = cron.schedule(cronExpr, performAutoBackup);
    console.log(`[auto-backup] Scheduled: every ${intervalValue} ${intervalUnit} (${cronExpr})`);
  } catch {
    cronExpr = "0 */24 * * *";
    autoBackupJob = cron.schedule(cronExpr, performAutoBackup);
  }
}

async function initAutoBackup() {
  const settings = await Settings.findOne();
  if (settings?.autoBackupEnabled) {
    setupAutoBackupScheduler(settings.autoBackupIntervalValue, settings.autoBackupIntervalUnit, true);
  }
}
setTimeout(initAutoBackup, 3000);

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use(cookieParser());

  io = new SocketIOServer(httpServer, { cors: { origin: "*" } });

  // ─── AUTH ───────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");

      const { username, password } = parsed.data;
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) return fail(res, 401, "Invalid credentials");
      if (!user.isActive) return fail(res, 403, "Account is inactive");

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return fail(res, 401, "Invalid credentials");

      const activeSessions = await UserSession.find({
        userId: user._id,
        isActive: true,
        lastActivity: { $gte: new Date(Date.now() - 300000) },
      });

      const hadActiveSessions = activeSessions.length > 0;
      await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false });
      clearAllSessionsForUser(user._id.toString());

      const token = generateToken({ _id: user._id.toString(), username: user.username, role: user.role });
      await UserSession.create({ userId: user._id, token, isActive: true });

      await logAction("USER_LOGIN", user.username, user.username, hadActiveSessions ? { previousSessionTerminated: true } : {});

      res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 86400000 });
      return ok(res, {
        token,
        user: { _id: user._id, username: user.username, role: user.role, isActive: user.isActive },
        previousSessionTerminated: hadActiveSessions,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/auth/logout", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const token = req.headers.authorization?.slice(7) || req.cookies?.token;
      if (token) {
        await UserSession.updateOne({ token }, { isActive: false });
        clearSessionCache(token);
      }
      await logAction("USER_LOGOUT", req.user!.username);
      res.clearCookie("token");
      return ok(res, { message: "Logged out" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await User.findById(req.user!._id).select("-password");
      if (!user) return fail(res, 404, "User not found");
      return ok(res, { user });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Verify current admin's password (used for sensitive actions like reactivation)
  app.post("/api/auth/verify-password", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { password } = req.body;
      if (!password) return fail(res, 400, "Password required");
      const user = await User.findById(req.user!._id);
      if (!user) return fail(res, 404, "User not found");
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return fail(res, 401, "Incorrect password");
      return ok(res, { verified: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/config/maps-key", authMiddleware, async (_req: AuthRequest, res: Response) => {
    const key = process.env.GOOGLE_API_KEY || "";
    return ok(res, { key });
  });

  // ─── PUBLIC STATS (no auth — for login page banner) ─────
  app.get("/api/public/stats", async (_req: Request, res: Response) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [ordersToday, totalItems, totalStaff] = await Promise.all([
        Order.countDocuments({ createdAt: { $gte: todayStart } }),
        Item.countDocuments(),
        User.countDocuments(),
      ]);
      return res.json({ success: true, data: { ordersToday, totalItems, totalStaff } });
    } catch {
      return res.json({ success: true, data: { ordersToday: 0, totalItems: 0, totalStaff: 0 } });
    }
  });

  // ─── RECEIPT IMAGE UPLOAD ────────────────────────────────
  app.post("/api/billing/upload-receipt", authMiddleware, receiptUpload.single("receipt"), (req: AuthRequest, res: Response) => {
    if (!req.file) return fail(res, 400, "No file uploaded");
    return ok(res, { filename: req.file.filename, path: `/api/uploads/${req.file.filename}` });
  });

  // ─── DASHBOARD ──────────────────────────────────────────
  app.get("/api/dashboard/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 86400000);

      const [
        totalOrdersToday,
        completedOrders,
        pendingPayments,
        pendingReleases,
        todayPayments,
        allPayments,
        activeUsers,
        totalItems,
        items,
        paymentStatusAgg,
        orderTypeAgg,
        orderChannelAgg,
        activeOffers,
        recentOrdersDocs,
        upcomingReservations,
        activeOrdersCount,
        unpaidOrdersCount,
        pendingFulfillmentCount,
        upcomingReservationsCount,
      ] = await Promise.all([
        Order.countDocuments({ createdAt: { $gte: todayStart } }),
        Order.countDocuments({ fulfillmentStatus: "completed" }),
        Order.countDocuments({ paymentStatus: "pending_payment" }),
        Order.countDocuments({ fulfillmentStatus: { $in: ["ready", "processing"] } }),
        BillingPayment.aggregate([
          { $match: { paymentDate: { $gte: todayStart } } },
          { $group: { _id: null, total: { $sum: "$amountPaid" } } },
        ]),
        BillingPayment.aggregate([{ $group: { _id: null, total: { $sum: "$amountPaid" } } }]),
        UserSession.countDocuments({ isActive: true, lastActivity: { $gte: new Date(Date.now() - 3600000) } }),
        Item.countDocuments(),
        Item.find().lean(),
        Order.aggregate([{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }]),
        Order.aggregate([{ $group: { _id: "$orderType", count: { $sum: 1 } } }]),
        Order.aggregate([{ $match: { createdAt: { $gte: todayStart } } }, { $group: { _id: "$orderChannel", count: { $sum: 1 } } }]),
        Offer.find({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).select("name").lean(),
        Order.find().sort({ createdAt: -1 }).limit(10).populate("customerId", "name phone").lean(),
        Order.find({
          orderType: { $in: ["online_reservation", "walkin_reservation"] },
          fulfillmentStatus: { $nin: ["completed", "cancelled"] },
          $or: [
            { scheduledDate: { $gte: now } },
            { scheduledDate: null },
            { scheduledDate: { $exists: false } },
          ],
        }).sort({ scheduledDate: 1 }).limit(10).lean(),
        Order.countDocuments({ fulfillmentStatus: { $nin: ["completed", "cancelled"] } }),
        Order.countDocuments({ paymentStatus: { $in: ["pending_payment", "partial"] } }),
        Order.countDocuments({ fulfillmentStatus: { $in: ["pending", "processing"] } }),
        Order.countDocuments({
          orderType: { $in: ["online_reservation", "walkin_reservation"] },
          fulfillmentStatus: { $nin: ["completed", "cancelled"] },
          $or: [
            { scheduledDate: { $gte: now } },
            { scheduledDate: null },
            { scheduledDate: { $exists: false } },
          ],
        }),
      ]);

      const reorderThreshold = 10;
      const lowStockThreshold = 20;

      const criticalStock = items.filter((i) => i.currentQuantity <= reorderThreshold).length;
      const lowStock = items.filter((i) => i.currentQuantity > reorderThreshold && i.currentQuantity <= lowStockThreshold).length;
      const totalInventoryValue = items.reduce((sum, i) => sum + i.unitPrice * i.currentQuantity, 0);

      const paymentStatusCounts: Record<string, number> = {};
      paymentStatusAgg.forEach((a: any) => { paymentStatusCounts[a._id || "unknown"] = a.count; });

      const orderTypeCounts: Record<string, number> = {};
      orderTypeAgg.forEach((a: any) => { orderTypeCounts[a._id || "unknown"] = a.count; });

      const orderChannelCounts: Record<string, number> = {};
      orderChannelAgg.forEach((a: any) => { orderChannelCounts[a._id || "unknown"] = a.count; });

      return ok(res, {
        totalOrdersToday,
        completedOrders,
        pendingPayments,
        pendingReleases,
        todayRevenue: todayPayments[0]?.total || 0,
        totalRevenue: allPayments[0]?.total || 0,
        activeUsers,
        totalItems,
        criticalStock,
        lowStock,
        totalInventoryValue,
        paymentStatusCounts,
        orderTypeCounts,
        orderChannelCounts,
        activeOffersCount: activeOffers.length,
        activeOfferNames: activeOffers.map((o: any) => o.name),
        recentOrders: recentOrdersDocs,
        upcomingReservations,
        activeOrdersCount,
        unpaidOrdersCount,
        pendingFulfillmentCount,
        upcomingReservationsCount,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/dashboard/revenue-chart", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      const data = await BillingPayment.aggregate([
        { $match: { paymentDate: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } },
            revenue: { $sum: "$amountPaid" },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      return ok(res, data.map((d) => ({ date: d._id, revenue: d.revenue })));
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/dashboard/orders-by-status", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const data = await Order.aggregate([
        { $group: { _id: "$currentStatus", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      return ok(res, data.map((d) => ({ status: d._id, count: d.count })));
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/dashboard/inventory-status", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const reorderThreshold = 10;
      const lowThreshold = 20;
      const items = await Item.find().lean();
      const critical = items.filter((i) => i.currentQuantity <= reorderThreshold).length;
      const low = items.filter((i) => i.currentQuantity > reorderThreshold && i.currentQuantity <= lowThreshold).length;
      const normal = items.filter((i) => i.currentQuantity > lowThreshold).length;
      return ok(res, [
        { name: "Critical", value: critical },
        { name: "Low", value: low },
        { name: "Normal", value: normal },
      ]);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ADVANCED DASHBOARD ─────────────────────────────────
  app.get("/api/dashboard/advanced", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { period = "monthly" } = req.query as Record<string, string>;
      const now = new Date();

      const getPeriodRange = (p: string): { start: Date; prevStart: Date; groupFormat: string; labels: string[] } => {
        const s = new Date(now);
        const ps = new Date(now);
        if (p === "daily") {
          s.setHours(0, 0, 0, 0);
          ps.setDate(ps.getDate() - 1); ps.setHours(0, 0, 0, 0);
          return { start: s, prevStart: ps, groupFormat: "%H", labels: Array.from({ length: 24 }, (_, i) => `${i}:00`) };
        } else if (p === "weekly") {
          const day = s.getDay();
          s.setDate(s.getDate() - day); s.setHours(0, 0, 0, 0);
          ps.setDate(ps.getDate() - day - 7); ps.setHours(0, 0, 0, 0);
          return { start: s, prevStart: ps, groupFormat: "%w", labels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
        } else if (p === "monthly") {
          s.setDate(1); s.setHours(0, 0, 0, 0);
          ps.setMonth(ps.getMonth() - 1); ps.setDate(1); ps.setHours(0, 0, 0, 0);
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          return { start: s, prevStart: ps, groupFormat: "%d", labels: Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`) };
        } else {
          s.setMonth(0, 1); s.setHours(0, 0, 0, 0);
          ps.setFullYear(ps.getFullYear() - 1); ps.setMonth(0, 1); ps.setHours(0, 0, 0, 0);
          return { start: s, prevStart: ps, groupFormat: "%m", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] };
        }
      }

      const range = getPeriodRange(period);

      const [
        currentPayments,
        prevPayments,
        currentOrders,
        prevOrders,
        allOrders,
        allItems,
        pendingOrders,
        revenueByPeriod,
        ordersByPeriod,
        ordersByChannel,
        topItems,
      ] = await Promise.all([
        BillingPayment.aggregate([
          { $match: { paymentDate: { $gte: range.start } } },
          { $group: { _id: null, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
        ]),
        BillingPayment.aggregate([
          { $match: { paymentDate: { $gte: range.prevStart, $lt: range.start } } },
          { $group: { _id: null, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
        ]),
        Order.countDocuments({ createdAt: { $gte: range.start } }),
        Order.countDocuments({ createdAt: { $gte: range.prevStart, $lt: range.start } }),
        Order.find({ createdAt: { $gte: range.start } }).lean(),
        Item.find().lean(),
        Order.find({ currentStatus: "Pending Payment" }).lean(),
        BillingPayment.aggregate([
          { $match: { paymentDate: { $gte: range.start } } },
          { $group: { _id: { $dateToString: { format: range.groupFormat, date: "$paymentDate", timezone: "+08:00" } }, revenue: { $sum: "$amountPaid" } } },
          { $sort: { _id: 1 } },
        ]),
        Order.aggregate([
          { $match: { createdAt: { $gte: range.start } } },
          { $group: { _id: { $dateToString: { format: range.groupFormat, date: "$createdAt", timezone: "+08:00" } }, orders: { $sum: 1 }, orderValue: { $sum: "$totalAmount" } } },
          { $sort: { _id: 1 } },
        ]),
        Order.aggregate([
          { $match: { createdAt: { $gte: range.start } } },
          { $group: { _id: "$sourceChannel", count: { $sum: 1 } } },
        ]),
        Order.aggregate([
          { $match: { createdAt: { $gte: range.start } } },
          { $unwind: "$items" },
          { $group: { _id: { itemId: "$items.itemId", itemName: "$items.itemName" }, totalQty: { $sum: "$items.quantity" }, totalRevenue: { $sum: "$items.lineTotal" }, unitPrice: { $first: "$items.unitPrice" } } },
          { $sort: { totalQty: -1 } },
          { $limit: 5 },
        ]),
      ]);

      const curRevenue = currentPayments[0]?.total || 0;
      const prevRevenue = prevPayments[0]?.total || 0;
      const revenueTrend = prevRevenue > 0 ? ((curRevenue - prevRevenue) / prevRevenue * 100).toFixed(1) : "0.0";

      const ordersTrend = prevOrders > 0 ? ((currentOrders - prevOrders) / prevOrders * 100).toFixed(1) : "0.0";

      const uniqueCustomers = new Set(allOrders.map((o: any) => o.customerName?.toLowerCase())).size;
      const prevCustomers = await Order.aggregate([
        { $match: { createdAt: { $gte: range.prevStart, $lt: range.start } } },
        { $group: { _id: { $toLower: "$customerName" } } },
      ]);
      const customersTrend = prevCustomers.length > 0 ? ((uniqueCustomers - prevCustomers.length) / prevCustomers.length * 100).toFixed(1) : "0.0";

      const customersByPeriod = await Order.aggregate([
        { $match: { createdAt: { $gte: range.start } } },
        { $group: { _id: { period: { $dateToString: { format: range.groupFormat, date: "$createdAt", timezone: "+08:00" } }, customer: { $toLower: "$customerName" } } } },
        { $group: { _id: "$_id.period", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      const custMap: Record<string, number> = {};
      customersByPeriod.forEach((c: any) => { custMap[c._id] = c.count; });

      const totalInventoryValue = allItems.reduce((sum: number, i: any) => sum + i.unitPrice * i.currentQuantity, 0);
      const pendingBalance = pendingOrders.reduce((sum: number, o: any) => sum + o.totalAmount, 0);

      const revMap: Record<string, number> = {};
      revenueByPeriod.forEach((r: any) => { revMap[r._id] = r.revenue; });
      const ordMap: Record<string, { orders: number; orderValue: number }> = {};
      ordersByPeriod.forEach((o: any) => { ordMap[o._id] = { orders: o.orders, orderValue: o.orderValue }; });

      const periodKey = (i: number): string => {
        if (period === "daily") return String(i).padStart(2, "0");
        if (period === "weekly") return String(i);
        if (period === "monthly") return String(i + 1).padStart(2, "0");
        return String(i + 1).padStart(2, "0");
      };

      const sparklineRevenue = range.labels.map((_, i) => revMap[periodKey(i)] || 0);
      const sparklineOrders = range.labels.map((_, i) => ordMap[periodKey(i)]?.orders || 0);
      const sparklineCustomers = range.labels.map((_, i) => custMap[periodKey(i)] || 0);

      const revenueChartData = range.labels.map((label, i) => {
        const key = periodKey(i);
        return { label, revenue: revMap[key] || 0, orders: ordMap[key]?.orderValue || 0 };
      });

      const channelMap: Record<string, number> = {};
      ordersByChannel.forEach((c: any) => { channelMap[c._id || "walk-in"] = c.count; });

      return ok(res, {
        earnings: { total: curRevenue, trend: parseFloat(revenueTrend as string), sparkline: sparklineRevenue },
        orders: { total: currentOrders, trend: parseFloat(ordersTrend as string), sparkline: sparklineOrders },
        customers: { total: uniqueCustomers, trend: parseFloat(customersTrend as string), sparkline: sparklineCustomers },
        balance: { total: pendingBalance, inventoryValue: totalInventoryValue },
        revenueChart: revenueChartData,
        channelBreakdown: {
          "walk-in": channelMap["walk-in"] || 0,
          phone: channelMap["phone"] || 0,
          email: channelMap["email"] || 0,
          message: channelMap["message"] || 0,
        },
        topItems: topItems.map((t: any) => ({
          itemName: t._id.itemName,
          unitPrice: t.unitPrice,
          totalQty: t.totalQty,
          totalRevenue: t.totalRevenue,
        })),
        labels: range.labels,
        totalRevenue: curRevenue,
        totalOrderValue: allOrders.reduce((s: number, o: any) => s + o.totalAmount, 0),
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── DATE DETAIL FOR CALENDAR ──────────────────────────
  app.get("/api/dashboard/date-detail", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { date, tz } = req.query as Record<string, string>;
      if (!date) return fail(res, 400, "Date parameter required (YYYY-MM-DD)");

      const tzOffset = tz ? parseInt(tz) : 480;
      const dayStart = new Date(new Date(date + "T00:00:00.000Z").getTime() - tzOffset * 60000);
      const dayEnd = new Date(new Date(date + "T23:59:59.999Z").getTime() - tzOffset * 60000);

      if (isNaN(dayStart.getTime())) return fail(res, 400, "Invalid date format");

      const [orders, payments, inventoryLogs, systemLogs] = await Promise.all([
        Order.find({ createdAt: { $gte: dayStart, $lte: dayEnd } }).lean(),
        BillingPayment.find({ paymentDate: { $gte: dayStart, $lte: dayEnd } }).lean(),
        InventoryLog.find({ createdAt: { $gte: dayStart, $lte: dayEnd } }).lean(),
        SystemLog.find({ createdAt: { $gte: dayStart, $lte: dayEnd } }).sort({ createdAt: -1 }).limit(50).lean(),
      ]);

      const totalSales = payments.reduce((sum, p) => sum + p.amountPaid, 0);
      const totalOrderValue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
      const uniqueCustomers = Array.from(new Set(orders.map((o) => o.customerName?.toLowerCase()).filter(Boolean)));

      const channelBreakdown: Record<string, number> = {};
      orders.forEach((o) => {
        const ch = o.sourceChannel || "walk-in";
        channelBreakdown[ch] = (channelBreakdown[ch] || 0) + 1;
      });

      const itemsSold: Record<string, { itemName: string; quantity: number; revenue: number }> = {};
      orders.forEach((o) => {
        (o.items || []).forEach((item: any) => {
          const key = item.itemName || item.itemId?.toString() || "unknown";
          if (!itemsSold[key]) itemsSold[key] = { itemName: key, quantity: 0, revenue: 0 };
          itemsSold[key].quantity += item.quantity;
          itemsSold[key].revenue += item.lineTotal || 0;
        });
      });

      const topItemsSold = Object.values(itemsSold).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

      const paymentMethods: Record<string, { count: number; total: number }> = {};
      payments.forEach((p) => {
        const method = p.paymentMethod || "Cash";
        if (!paymentMethods[method]) paymentMethods[method] = { count: 0, total: 0 };
        paymentMethods[method].count += 1;
        paymentMethods[method].total += p.amountPaid;
      });

      const orderStatuses: Record<string, number> = {};
      orders.forEach((o) => {
        const st = o.currentStatus || "Unknown";
        orderStatuses[st] = (orderStatuses[st] || 0) + 1;
      });

      const hourlyRevenue = Array.from({ length: 24 }, (_, h) => {
        const hourPayments = payments.filter((p) => new Date(p.paymentDate).getUTCHours() === h);
        return { hour: `${h}:00`, revenue: hourPayments.reduce((s, p) => s + p.amountPaid, 0) };
      });

      const hasActivity = orders.length > 0 || payments.length > 0 || inventoryLogs.length > 0;

      return ok(res, {
        date,
        hasActivity,
        summary: {
          totalSales,
          totalOrderValue,
          orderCount: orders.length,
          paymentCount: payments.length,
          customerCount: uniqueCustomers.length,
          inventoryChanges: inventoryLogs.length,
        },
        customers: uniqueCustomers,
        orders: orders.map((o) => ({
          _id: o._id,
          trackingNumber: o.trackingNumber,
          customerName: o.customerName,
          totalAmount: o.totalAmount,
          currentStatus: o.currentStatus,
          sourceChannel: o.sourceChannel,
          itemCount: o.items?.length || 0,
          createdAt: o.createdAt,
        })),
        payments: payments.map((p) => ({
          _id: p._id,
          orderId: p.orderId,
          amountPaid: p.amountPaid,
          paymentMethod: p.paymentMethod,
          gcashNumber: p.gcashNumber,
          gcashReferenceNumber: p.gcashReferenceNumber,
          loggedBy: p.loggedBy,
          paymentDate: p.paymentDate,
        })),
        channelBreakdown,
        topItemsSold,
        paymentMethods,
        orderStatuses,
        hourlyRevenue,
        inventoryLogs: inventoryLogs.map((l) => ({
          _id: l._id,
          itemName: l.itemName,
          type: l.type,
          quantity: l.quantity,
          reason: l.reason,
          actor: l.actor,
          createdAt: l.createdAt,
        })),
        recentActivity: systemLogs.map((l) => ({
          _id: l._id,
          action: l.action,
          actor: l.actor,
          target: l.target,
          createdAt: l.createdAt,
        })),
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/dashboard/calendar-heatmap", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { year, month } = req.query as Record<string, string>;
      if (!year || !month) return fail(res, 400, "year and month parameters required");

      const startDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
      const endDate = new Date(Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59, 999));

      const [orderCounts, paymentTotals] = await Promise.all([
        Order.aggregate([
          { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, total: { $sum: "$totalAmount" } } },
        ]),
        BillingPayment.aggregate([
          { $match: { paymentDate: { $gte: startDate, $lte: endDate } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } }, count: { $sum: 1 }, total: { $sum: "$amountPaid" } } },
        ]),
      ]);

      const heatmap: Record<string, { orders: number; orderValue: number; payments: number; revenue: number }> = {};
      orderCounts.forEach((o: any) => {
        if (!heatmap[o._id]) heatmap[o._id] = { orders: 0, orderValue: 0, payments: 0, revenue: 0 };
        heatmap[o._id].orders = o.count;
        heatmap[o._id].orderValue = o.total;
      });
      paymentTotals.forEach((p: any) => {
        if (!heatmap[p._id]) heatmap[p._id] = { orders: 0, orderValue: 0, payments: 0, revenue: 0 };
        heatmap[p._id].payments = p.count;
        heatmap[p._id].revenue = p.total;
      });

      return ok(res, { year: parseInt(year), month: parseInt(month), heatmap });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ADMIN USERS ────────────────────────────────────────
  app.get("/api/admin/users", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { search, role, status, page = "1", pageSize = "10" } = req.query as Record<string, string>;
      const filter: any = {};
      if (search) filter.username = { $regex: search, $options: "i" };
      if (role) filter.role = role;
      if (status === "active") filter.isActive = true;
      if (status === "inactive") filter.isActive = false;

      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [users, total] = await Promise.all([
        User.find(filter).select("-password").sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)),
        User.countDocuments(filter),
      ]);

      const userIds = users.map((u) => u._id);
      const lastSessions = await UserSession.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $sort: { lastActivity: -1 } },
        { $group: { _id: "$userId", lastLogin: { $first: "$lastActivity" } } },
      ]);
      const sessionMap = new Map(lastSessions.map((s) => [s._id.toString(), s.lastLogin]));

      const usersWithLogin = users.map((u) => ({
        ...u.toObject(),
        lastLogin: sessionMap.get(u._id.toString()) || null,
      }));

      return ok(res, { users: usersWithLogin, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/admin/users", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));

      const existing = await User.findOne({ username: parsed.data.username.toLowerCase() });
      if (existing) return fail(res, 409, "Username already exists");

      const hashed = await bcrypt.hash(parsed.data.password, 10);
      const user = await User.create({ ...parsed.data, username: parsed.data.username.toLowerCase(), password: hashed });
      await logAction("USER_CREATED", req.user!.username, user.username, { role: user.role });
      emitEvent("USER_CREATED");
      return ok(res, { _id: user._id, username: user.username, role: user.role, isActive: user.isActive });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/admin/users/:id/status", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const user = await User.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true }).select("-password");
      if (!user) return fail(res, 404, "User not found");
      if (!req.body.isActive) await UserSession.updateMany({ userId: user._id }, { isActive: false });
      await logAction("USER_STATUS_CHANGED", req.user!.username, user.username, { isActive: user.isActive });
      return ok(res, user);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/admin/users/:id/role", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true }).select("-password");
      if (!user) return fail(res, 404, "User not found");
      await logAction("USER_ROLE_CHANGED", req.user!.username, user.username, { role: user.role });
      return ok(res, user);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/admin/users/:id/reset-password", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const tempPass = Math.random().toString(36).slice(-8);
      const hashed = await bcrypt.hash(tempPass, 10);
      const user = await User.findByIdAndUpdate(req.params.id, { password: hashed }).select("-password");
      if (!user) return fail(res, 404, "User not found");
      await logAction("USER_PASSWORD_RESET", req.user!.username, user.username);
      return ok(res, { temporaryPassword: tempPass });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── CUSTOMER MAP ─────────────────────────────────────
  app.get("/api/dashboard/customer-map", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { period = "monthly" } = req.query as Record<string, string>;
      const now = new Date();

      const getPeriodRange = (p: string): { start: Date } => {
        const s = new Date(now);
        if (p === "daily") {
          s.setHours(0, 0, 0, 0);
        } else if (p === "weekly") {
          const day = s.getDay();
          s.setDate(s.getDate() - day); s.setHours(0, 0, 0, 0);
        } else if (p === "monthly") {
          s.setDate(1); s.setHours(0, 0, 0, 0);
        } else {
          s.setMonth(0, 1); s.setHours(0, 0, 0, 0);
        }
        return { start: s };
      };

      const range = getPeriodRange(period);

      const data = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: range.start },
            "address.city": { $exists: true, $ne: "" },
          },
        },
        {
          $group: {
            _id: { city: "$address.city", province: "$address.province" },
            count: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { revenue: -1 } },
      ]);

      return ok(
        res,
        data.map((d: any) => ({
          city: d._id.city,
          province: d._id.province || "",
          count: d.count,
          revenue: d.revenue,
        }))
      );
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ITEMS ──────────────────────────────────────────────
  app.get("/api/items", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { search, category, page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const filter: any = {};
      if (search) filter.$or = [{ itemName: { $regex: search, $options: "i" } }, { barcode: { $regex: search, $options: "i" } }];
      if (category) filter.category = category;

      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [items, total] = await Promise.all([
        Item.find(filter).sort({ itemName: 1 }).skip(skip).limit(parseInt(pageSize)),
        Item.countDocuments(filter),
      ]);
      return ok(res, { items, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/items/all", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const items = await Item.find().sort({ itemName: 1 }).lean();
      return ok(res, items);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/items/categories", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const categories = await Item.distinct("category");
      return ok(res, categories);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/items", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createItemSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));

      const { avgDailyUsage, leadTimeDays, safetyStock } = parsed.data;
      const reorderLevel = Math.ceil((avgDailyUsage * leadTimeDays) + safetyStock);

      const item = await Item.create({ ...parsed.data, reorderLevel });

      if (item.currentQuantity > 0) {
        await InventoryLog.create({
          itemId: item._id,
          itemName: item.itemName,
          type: "restock",
          quantity: item.currentQuantity,
          reason: "Initial stock",
          actor: req.user!.username,
        });
      }

      await logAction("ITEM_CREATED", req.user!.username, item.itemName);
      emitEvent("INVENTORY_LOG_CREATED");
      return ok(res, item);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/items/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { unitPrice } = req.body;
      if (unitPrice !== undefined && unitPrice < 0) return fail(res, 400, "Price cannot be negative");
      const item = await Item.findByIdAndUpdate(req.params.id, { unitPrice }, { new: true });
      if (!item) return fail(res, 404, "Item not found");
      await logAction("ITEM_PRICE_ADJUSTED", req.user!.username, item.itemName, { unitPrice });
      emitEvent("INVENTORY_LOG_CREATED");
      return ok(res, item);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── INVENTORY CRITICAL ───────────────────────────────────
  app.get("/api/inventory/critical", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const items = await Item.find({ $or: [{ currentQuantity: 0 }, { currentQuantity: { $lte: 5 } }] })
        .sort({ currentQuantity: 1 })
        .lean();
      return ok(res, items);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── RESERVATIONS ────────────────────────────────────────
  app.get("/api/reservations", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { status, date, month, search, type } = req.query as Record<string, string>;
      const filter: any = { orderType: { $in: ["online_reservation", "walkin_reservation"] } };
      if (type && type !== "all") filter.orderType = type;
      if (status && status !== "all") filter.fulfillmentStatus = status;
      if (date) {
        const d = new Date(date);
        const next = new Date(d); next.setDate(d.getDate() + 1);
        filter.scheduledDate = { $gte: d, $lt: next };
      }
      if (month) {
        const [y, m] = month.split("-").map(Number);
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 1);
        filter.scheduledDate = { $gte: start, $lt: end };
      }
      if (search) {
        filter.$or = [
          { customerName: { $regex: search, $options: "i" } },
          { trackingNumber: { $regex: search, $options: "i" } },
        ];
      }
      const reservations = await Order.find(filter).populate("customerId", "name phone email address").sort({ scheduledDate: 1 }).lean();
      const mapped = reservations.map((r: any) => ({
        ...r,
        customerPhone: (r.customerId as any)?.phone || "",
        customerEmail: (r.customerId as any)?.email || "",
      }));
      return ok(res, mapped);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reservations/calendar", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { year, month } = req.query as Record<string, string>;
      const y = parseInt(year) || new Date().getFullYear();
      const m = parseInt(month) || new Date().getMonth() + 1;
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      const reservations = await Order.find({
        orderType: { $in: ["online_reservation", "walkin_reservation"] },
        scheduledDate: { $gte: start, $lt: end },
      }).lean();
      const grouped: Record<string, any[]> = {};
      reservations.forEach((r: any) => {
        if (!r.scheduledDate) return;
        const key = r.scheduledDate.toISOString().split("T")[0];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
      });
      return ok(res, grouped);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reservations/today", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const reservations = await Order.find({
        orderType: { $in: ["online_reservation", "walkin_reservation"] },
        scheduledDate: { $gte: start, $lte: end },
      }).lean();
      return ok(res, reservations);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reservations/upcoming", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 86400000);
      const reservations = await Order.find({
        orderType: { $in: ["online_reservation", "walkin_reservation"] },
        fulfillmentStatus: { $nin: ["completed", "cancelled"] },
        scheduledDate: { $gte: now, $lte: in30 },
      }).sort({ scheduledDate: 1 }).lean();
      return ok(res, reservations);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reservations/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        orderType: { $in: ["online_reservation", "walkin_reservation"] },
      }).populate("customerId", "name phone email address").lean();
      if (!order) return fail(res, 404, "Reservation not found");
      const o = order as any;
      return ok(res, {
        ...o,
        customerPhone: (o.customerId as any)?.phone || "",
        customerEmail: (o.customerId as any)?.email || "",
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/reservations/:id/status", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { fulfillmentStatus, paymentStatus, orderType } = req.body;
      const updates: any = {};
      if (fulfillmentStatus) { updates.fulfillmentStatus = fulfillmentStatus; updates.currentStatus = fulfillmentStatus; }
      if (paymentStatus) updates.paymentStatus = paymentStatus;
      if (orderType) updates.orderType = orderType;
      const order = await Order.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
      if (!order) return fail(res, 404, "Reservation not found");
      await logAction("RESERVATION_STATUS_UPDATED", req.user!.username, order.trackingNumber, updates);
      return ok(res, order);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/reservations/:id/notes", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { note } = req.body;
      if (!note?.trim()) return fail(res, 400, "Note is required");
      const order = await Order.findByIdAndUpdate(
        req.params.id,
        { $push: { notesHistory: { note: note.trim(), addedBy: req.user!.username, addedAt: new Date() } } },
        { new: true }
      );
      if (!order) return fail(res, 404, "Reservation not found");
      await logAction("RESERVATION_NOTE_ADDED", req.user!.username, order.trackingNumber, { note: note.trim() });
      return ok(res, order);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Delete a cancelled reservation (admin only, requires password confirmation on client)
  app.delete("/api/reservations/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role !== "ADMIN") return fail(res, 403, "Admin only");
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Reservation not found");
      if (order.fulfillmentStatus !== "cancelled") return fail(res, 400, "Only cancelled reservations can be deleted");
      await Order.findByIdAndDelete(req.params.id);
      await logAction("RESERVATION_DELETED", req.user!.username, order.trackingNumber);
      return ok(res, { message: "Reservation deleted" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── INVENTORY LOGS ─────────────────────────────────────
  app.get("/api/inventory-logs", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { itemId, page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const filter: any = {};
      if (itemId) filter.itemId = itemId;

      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [logs, total] = await Promise.all([
        InventoryLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)),
        InventoryLog.countDocuments(filter),
      ]);
      return ok(res, { logs, total });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/inventory-logs", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = inventoryLogSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");

      const item = await Item.findById(parsed.data.itemId);
      if (!item) return fail(res, 404, "Item not found");

      const quantityChange = parsed.data.type === "deduction" ? -Math.abs(parsed.data.quantity) : parsed.data.quantity;

      if (item.currentQuantity + quantityChange < 0) {
        return fail(res, 400, `Insufficient stock. Current: ${item.currentQuantity}`);
      }

      item.currentQuantity += quantityChange;
      await item.save();

      const logEntry = await InventoryLog.create({
        ...parsed.data,
        quantity: quantityChange,
        itemName: item.itemName,
        actor: req.user!.username,
      });

      await logAction("INVENTORY_LOG_CREATED", req.user!.username, item.itemName, { type: parsed.data.type, quantity: quantityChange });
      emitEvent("INVENTORY_LOG_CREATED", { itemId: item._id });
      return ok(res, logEntry);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── CUSTOMERS ──────────────────────────────────────────
  app.get("/api/customers", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { search } = req.query as Record<string, string>;
      const filter: any = {};
      if (search) filter.name = { $regex: search, $options: "i" };
      const customers = await Customer.find(filter).sort({ name: 1 });
      return ok(res, customers);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/customers", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createCustomerSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");
      const customer = await Customer.create(parsed.data);
      return ok(res, customer);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ORDERS ─────────────────────────────────────────────
  app.get("/api/orders", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const {
        status, search, page = "1", pageSize = "20",
        assignedTo, assignedToMe, pool,
        paymentStatus, orderType, orderChannel, fulfillmentStatus,
        dateFrom, dateTo,
      } = req.query as Record<string, string>;
      const filter: any = {};
      if (status) filter.currentStatus = status;
      if (fulfillmentStatus) filter.fulfillmentStatus = fulfillmentStatus;
      if (paymentStatus) filter.paymentStatus = paymentStatus;
      if (orderType) filter.orderType = orderType;
      if (orderChannel) filter.orderChannel = orderChannel;
      if (search) filter.$or = [
        { trackingNumber: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
      ];
      if (pool === "true") {
        // Unassigned pending orders (claimable pool), FIFO oldest first
        filter.$or = [{ assignedTo: "" }, { assignedTo: { $exists: false } }, { assignedTo: null }];
        filter.fulfillmentStatus = "pending";
        filter.orderType = { $nin: ["online_reservation", "walkin_reservation"] };
      } else {
        if (assignedToMe === "true") filter.assignedTo = req.user!.username;
        else if (assignedTo) filter.assignedTo = assignedTo;
      }
      if (dateFrom || dateTo) {
        filter.createdAt = {};
        if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
        if (dateTo) filter.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
      }

      const sortOrder = pool === "true" ? { createdAt: 1 as const } : { createdAt: -1 as const };
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [orders, total] = await Promise.all([
        Order.find(filter).sort(sortOrder).skip(skip).limit(parseInt(pageSize)),
        Order.countDocuments(filter),
      ]);
      return ok(res, { orders, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ORDER LOCKING ──────────────────────────────────────
  app.post("/api/orders/:id/lock", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");

      const now = new Date();
      const LOCK_TIMEOUT_MS = 3 * 60 * 1000;

      const lockIsStale = !order.lockLastSeen || (now.getTime() - new Date(order.lockLastSeen).getTime() > LOCK_TIMEOUT_MS);
      const lockedByOther = order.lockedBy && order.lockedBy !== req.user!.username;

      if (lockedByOther && !lockIsStale) {
        return ok(res, {
          locked: true,
          lockedBy: order.lockedBy,
          lockStartedAt: order.lockStartedAt,
          lockLastSeen: order.lockLastSeen,
        });
      }

      if (!order.lockedBy || order.lockedBy !== req.user!.username) {
        order.lockStartedAt = now;
      }
      order.lockedBy = req.user!.username;
      order.lockLastSeen = now;
      await order.save();
      return ok(res, { locked: false });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.delete("/api/orders/:id/lock", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      if (order.lockedBy === req.user!.username) {
        order.lockedBy = "";
        order.lockStartedAt = undefined;
        order.lockLastSeen = undefined;
        await order.save();
      }
      return ok(res, { message: "Lock released" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/orders/:id/takeover", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      const now = new Date();
      order.lockedBy = req.user!.username;
      order.lockStartedAt = now;
      order.lockLastSeen = now;
      await order.save();
      await logAction("ORDER_TAKEOVER", req.user!.username, order.trackingNumber, { previousHolder: order.lockedBy });
      return ok(res, { locked: false });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ORDER ASSIGNMENT ───────────────────────────────────
  // Admin assigns or reassigns
  app.post("/api/orders/:id/assign", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { username, displayName } = req.body;
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");

      const previousAssignedTo = order.assignedTo || "";
      const isReassignment = !!previousAssignedTo && previousAssignedTo !== username;

      order.assignedTo = username || "";
      order.assignedToName = displayName || username || "";
      order.assignedAt = username ? new Date() : undefined;
      order.assignedBy = username ? req.user!.username : "";
      if (username) {
        (order as any).startedAt = undefined;
        (order as any).completedProcessingAt = undefined;
      }
      order.statusHistory.push({
        status: username ? "assigned" : "unassigned",
        timestamp: new Date(),
        actor: req.user!.username,
        note: username
          ? isReassignment
            ? `Reassigned from ${previousAssignedTo} to ${username}`
            : `Assigned to ${username}`
          : "Unassigned — returned to pool",
      });
      await order.save();

      const actionKey = isReassignment ? "ORDER_REASSIGNED" : (username ? "ORDER_ASSIGNED" : "ORDER_UNASSIGNED");
      await logAction(actionKey, req.user!.username, order.trackingNumber, {
        assignedTo: username || "unassigned",
        previousAssignedTo,
      });

      emitEvent("order:assigned", {
        orderId: order._id.toString(),
        trackingNumber: order.trackingNumber,
        assignedTo: username || "",
        assignedBy: req.user!.username,
        customerName: order.customerName,
        items: order.items.map((i) => ({ itemName: i.itemName, qty: i.qty })),
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        orderType: order.orderType,
        notes: order.notes || "",
        isReassignment,
        previousAssignedTo,
      });
      return ok(res, order);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Admin unassigns — returns order to pool
  app.delete("/api/orders/:id/assign", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      const previousAssignedTo = order.assignedTo || "";
      order.assignedTo = "";
      order.assignedToName = "";
      order.assignedAt = undefined;
      order.assignedBy = "";
      (order as any).startedAt = undefined;
      (order as any).completedProcessingAt = undefined;
      order.statusHistory.push({
        status: "unassigned",
        timestamp: new Date(),
        actor: req.user!.username,
        note: `Returned to pool by ${req.user!.username}`,
      });
      await order.save();
      await logAction("ORDER_UNASSIGNED", req.user!.username, order.trackingNumber, { previousAssignedTo });
      emitEvent("order:unassigned", {
        orderId: order._id.toString(),
        trackingNumber: order.trackingNumber,
        previousAssignedTo,
        actor: req.user!.username,
      });
      return ok(res, order);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Employee self-claim from pool (task-locked for employees)
  app.post("/api/orders/:id/claim", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      // Read first for validation
      const existing = await Order.findById(req.params.id).lean();
      if (!existing) return fail(res, 404, "Order not found");
      if (existing.fulfillmentStatus !== "pending") return fail(res, 409, "Order is no longer pending");
      if (existing.assignedTo) return fail(res, 409, "Order is already claimed by " + existing.assignedTo);

      const me = req.user!.username;
      const isAdmin = req.user!.role === "ADMIN";

      // Task lock: employees can only hold one active order at a time
      if (!isAdmin) {
        const blocking = await Order.findOne({
          assignedTo: me,
          $or: [{ completedProcessingAt: { $exists: false } }, { completedProcessingAt: null }],
          fulfillmentStatus: { $nin: ["completed", "cancelled", "ready"] },
        }).select("trackingNumber").lean();
        if (blocking) {
          return fail(res, 403, `Complete your current order (${blocking.trackingNumber}) before claiming another.`);
        }
      }

      const now = new Date();
      const updated = await Order.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            assignedTo: me,
            assignedToName: me,
            assignedAt: now,
            assignedBy: me,
          },
          $unset: { startedAt: "", completedProcessingAt: "" },
          $push: {
            statusHistory: {
              status: "assigned",
              timestamp: now,
              actor: me,
              note: `Claimed from pool by ${me}`,
            },
          },
        },
        { new: true }
      );
      if (!updated) return fail(res, 404, "Order not found after update");

      await logAction("ORDER_CLAIMED", me, updated.trackingNumber, { claimedBy: me });
      emitEvent("order:assigned", {
        orderId: updated._id.toString(),
        trackingNumber: updated.trackingNumber,
        assignedTo: me,
        assignedBy: me,
        customerName: updated.customerName,
        items: updated.items.map((i) => ({ itemName: i.itemName, qty: i.qty })),
        totalAmount: updated.totalAmount,
        paymentMethod: updated.paymentMethod,
        orderType: updated.orderType,
        notes: updated.notes || "",
        isReassignment: false,
        previousAssignedTo: "",
      });
      return ok(res, { order: updated });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Start processing — only the assignee or admin
  app.post("/api/orders/:id/start-processing", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const existing = await Order.findById(req.params.id).lean();
      if (!existing) return fail(res, 404, "Order not found");
      const me = req.user!.username;
      if (existing.assignedTo !== me && req.user!.role !== "ADMIN") {
        return fail(res, 403, "Only the assigned user can start processing");
      }
      const now = new Date();
      const updated = await Order.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            startedAt: now,
            fulfillmentStatus: existing.fulfillmentStatus === "pending" ? "processing" : existing.fulfillmentStatus,
          },
          $push: { statusHistory: { status: "processing", timestamp: now, actor: me, note: "Started processing" } },
        },
        { new: true }
      );
      if (!updated) return fail(res, 404, "Order not found after update");
      await logAction("ORDER_PROCESSING_STARTED", me, updated.trackingNumber, {});
      emitEvent("order:status-changed", { orderId: updated._id.toString(), fulfillmentStatus: updated.fulfillmentStatus, assignedTo: updated.assignedTo });
      return ok(res, { order: updated });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Complete processing — only the assignee or admin; unlocks task lock
  app.post("/api/orders/:id/complete-processing", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const existing = await Order.findById(req.params.id).lean();
      if (!existing) return fail(res, 404, "Order not found");
      const me = req.user!.username;
      if (existing.assignedTo !== me && req.user!.role !== "ADMIN") {
        return fail(res, 403, "Only the assigned user can complete processing");
      }
      const now = new Date();
      const newFulfillment = ["pending", "processing"].includes(existing.fulfillmentStatus) ? "ready" : existing.fulfillmentStatus;
      const updated = await Order.findByIdAndUpdate(
        req.params.id,
        {
          $set: { completedProcessingAt: now, fulfillmentStatus: newFulfillment },
          $push: { statusHistory: { status: "ready", timestamp: now, actor: me, note: "Processing complete — order is ready" } },
        },
        { new: true }
      );
      if (!updated) return fail(res, 404, "Order not found after update");
      await logAction("ORDER_PROCESSING_COMPLETED", me, updated.trackingNumber, {});
      emitEvent("order:status-changed", { orderId: updated._id.toString(), fulfillmentStatus: updated.fulfillmentStatus, assignedTo: updated.assignedTo });
      return ok(res, { order: updated });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // My active orders (for task-lock check on the client)
  // Returns ALL orders that block the employee from claiming a new one.
  app.get("/api/orders/my-active", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const me = req.user!.username;
      const activeOrders = await Order.find({
        assignedTo: me,
        $or: [{ completedProcessingAt: { $exists: false } }, { completedProcessingAt: null }],
        fulfillmentStatus: { $nin: ["completed", "cancelled", "ready"] },
      }).select("trackingNumber customerName fulfillmentStatus assignedAt").lean();
      // Keep backwards-compat: also return the first as `order`
      return ok(res, { order: activeOrders[0] || null, orders: activeOrders });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Check for duplicate order (same customer name + same items)
  app.post("/api/orders/check-duplicate", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { customerName, itemIds } = req.body as { customerName: string; itemIds: string[] };
      if (!customerName || !itemIds?.length) return ok(res, { duplicate: null });
      // Find a pending or processing order with same customer + at least one of the same items
      const existing = await Order.findOne({
        customerName: { $regex: new RegExp(`^${customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        fulfillmentStatus: { $nin: ["completed", "cancelled"] },
        "items.itemId": { $in: itemIds },
      }).select("trackingNumber customerName items fulfillmentStatus _id").lean();
      return ok(res, { duplicate: existing || null });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── USERS SIMPLE LIST (for dropdowns) ─────────────────
  app.get("/api/users/simple", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      const users = await User.find({ isActive: true }).select("username role").sort({ role: 1, username: 1 }).lean();
      return ok(res, users);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/orders/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      const payments = await BillingPayment.find({ orderId: order._id }).sort({ createdAt: -1 });
      return ok(res, { order, payments });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/orders", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));
      if (!parsed.data.items || parsed.data.items.length === 0) return fail(res, 400, "At least one item is required");

      const settings = await Settings.findOne();
      const autoApply = settings?.autoApplyOffers !== false;

      const now = new Date();
      const activeOffers = autoApply
        ? await Offer.find({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).lean()
        : [];

      const offerItemMap: Map<string, any> = new Map();
      for (const offer of activeOffers) {
        for (const oi of offer.items) {
          const itemIdStr = oi.itemId.toString();
          const existing = offerItemMap.get(itemIdStr);
          if (!existing || oi.discountValue > existing.discountValue) {
            offerItemMap.set(itemIdStr, { offer, offerItem: oi });
          }
        }
      }

      const offersUsed: Map<string, { offer: any; totalSavings: number }> = new Map();
      let totalSavings = 0;

      const processedItems = parsed.data.items.map((i) => {
        const match = offerItemMap.get(i.itemId);
        if (!match) {
          return {
            itemId: i.itemId,
            itemName: i.itemName,
            qty: i.qty,
            originalUnitPrice: i.originalUnitPrice,
            discountedUnitPrice: i.discountedUnitPrice,
            discountApplied: i.discountApplied,
            offerName: i.offerName,
            lineTotal: i.lineTotal,
          };
        }

        const { offer, offerItem } = match;
        const orig = i.originalUnitPrice;
        const qty = i.qty;
        let discountedPrice = orig;
        let lineTotal = orig * qty;

        if (offer.offerType === "percentage_discount") {
          discountedPrice = orig * (1 - offerItem.discountValue / 100);
          lineTotal = discountedPrice * qty;
        } else if (offer.offerType === "b1t1") {
          discountedPrice = orig;
          lineTotal = Math.ceil(qty / 2) * orig;
        } else if (offer.offerType === "buy1_take_percentage") {
          const pairs = Math.floor(qty / 2);
          const remainder = qty % 2;
          const secondPrice = orig * (1 - offerItem.discountValue / 100);
          lineTotal = pairs * orig + pairs * secondPrice + remainder * orig;
          discountedPrice = lineTotal / qty;
        } else if (offer.offerType === "flat_discount") {
          discountedPrice = Math.max(0, orig - offerItem.discountValue);
          lineTotal = discountedPrice * qty;
        }

        const savings = orig * qty - lineTotal;
        totalSavings += savings;

        const offerId = offer._id.toString();
        const existing = offersUsed.get(offerId);
        if (existing) existing.totalSavings += savings;
        else offersUsed.set(offerId, { offer, totalSavings: savings });

        return {
          itemId: i.itemId,
          itemName: i.itemName,
          qty,
          originalUnitPrice: orig,
          discountedUnitPrice: Math.round(discountedPrice * 100) / 100,
          discountApplied: true,
          offerName: offer.name,
          lineTotal: Math.round(lineTotal * 100) / 100,
        };
      });

      const subtotal = processedItems.reduce((sum, i) => sum + i.originalUnitPrice * i.qty, 0);
      const totalAmount = processedItems.reduce((sum, i) => sum + i.lineTotal, 0) + (parsed.data.deliveryFee || 0);
      const trackingNumber = `JOAP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const addressData = parsed.data.address;
      const hasAddress = addressData && Object.values(addressData).some((v) => v && v.trim() !== "");

      const order = await Order.create({
        trackingNumber,
        ...(parsed.data.customerId ? { customerId: parsed.data.customerId } : {}),
        customerName: parsed.data.customerName,
        items: processedItems,
        totalAmount: Math.round(totalAmount * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee: parsed.data.deliveryFee || 0,
        orderType: parsed.data.orderType,
        orderChannel: parsed.data.orderChannel,
        paymentStatus: parsed.data.paymentStatus,
        paymentMethod: parsed.data.paymentMethod,
        fulfillmentStatus: parsed.data.fulfillmentStatus,
        sourceChannel: parsed.data.orderChannel,
        notes: parsed.data.notes,
        scheduledDate: parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : undefined,
        currentStatus: parsed.data.fulfillmentStatus,
        statusHistory: [{ status: parsed.data.fulfillmentStatus, timestamp: new Date(), actor: req.user!.username, note: "Order created" }],
        ...(hasAddress ? { address: addressData } : {}),
      });

      for (const oi of processedItems) {
        const item = await Item.findById(oi.itemId);
        if (item) {
          item.currentQuantity = Math.max(0, item.currentQuantity - oi.qty);
          await item.save();
          await InventoryLog.create({
            itemId: item._id, itemName: item.itemName, type: "deduction",
            quantity: -oi.qty, reason: `Order ${trackingNumber}`, actor: req.user!.username,
          });
        }
      }

      for (const [offerId, { totalSavings: savings }] of Array.from(offersUsed)) {
        await Offer.findByIdAndUpdate(offerId, {
          $inc: { usageCount: 1, totalSavingsGenerated: savings },
        });
      }

      await logAction("ORDER_CREATED", req.user!.username, order.trackingNumber, { totalAmount, totalSavings });
      emitEvent("ORDER_CREATED", { orderId: order._id });
      return ok(res, { order, totalSavings: Math.round(totalSavings * 100) / 100 });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/orders/:id/status", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = updateOrderStatusSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));

      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");

      const updates: Record<string, any> = {};
      const statusEntries: any[] = [];

      if (parsed.data.fulfillmentStatus && parsed.data.fulfillmentStatus !== order.fulfillmentStatus) {
        const oldStatus = order.fulfillmentStatus;
        updates.fulfillmentStatus = parsed.data.fulfillmentStatus;
        updates.currentStatus = parsed.data.fulfillmentStatus;
        statusEntries.push({ status: parsed.data.fulfillmentStatus, timestamp: new Date(), actor: req.user!.username, note: parsed.data.reason });
        await logAction("ORDER_FULFILLMENT_STATUS_UPDATED", req.user!.username, order.trackingNumber, {
          from: oldStatus, to: parsed.data.fulfillmentStatus, reason: parsed.data.reason,
        });
      }

      if (parsed.data.paymentStatus && parsed.data.paymentStatus !== order.paymentStatus) {
        const oldPayStatus = order.paymentStatus;
        updates.paymentStatus = parsed.data.paymentStatus;
        await logAction("ORDER_PAYMENT_STATUS_UPDATED", req.user!.username, order.trackingNumber, {
          from: oldPayStatus, to: parsed.data.paymentStatus, reason: parsed.data.reason,
        });
      }

      if (statusEntries.length > 0) updates.$push = { statusHistory: { $each: statusEntries } };

      const { $push, ...setUpdates } = updates;
      const updateOp: any = { $set: setUpdates };
      if ($push) updateOp.$push = $push;

      const updated = await Order.findByIdAndUpdate(req.params.id, updateOp, { new: true });
      emitEvent("ORDER_STATUS_UPDATED", { orderId: order._id });
      return ok(res, updated);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/orders/bulk-status", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = bulkOrderStatusSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");

      const orders = await Order.find({ _id: { $in: parsed.data.orderIds } });
      if (orders.length === 0) return fail(res, 404, "No orders found");

      const statusEntry = { status: parsed.data.fulfillmentStatus, timestamp: new Date(), actor: req.user!.username, note: parsed.data.reason };
      await Order.updateMany(
        { _id: { $in: parsed.data.orderIds } },
        {
          $set: { fulfillmentStatus: parsed.data.fulfillmentStatus, currentStatus: parsed.data.fulfillmentStatus },
          $push: { statusHistory: statusEntry },
        }
      );

      await logAction("BULK_ORDER_STATUS_UPDATED", req.user!.username, `${orders.length} orders`, {
        to: parsed.data.fulfillmentStatus, count: orders.length,
      });
      emitEvent("ORDER_STATUS_UPDATED");
      return ok(res, { updated: orders.length });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── BILLING & PAYMENT ─────────────────────────────────
  app.post("/api/billing/quick-pay", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = quickPaySchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));

      const order = await Order.findById(parsed.data.orderId);
      if (!order) return fail(res, 404, "Order not found");

      const totalPaid = await BillingPayment.aggregate([
        { $match: { orderId: order._id.toString() } },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]);
      const alreadyPaid = totalPaid[0]?.total || 0;
      const remaining = order.totalAmount - alreadyPaid;

      const payment = await BillingPayment.create({
        orderId: parsed.data.orderId,
        paymentMethod: parsed.data.paymentMethod,
        gcashNumber: "",
        gcashReferenceNumber: parsed.data.gcashReferenceNumber || "",
        amountPaid: parsed.data.amount,
        paymentDate: new Date(),
        proofNote: parsed.data.note || "",
        loggedBy: req.user!.username,
      });

      const newTotalPaid = alreadyPaid + parsed.data.amount;
      let newPaymentStatus = order.paymentStatus;
      if (newTotalPaid >= order.totalAmount) {
        newPaymentStatus = "paid";
      } else if (newTotalPaid > 0) {
        newPaymentStatus = "partial";
      }

      await Order.findByIdAndUpdate(parsed.data.orderId, { paymentStatus: newPaymentStatus });

      await logAction("QUICK_PAYMENT_RECORDED", req.user!.username, order.trackingNumber, {
        amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, newPaymentStatus,
      });
      emitEvent("PAYMENT_LOGGED", { orderId: order._id });
      return ok(res, { payment, newPaymentStatus, remaining: Math.max(0, remaining - parsed.data.amount) });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/billing", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [payments, total] = await Promise.all([
        BillingPayment.find().sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)),
        BillingPayment.countDocuments(),
      ]);
      return ok(res, { payments, total });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/billing/pay", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = processPaymentSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));

      const order = await Order.findById(parsed.data.orderId);
      if (!order) return fail(res, 404, "Order not found");
      if (order.currentStatus !== "Pending Payment") return fail(res, 400, "Order is not pending payment");

      if (parsed.data.amountPaid < order.totalAmount) return fail(res, 400, `Payment must be at least ₱${order.totalAmount.toFixed(2)}`);

      const isGcash = parsed.data.paymentMethod === "gcash" || parsed.data.paymentMethod === "gcash_qr";

      if (isGcash && parsed.data.gcashReferenceNumber) {
        const existingRef = await BillingPayment.findOne({ gcashReferenceNumber: parsed.data.gcashReferenceNumber });
        if (existingRef) return fail(res, 409, "Duplicate GCash reference number — already recorded");
      }

      const transactionCode = parsed.data.transactionCode || generateTransactionCode();

      const payment = await BillingPayment.create({
        orderId: parsed.data.orderId,
        paymentMethod: parsed.data.paymentMethod,
        gcashNumber: parsed.data.gcashSenderNumber || "",
        gcashReferenceNumber: isGcash ? parsed.data.gcashReferenceNumber : transactionCode,
        amountPaid: parsed.data.amountPaid,
        amountTendered: parsed.data.amountTendered,
        transactionCode,
        receiptImagePath: parsed.data.receiptImagePath || "",
        deliveryAddress: parsed.data.deliveryAddress || "",
        paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
        proofNote: parsed.data.notes || "",
        loggedBy: req.user!.username,
      });

      const methodLabel = isGcash ? `GCash (ref: ${parsed.data.gcashReferenceNumber})` : parsed.data.paymentMethod === "cod" ? "Cash on Delivery" : "Cash";
      order.currentStatus = "Pending Release";
      order.paymentStatus = "paid";
      order.statusHistory.push(
        { status: "Paid", timestamp: new Date(), actor: req.user!.username, note: `₱${parsed.data.amountPaid.toFixed(2)} received via ${methodLabel} · Txn: ${transactionCode}` },
        { status: "Pending Release", timestamp: new Date(), actor: req.user!.username, note: "Payment confirmed, awaiting release" }
      );
      await order.save();

      const accountName = isGcash ? "GCash Receivable" : "Cash on Hand";
      await GeneralLedgerEntry.create([
        { date: new Date(), accountName, debit: parsed.data.amountPaid, credit: 0, description: `Payment for order ${order.trackingNumber} via ${methodLabel}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
        { date: new Date(), accountName: "Sales Revenue", debit: 0, credit: parsed.data.amountPaid, description: `Revenue from order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
      ]);

      await logAction("PAYMENT_LOGGED", req.user!.username, order.trackingNumber, { amount: parsed.data.amountPaid, method: parsed.data.paymentMethod, transactionCode });
      emitEvent("PAYMENT_LOGGED", { orderId: order._id, transactionCode });
      emitEvent("ORDER_STATUS_APPENDED", { orderId: order._id, status: "Pending Release" });
      emitEvent("LEDGER_POSTED");
      emitEvent("DASHBOARD_STATS_UPDATED");
      return ok(res, { payment, order, transactionCode });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ORDER RELEASE ──────────────────────────────────────
  app.post("/api/orders/:id/release", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      if (!["Paid", "Pending Release"].includes(order.currentStatus)) {
        return fail(res, 400, "Order must be Paid or Pending Release to release items");
      }

      const insufficientItems: string[] = [];
      for (const oi of order.items) {
        const item = await Item.findById(oi.itemId);
        const qty = (oi as any).qty ?? (oi as any).quantity ?? 0;
        if (!item || item.currentQuantity < qty) {
          insufficientItems.push(`${oi.itemName}: need ${qty}, have ${item?.currentQuantity ?? 0}`);
        }
      }
      if (insufficientItems.length > 0) {
        return fail(res, 400, `Insufficient stock: ${insufficientItems.join("; ")}`);
      }

      for (const oi of order.items) {
        const item = await Item.findById(oi.itemId);
        const qty = (oi as any).qty ?? (oi as any).quantity ?? 0;
        if (item) {
          item.currentQuantity -= qty;
          await item.save();
          await InventoryLog.create({
            itemId: item._id,
            itemName: item.itemName,
            type: "deduction",
            quantity: -qty,
            reason: `Released for order ${order.trackingNumber}`,
            actor: req.user!.username,
          });
        }
      }

      order.currentStatus = "Completed";
      order.statusHistory.push(
        { status: "Released", timestamp: new Date(), actor: req.user!.username, note: "Items released from inventory" },
        { status: "Completed", timestamp: new Date(), actor: req.user!.username, note: "Order fulfilled" }
      );
      await order.save();

      await logAction("ORDER_RELEASED", req.user!.username, order.trackingNumber);
      emitEvent("ORDER_RELEASED", { orderId: order._id });
      emitEvent("INVENTORY_LOG_CREATED");
      return ok(res, { order, message: "Order released. Inventory updated. Revenue updated." });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ACCOUNTING ─────────────────────────────────────────
  app.get("/api/accounting/accounts", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const accounts = await AccountingAccount.find().sort({ accountCode: 1 });
      return ok(res, accounts);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/accounting/ledger", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { startDate, endDate, page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const filter: any = {};
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [entries, total] = await Promise.all([
        GeneralLedgerEntry.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(pageSize)),
        GeneralLedgerEntry.countDocuments(filter),
      ]);
      return ok(res, { entries, total });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/accounting/ledger", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = ledgerEntrySchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");
      const entry = await GeneralLedgerEntry.create({ ...parsed.data, date: new Date(parsed.data.date), actor: req.user!.username });
      await logAction("LEDGER_POSTED", req.user!.username, entry.accountName, { debit: entry.debit, credit: entry.credit });
      emitEvent("LEDGER_POSTED");
      return ok(res, entry);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/accounting/summary", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const entries = await GeneralLedgerEntry.find().lean();
      const summary: Record<string, { debit: number; credit: number }> = {};
      for (const e of entries) {
        if (!summary[e.accountName]) summary[e.accountName] = { debit: 0, credit: 0 };
        summary[e.accountName].debit += e.debit;
        summary[e.accountName].credit += e.credit;
      }
      return ok(res, Object.entries(summary).map(([name, vals]) => ({ accountName: name, ...vals, net: vals.debit - vals.credit })));
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── OFFERS ─────────────────────────────────────────────
  app.get("/api/offers/active", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const now = new Date();
      const offers = await Offer.find({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).lean();
      return ok(res, offers);
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.get("/api/offers", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { status, page = "1", pageSize = "10" } = req.query as Record<string, string>;
      const now = new Date();
      const filter: any = {};
      if (status === "active") { filter.isActive = true; filter.startDate = { $lte: now }; filter.endDate = { $gte: now }; }
      else if (status === "inactive") { filter.isActive = false; }
      else if (status === "expired") { filter.endDate = { $lt: now }; }
      else if (status === "upcoming") { filter.startDate = { $gt: now }; filter.isActive = true; }
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [offers, total] = await Promise.all([
        Offer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)).lean(),
        Offer.countDocuments(filter),
      ]);
      return ok(res, { offers, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.post("/api/offers", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createOfferSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));
      // Duplicate check: same name (case-insensitive) + same type + overlapping dates
      const existingOffer = await Offer.findOne({
        name: { $regex: `^${parsed.data.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        isActive: true,
      });
      if (existingOffer) return fail(res, 409, `An active offer named "${existingOffer.name}" already exists.`);
      const offer = await Offer.create({ ...parsed.data, startDate: new Date(parsed.data.startDate), endDate: new Date(parsed.data.endDate), createdBy: req.user!._id });
      await logAction("OFFER_CREATED", req.user!.username, offer.name, { offerType: offer.offerType });
      emitEvent("OFFER_CREATED");
      return ok(res, offer);
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.get("/api/offers/:id/stats", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const offer = await Offer.findById(req.params.id).lean();
      if (!offer) return fail(res, 404, "Offer not found");
      return ok(res, { usageCount: offer.usageCount, totalSavingsGenerated: offer.totalSavingsGenerated });
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.put("/api/offers/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = updateOfferSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed", Object.fromEntries(parsed.error.errors.map((e) => [e.path.join("."), e.message])));
      const updateData: any = { ...parsed.data };
      if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
      if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);
      const offer = await Offer.findByIdAndUpdate(req.params.id, updateData, { new: true });
      if (!offer) return fail(res, 404, "Offer not found");
      await logAction("OFFER_UPDATED", req.user!.username, offer.name, {});
      emitEvent("OFFER_UPDATED");
      return ok(res, offer);
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.patch("/api/offers/:id/toggle", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const offer = await Offer.findById(req.params.id);
      if (!offer) return fail(res, 404, "Offer not found");
      const prev = offer.isActive;
      offer.isActive = !offer.isActive;
      await offer.save();
      await logAction("OFFER_TOGGLED", req.user!.username, offer.name, { from: prev, to: offer.isActive });
      emitEvent("OFFER_TOGGLED");
      return ok(res, offer);
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.post("/api/offers/:id/duplicate", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const original = await Offer.findById(req.params.id).lean();
      if (!original) return fail(res, 404, "Offer not found");
      const now = new Date();
      const endDate = new Date(now.getTime() + 7 * 86400000);
      const { _id, createdAt, updatedAt, usageCount, totalSavingsGenerated, ...rest } = original as any;
      const duplicate = await Offer.create({
        ...rest, name: `Copy of ${original.name}`, isActive: false,
        startDate: now, endDate, usageCount: 0, totalSavingsGenerated: 0, createdBy: req.user!._id,
      });
      await logAction("OFFER_DUPLICATED", req.user!.username, original.name, { newId: duplicate._id });
      return ok(res, duplicate);
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.delete("/api/offers/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const offer = await Offer.findById(req.params.id);
      if (!offer) return fail(res, 404, "Offer not found");
      if (offer.usageCount > 0) {
        offer.isActive = false;
        await offer.save();
        await logAction("OFFER_TOGGLED", req.user!.username, offer.name, { reason: "archived_due_to_usage" });
        return ok(res, { archived: true, message: "Offer has been archived because it has been used" });
      }
      await Offer.findByIdAndDelete(req.params.id);
      await logAction("OFFER_DELETED", req.user!.username, offer.name, {});
      return ok(res, { deleted: true });
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  // ─── REPORTS ────────────────────────────────────────────
  app.get("/api/reports/sales", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      const filter: any = {};
      if (startDate || endDate) {
        filter.paymentDate = {};
        if (startDate) filter.paymentDate.$gte = new Date(startDate);
        if (endDate) filter.paymentDate.$lte = new Date(endDate);
      }
      const payments = await BillingPayment.find(filter).sort({ paymentDate: -1 }).lean();
      const totalRevenue = payments.reduce((s, p) => s + p.amountPaid, 0);
      return ok(res, { payments, totalRevenue, count: payments.length });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reports/inventory", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const items = await Item.find().sort({ itemName: 1 }).lean();
      const totalValue = items.reduce((s, i) => s + i.unitPrice * i.currentQuantity, 0);
      return ok(res, { items, totalValue, count: items.length });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/reports/offers-performance", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const offers = await Offer.find().sort({ usageCount: -1 }).lean();
      return ok(res, { offers, count: offers.length });
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.get("/api/reports/order-type-breakdown", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      const filter: any = {};
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate + "T23:59:59.999Z");
      }
      const [byType, byChannel] = await Promise.all([
        Order.aggregate([
          { $match: filter },
          { $group: { _id: "$orderType", count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
          { $sort: { revenue: -1 } },
        ]),
        Order.aggregate([
          { $match: filter },
          { $group: { _id: "$orderChannel", count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
          { $sort: { revenue: -1 } },
        ]),
      ]);
      return ok(res, {
        byType: byType.map((r: any) => ({ type: r._id, count: r.count, revenue: r.revenue })),
        byChannel: byChannel.map((r: any) => ({ channel: r._id, count: r.count, revenue: r.revenue })),
      });
    } catch (err: any) { return fail(res, 500, err.message); }
  });

  app.get("/api/reports/forecast", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
      const data = await BillingPayment.aggregate([
        { $match: { paymentDate: { $gte: ninetyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } }, revenue: { $sum: "$amountPaid" } } },
        { $sort: { _id: 1 } },
      ]);

      const values = data.map((d) => d.revenue);
      const forecast: { date: string; actual?: number; forecast?: number }[] = data.map((d) => ({ date: d._id, actual: d.revenue }));

      if (values.length >= 3) {
        const windowSize = Math.min(7, values.length);
        const lastValues = values.slice(-windowSize);
        const avg = lastValues.reduce((s, v) => s + v, 0) / lastValues.length;
        const trend = values.length > 1 ? (values[values.length - 1] - values[0]) / values.length : 0;

        for (let i = 1; i <= 14; i++) {
          const futureDate = new Date(Date.now() + i * 86400000);
          const forecastValue = Math.max(0, avg + trend * i * 0.5 + (Math.random() - 0.5) * avg * 0.1);
          forecast.push({
            date: futureDate.toISOString().split("T")[0],
            forecast: Math.round(forecastValue * 100) / 100,
          });
        }
      }

      return ok(res, forecast);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── SYSTEM LOGS ────────────────────────────────────────
  app.get("/api/system-logs", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { action, page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const filter: any = {};
      if (action) filter.action = action;
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [logs, total] = await Promise.all([
        SystemLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)),
        SystemLog.countDocuments(filter),
      ]);
      return ok(res, { logs, total });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── SETTINGS ───────────────────────────────────────────
  app.get("/api/settings", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      let settings = await Settings.findOne();
      if (!settings) settings = await Settings.create({ companyName: "JOAP Hardware Trading" });
      return ok(res, settings);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/settings", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Validation failed");
      const settings = await Settings.findOneAndUpdate({}, parsed.data, { new: true, upsert: true });
      await logAction("SETTINGS_CHANGED", req.user!.username, "", parsed.data);
      return ok(res, settings);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── TTS ────────────────────────────────────────────────
  app.post("/api/tts", authMiddleware, async (req: AuthRequest, res: Response) => {
    const tmpFile = path.join(os.tmpdir(), `tts-${randomUUID()}.mp3`);
    try {
      const { text } = req.body as { text?: string };
      if (!text || !text.trim()) return fail(res, 400, "text is required");
      const settings = await Settings.findOne().lean();
      const voice = (settings?.ttsVoice as string) || "en-US-AriaNeural";
      const truncated = text.slice(0, 500);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("edge-tts", [
          "--voice", voice,
          "--text", truncated,
          "--write-media", tmpFile,
        ]);
        let stderr = "";
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`edge-tts exited ${code}: ${stderr}`));
        });
        proc.on("error", (e) => reject(new Error(`edge-tts spawn error: ${e.message}`)));
      });

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      const stream = fs.createReadStream(tmpFile);
      stream.pipe(res);
      stream.on("end", () => fs.unlink(tmpFile, () => {}));
      stream.on("error", (e) => {
        fs.unlink(tmpFile, () => {});
        if (!res.headersSent) fail(res, 500, e.message);
      });
    } catch (err: any) {
      fs.unlink(tmpFile, () => {});
      if (!res.headersSent) return fail(res, 500, err.message);
    }
  });

  // ─── SEARCH ─────────────────────────────────────────────
  app.get("/api/search", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { q } = req.query as Record<string, string>;
      if (!q || q.length < 2) return ok(res, { results: [] });

      const regex = { $regex: q, $options: "i" };
      const [items, customers, orders] = await Promise.all([
        Item.find({ $or: [{ itemName: regex }, { category: regex }, { barcode: regex }] }).limit(5).lean(),
        Customer.find({ $or: [{ name: regex }, { email: regex }, { phone: regex }] }).limit(5).lean(),
        Order.find({ $or: [{ trackingNumber: regex }, { customerName: regex }] }).limit(5).lean(),
      ]);

      const results = [
        ...items.map((i) => ({ type: "item" as const, id: i._id, label: i.itemName, sublabel: i.category })),
        ...customers.map((c) => ({ type: "customer" as const, id: c._id, label: c.name, sublabel: c.phone })),
        ...orders.map((o) => ({ type: "order" as const, id: o._id, label: o.trackingNumber, sublabel: o.customerName })),
      ];
      return ok(res, { results });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── MAINTENANCE (backup/restore) ──────────────────────
  app.get("/api/maintenance/backup", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const [items, customers, orders, payments, inventoryLogs, accounts, ledger, settings, systemLogs, users] =
        await Promise.all([
          Item.find().lean(),
          Customer.find().lean(),
          Order.find().lean(),
          BillingPayment.find().lean(),
          InventoryLog.find().lean(),
          AccountingAccount.find().lean(),
          GeneralLedgerEntry.find().lean(),
          Settings.find().lean(),
          SystemLog.find().lean(),
          User.find().lean(),
        ]);

      await logAction("BACKUP_CREATED", req.user!.username);
      return ok(res, { items, customers, orders, payments, inventoryLogs, accounts, ledger, settings, systemLogs, users, exportDate: new Date() });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── HELP / FEEDBACK ───────────────────────────────────
  app.post("/api/feedback", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { message, category } = req.body;
      if (!message) return fail(res, 400, "Message is required");
      await SystemLog.create({ action: "FEEDBACK_SUBMITTED", actor: req.user!.username, target: category || "general", metadata: { message } });
      return ok(res, { message: "Feedback submitted" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── MESSAGES ──────────────────────────────────────────
  app.get("/api/messages", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const messages = await SystemLog.find({ action: "EMPLOYEE_MESSAGE" }).sort({ createdAt: -1 }).limit(50).lean();
      return ok(res, messages);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { subject, message } = req.body;
      if (!subject || !message) return fail(res, 400, "Subject and message required");
      await SystemLog.create({
        action: "EMPLOYEE_MESSAGE",
        actor: req.user!.username,
        target: "admin",
        metadata: { subject, message },
      });
      return ok(res, { message: "Message sent" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/messages/:id/read", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const log = await SystemLog.findByIdAndUpdate(req.params.id, { "metadata.read": true }, { new: true });
      if (!log) return fail(res, 404, "Message not found");
      return ok(res, log);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── SERVE TUTORIAL MP3 FILES ─────────────────────────────
  // TUTORIAL OVERHAUL: Add this route to serve MP3 files from /tutorial_mp3/ folder.
  // Files are named tut1.mp3 through tut17.mp3.
  // Frontend will request: GET /api/tutorial-audio/tut1.mp3
  // Implementation:
  //   const TUTORIAL_DIR = path.join(process.cwd(), "tutorial_mp3");
  //   app.get("/api/tutorial-audio/:filename", (req, res) => {
  //     const filePath = path.join(TUTORIAL_DIR, req.params.filename);
  //     if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  //     res.setHeader("Content-Type", "audio/mpeg");
  //     res.sendFile(filePath);
  //   });

  // ─── SERVE UPLOADED IMAGES ────────────────────────────────
  app.get("/api/uploads/:filename", (req: Request, res: Response) => {
    const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
    res.sendFile(filePath);
  });

  // ─── ITEM IMAGE UPLOAD ────────────────────────────────────
  app.post("/api/items/:id/image", authMiddleware, imageUpload.single("image"), async (req: AuthRequest, res: Response) => {
    try {
      const item = await Item.findById(req.params.id);
      if (!item) return fail(res, 404, "Item not found");
      if (!req.file) return fail(res, 400, "No image file provided");

      const filename = req.file.filename;

      if (req.user!.role === "ADMIN") {
        if (item.imageFilename) {
          const oldPath = path.join(UPLOADS_DIR, item.imageFilename);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        item.imageFilename = filename;
        item.imagePending = false;
        item.pendingImageFilename = "";
        item.pendingImageUploadedBy = "";
        await item.save();
        await logAction("ITEM_IMAGE_UPLOADED", req.user!.username, item.itemName, { filename });
      } else {
        if (item.pendingImageFilename) {
          const oldPending = path.join(UPLOADS_DIR, item.pendingImageFilename);
          if (fs.existsSync(oldPending)) fs.unlinkSync(oldPending);
        }
        item.imagePending = true;
        item.pendingImageFilename = filename;
        item.pendingImageUploadedBy = req.user!.username;
        await item.save();
        await ImageApproval.create({
          itemId: item._id,
          filename,
          uploadedBy: req.user!.username,
        });
        await logAction("ITEM_IMAGE_PENDING", req.user!.username, item.itemName, { filename });
      }

      return ok(res, item);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.delete("/api/items/:id/image", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const item = await Item.findById(req.params.id);
      if (!item) return fail(res, 404, "Item not found");

      if (item.imageFilename) {
        const filePath = path.join(UPLOADS_DIR, item.imageFilename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      item.imageFilename = "";
      item.imagePending = false;
      item.pendingImageFilename = "";
      item.pendingImageUploadedBy = "";
      await item.save();
      await logAction("ITEM_IMAGE_DELETED", req.user!.username, item.itemName);
      return ok(res, item);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── IMAGE APPROVAL ───────────────────────────────────────
  app.get("/api/image-approvals", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      const pending = await ImageApproval.find({ status: "pending" }).sort({ createdAt: -1 }).lean();
      const itemIds = pending.map((p) => p.itemId);
      const items = await Item.find({ _id: { $in: itemIds } }).lean();
      const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
      const result = pending.map((p) => ({
        ...p,
        item: itemMap.get(p.itemId.toString()),
      }));
      return ok(res, result);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/image-approvals/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { action } = req.body;
      const approval = await ImageApproval.findById(req.params.id);
      if (!approval) return fail(res, 404, "Approval not found");

      if (action === "approve") {
        const item = await Item.findById(approval.itemId);
        if (item) {
          if (item.imageFilename) {
            const oldPath = path.join(UPLOADS_DIR, item.imageFilename);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          }
          item.imageFilename = approval.filename;
          item.imagePending = false;
          item.pendingImageFilename = "";
          item.pendingImageUploadedBy = "";
          await item.save();
        }
        approval.status = "approved";
        approval.reviewedBy = req.user!.username;
        await approval.save();
        await logAction("ITEM_IMAGE_APPROVED", req.user!.username, item?.itemName || "", { filename: approval.filename });
      } else {
        const filePath = path.join(UPLOADS_DIR, approval.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        const item = await Item.findById(approval.itemId);
        if (item) {
          item.imagePending = false;
          item.pendingImageFilename = "";
          item.pendingImageUploadedBy = "";
          await item.save();
        }
        approval.status = "rejected";
        approval.reviewedBy = req.user!.username;
        await approval.save();
        await logAction("ITEM_IMAGE_REJECTED", req.user!.username, item?.itemName || "", { filename: approval.filename });
      }

      return ok(res, approval);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── BACKUP UPLOAD (RESTORE) ──────────────────────────────
  app.post("/api/maintenance/backup/upload", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const backupData = req.body;
      if (!backupData || typeof backupData !== "object") return fail(res, 400, "Invalid backup data");

      const requiredKeys = ["items", "orders"];
      const hasRequired = requiredKeys.some((key) => Array.isArray(backupData[key]));
      if (!hasRequired) return fail(res, 400, "Backup file must contain valid data (items, orders, etc.)");

      await Promise.all([
        backupData.items?.length > 0 ? Item.deleteMany({}).then(() => Item.insertMany(backupData.items, { ordered: false })) : Promise.resolve(),
        backupData.customers?.length > 0 ? Customer.deleteMany({}).then(() => Customer.insertMany(backupData.customers, { ordered: false })) : Promise.resolve(),
        backupData.orders?.length > 0 ? Order.deleteMany({}).then(() => Order.insertMany(backupData.orders, { ordered: false })) : Promise.resolve(),
        backupData.payments?.length > 0 ? BillingPayment.deleteMany({}).then(() => BillingPayment.insertMany(backupData.payments, { ordered: false })) : Promise.resolve(),
        backupData.inventoryLogs?.length > 0 ? InventoryLog.deleteMany({}).then(() => InventoryLog.insertMany(backupData.inventoryLogs, { ordered: false })) : Promise.resolve(),
        backupData.accounts?.length > 0 ? AccountingAccount.deleteMany({}).then(() => AccountingAccount.insertMany(backupData.accounts, { ordered: false })) : Promise.resolve(),
        backupData.ledger?.length > 0 ? GeneralLedgerEntry.deleteMany({}).then(() => GeneralLedgerEntry.insertMany(backupData.ledger, { ordered: false })) : Promise.resolve(),
        backupData.settings?.length > 0 ? Settings.deleteMany({}).then(() => Settings.insertMany(backupData.settings, { ordered: false })) : Promise.resolve(),
        backupData.users?.length > 0 ? User.deleteMany({}).then(() => User.insertMany(backupData.users, { ordered: false })) : Promise.resolve(),
      ]);

      await logAction("BACKUP_RESTORED", req.user!.username, "", { collections: Object.keys(backupData) });
      return ok(res, { message: "Backup restored successfully" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── AUTO BACKUP SETTINGS ────────────────────────────────
  app.get("/api/maintenance/auto-backup/settings", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      let settings = await Settings.findOne();
      if (!settings) settings = await Settings.create({});
      return ok(res, {
        enabled: settings.autoBackupEnabled,
        intervalValue: settings.autoBackupIntervalValue,
        intervalUnit: settings.autoBackupIntervalUnit,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/maintenance/auto-backup/settings", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { enabled, intervalValue, intervalUnit } = req.body;
      let settings = await Settings.findOne();
      if (!settings) settings = await Settings.create({});

      if (typeof enabled === "boolean") settings.autoBackupEnabled = enabled;
      if (intervalValue !== undefined) settings.autoBackupIntervalValue = Math.max(1, intervalValue);
      if (intervalUnit) settings.autoBackupIntervalUnit = intervalUnit;
      await settings.save();

      setupAutoBackupScheduler(settings.autoBackupIntervalValue, settings.autoBackupIntervalUnit, settings.autoBackupEnabled);

      await logAction("AUTO_BACKUP_SETTINGS_CHANGED", req.user!.username, "", {
        enabled: settings.autoBackupEnabled,
        interval: `${settings.autoBackupIntervalValue} ${settings.autoBackupIntervalUnit}`,
      });

      return ok(res, {
        enabled: settings.autoBackupEnabled,
        intervalValue: settings.autoBackupIntervalValue,
        intervalUnit: settings.autoBackupIntervalUnit,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/maintenance/auto-backup/trigger", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      await performAutoBackup();
      return ok(res, { message: "Manual backup created" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── BACKUP HISTORY ──────────────────────────────────────
  app.get("/api/maintenance/backup/history", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { page = "1", pageSize = "5" } = req.query as Record<string, string>;
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [history, total] = await Promise.all([
        BackupHistory.find().sort({ createdAt: -1 }).skip(skip).limit(parseInt(pageSize)).lean(),
        BackupHistory.countDocuments(),
      ]);
      return ok(res, { history, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.get("/api/maintenance/backup/download/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const record = await BackupHistory.findById(req.params.id);
      if (!record) return fail(res, 404, "Backup not found");

      const filePath = path.join(BACKUPS_DIR, record.filename);
      if (!fs.existsSync(filePath)) return fail(res, 404, "Backup file not found on disk");

      res.download(filePath, record.filename);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── DEVELOPER WIPE ──────────────────────────────────────
  app.post("/api/maintenance/wipe", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      await Promise.all([
        Item.deleteMany({}),
        Customer.deleteMany({}),
        Order.deleteMany({}),
        BillingPayment.deleteMany({}),
        InventoryLog.deleteMany({}),
        AccountingAccount.deleteMany({}),
        GeneralLedgerEntry.deleteMany({}),
        SystemLog.deleteMany({}),
        BackupHistory.deleteMany({}),
        ImageApproval.deleteMany({}),
      ]);

      const uploadFiles = fs.readdirSync(UPLOADS_DIR);
      uploadFiles.forEach((f) => {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch {}
      });
      const backupFiles = fs.readdirSync(BACKUPS_DIR);
      backupFiles.forEach((f) => {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch {}
      });

      await logAction("SYSTEM_WIPE", req.user!.username, "", { action: "complete_wipe" });
      return ok(res, { message: "All data has been wiped" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── GEMINI AI ENDPOINTS ──────────────────────────

  async function gatherSystemData(userId?: string) {
    const [items, orders, payments, users, inventoryLogs, systemLogs, accounts, ledger, customers] = await Promise.all([
      Item.find({}).lean().then(docs => docs.map(d => ({ name: d.itemName, category: d.category, price: d.unitPrice, stock: d.currentQuantity }))),
      Order.find({}).sort({ createdAt: -1 }).limit(100).lean().then(docs => docs.map(d => ({
        trackingNumber: d.trackingNumber, customerName: d.customerName, totalAmount: d.totalAmount,
        currentStatus: d.currentStatus, sourceChannel: d.sourceChannel, items: d.items?.length || 0,
        createdAt: d.createdAt,
      }))),
      BillingPayment.find({}).sort({ paymentDate: -1 }).limit(100).lean().then(docs => docs.map(d => ({
        orderId: d.orderId, amountPaid: d.amountPaid, paymentMethod: d.paymentMethod,
        gcashNumber: d.gcashNumber, gcashReferenceNumber: d.gcashReferenceNumber,
        loggedBy: d.loggedBy, paymentDate: d.paymentDate,
      }))),
      User.find({}).lean().then(docs => docs.map(d => ({
        username: d.username, role: d.role, active: d.isActive,
      }))),
      InventoryLog.find({}).sort({ createdAt: -1 }).limit(100).lean().then(docs => docs.map(d => ({
        itemName: d.itemName, type: d.type, quantity: d.quantity, reason: d.reason, actor: d.actor, createdAt: d.createdAt,
      }))),
      SystemLog.find({}).sort({ createdAt: -1 }).limit(100).lean().then(docs => docs.map(d => ({
        action: d.action, actor: d.actor, target: d.target, createdAt: d.createdAt,
      }))),
      AccountingAccount.find({}).lean().then(docs => docs.map(d => ({
        accountName: d.accountName, accountType: d.accountType, balance: d.balance,
      }))),
      GeneralLedgerEntry.find({}).sort({ date: -1 }).limit(50).lean().then(docs => docs.map(d => ({
        date: d.date, description: d.description,
        debitAccount: (d as any).debitAccount, creditAccount: (d as any).creditAccount, amount: (d as any).amount,
      }))),
      Customer.find({}).lean().then(docs => docs.map(d => ({
        name: d.name, email: d.email, phone: d.phone,
      }))),
    ]);

    const totalRevenue = payments.reduce((s, p) => s + (p.amountPaid || 0), 0);
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.currentStatus === "Pending Payment").length;
    const completedOrders = orders.filter(o => o.currentStatus === "Completed").length;
    const uniqueCustomers = new Set(orders.map(o => o.customerName).filter(Boolean)).size;
    const currentDate = new Date().toISOString();

    const loginLogs = userId
      ? systemLogs.filter(l => l.action === "LOGIN" && l.actor === userId)
      : [];

    return {
      currentDate,
      summary: { totalRevenue, totalOrders, pendingOrders, completedOrders, totalItems: items.length, totalUsers: users.length, totalCustomers: customers.length, uniqueCustomersWithOrders: uniqueCustomers },
      items, orders, payments, users, customers, inventoryLogs, systemLogs, accounts, ledger,
      loginLogsForCurrentUser: loginLogs,
    };
  }

  async function callGeminiText(prompt: string): Promise<string> {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json() as any;
    if (!response.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      throw new Error(data.error?.message || "Gemini API request failed");
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from AI";
  }

  async function callGeminiTTS(textToSpeak: string): Promise<{ text: string; audioBase64: string; mimeType: string }> {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const ttsPrompt = `Say the following in a friendly, helpful tone: ${textToSpeak}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ttsPrompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: "Leda" },
              },
            },
          },
        }),
      }
    );

    const data = await response.json() as any;
    if (!response.ok) {
      console.error("Gemini TTS error:", JSON.stringify(data));
      throw new Error(data.error?.message || "Gemini TTS request failed");
    }
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const audioBase64 = part?.inlineData?.data || "";
    const mimeType = part?.inlineData?.mimeType || "audio/L16;codec=pcm;rate=24000";
    return { text: textToSpeak, audioBase64, mimeType };
  }

  app.post("/api/gemini-chat", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { message } = req.body;
      if (!message) return fail(res, 400, "Message is required");

      const fullData = await gatherSystemData(req.user?.username);

      const prompt = `You are JOAP Hardware Trading's AI assistant. Answer using ONLY the provided system data. Be concise, helpful, and accurate. Format numbers as PHP currency where appropriate. Today's date is ${fullData.currentDate}.

User question: ${message}

System data:
${JSON.stringify(fullData, null, 0)}`;

      const text = await callGeminiText(prompt);
      return ok(res, { text });
    } catch (err: any) {
      console.error("Gemini chat error:", err.message);
      return fail(res, 500, err.message || "AI chat failed");
    }
  });

  function pcmToWavBase64(pcmBase64: string, sampleRate: number = 24000, channels: number = 1, bitsPerSample: number = 16): string {
    const pcmBuffer = Buffer.from(pcmBase64, "base64");
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const wavHeaderSize = 44;
    const wavBuffer = Buffer.alloc(wavHeaderSize + pcmBuffer.length);

    wavBuffer.write("RIFF", 0);
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavBuffer.write("WAVE", 8);
    wavBuffer.write("fmt ", 12);
    wavBuffer.writeUInt32LE(16, 16);
    wavBuffer.writeUInt16LE(1, 20);
    wavBuffer.writeUInt16LE(channels, 22);
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(byteRate, 28);
    wavBuffer.writeUInt16LE(blockAlign, 32);
    wavBuffer.writeUInt16LE(bitsPerSample, 34);
    wavBuffer.write("data", 36);
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
    pcmBuffer.copy(wavBuffer, 44);

    return wavBuffer.toString("base64");
  }

  app.post("/api/voice-insight", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { question, clickedPoint } = req.body;
      if (!question) return fail(res, 400, "Question is required");

      const fullData = await gatherSystemData(req.user?.username);

      const textPrompt = `You are a business analytics voice assistant for JOAP Hardware Trading. Answer using ONLY the provided JSON data. Be concise, speak naturally in 2-3 sentences max. Today's date is ${fullData.currentDate}.

IMPORTANT: The user clicked on a specific dashboard card/chart element. The "Clicked data point" below contains the EXACT values currently displayed on the dashboard for that element. These values are the authoritative, filtered numbers for the selected time period. When the user asks about the value of the clicked element, use the values from "Clicked data point" as the definitive answer. Do NOT recalculate or count from the raw data below — the raw data is unfiltered and may cover different time periods.

Clicked data point: ${JSON.stringify(clickedPoint || {})}

User question: ${question}

Raw system data (for additional context only, NOT for recounting dashboard values):
${JSON.stringify(fullData, null, 0)}`;

      const textAnswer = await callGeminiText(textPrompt);

      let audioBase64 = "";
      try {
        const ttsResult = await callGeminiTTS(textAnswer);
        if (ttsResult.audioBase64) {
          const sampleRate = parseInt(ttsResult.mimeType.match(/rate=(\d+)/)?.[1] || "24000");
          audioBase64 = pcmToWavBase64(ttsResult.audioBase64, sampleRate);
          console.log(`TTS: generated ${audioBase64.length} chars of WAV audio (${sampleRate}Hz)`);
        } else {
          console.warn("TTS: Gemini returned empty audio data");
        }
      } catch (ttsErr: any) {
        console.error("TTS generation failed (returning text only):", ttsErr.message);
      }

      return ok(res, { text: textAnswer, audioBase64 });
    } catch (err: any) {
      console.error("Voice insight error:", err.message);
      return fail(res, 500, err.message || "Voice generation failed");
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // REQUESTS (employee → admin approval workflows: ADD_ITEM, TRANSFER_ORDER, LEAVE)
  // ════════════════════════════════════════════════════════════════════════════

  // List requests (admin sees all; employee sees own)
  app.get("/api/requests", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { status, requestType, mine } = req.query as Record<string, string>;
      const filter: any = {};
      if (status) filter.status = status;
      if (requestType) filter.requestType = requestType;
      if (req.user!.role !== "ADMIN" || mine === "true") {
        filter.requester = req.user!.username;
      }
      const list = await RequestModel.find(filter).sort({ createdAt: -1 }).lean();
      return ok(res, list);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Create request (employee)
  app.post("/api/requests", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { requestType, itemPayload, transferPayload, leavePayload, reason } = req.body;
      if (!["ADD_ITEM", "TRANSFER_ORDER", "LEAVE"].includes(requestType)) {
        return fail(res, 400, "Invalid request type");
      }
      const me = req.user!.username;
      const doc = await RequestModel.create({
        requestType,
        requester: me,
        requesterDisplay: me,
        status: "pending",
        reason: reason || "",
        itemPayload,
        transferPayload,
        leavePayload,
        history: [{ status: "pending", actor: me, timestamp: new Date(), note: "Request submitted" }],
      });
      await logAction("REQUEST_CREATED", me, doc._id.toString(), { requestType });
      emitEvent("request:created", { requestId: doc._id.toString(), requestType, requester: me });
      return ok(res, doc);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Cancel request (employee, only own pending)
  app.post("/api/requests/:id/cancel", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const doc = await RequestModel.findById(req.params.id);
      if (!doc) return fail(res, 404, "Request not found");
      if (doc.requester !== req.user!.username) return fail(res, 403, "Not your request");
      if (doc.status !== "pending") return fail(res, 400, "Cannot cancel a non-pending request");
      doc.status = "cancelled";
      doc.decidedAt = new Date();
      doc.history.push({ status: "cancelled", actor: req.user!.username, timestamp: new Date(), note: "Cancelled by requester" });
      await doc.save();
      await logAction("REQUEST_CANCELLED", req.user!.username, doc._id.toString(), {});
      emitEvent("request:updated", { requestId: doc._id.toString(), status: "cancelled" });
      return ok(res, doc);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Accept request (admin)
  app.post("/api/requests/:id/accept", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { note } = req.body;
      const doc = await RequestModel.findById(req.params.id);
      if (!doc) return fail(res, 404, "Request not found");
      if (doc.status !== "pending") return fail(res, 400, "Request already decided");

      // Perform the actual action depending on request type
      if (doc.requestType === "ADD_ITEM" && doc.itemPayload) {
        await Item.create({
          itemName: doc.itemPayload.itemName,
          category: doc.itemPayload.category || "Uncategorized",
          unitPrice: doc.itemPayload.unitPrice || 0,
          currentQuantity: doc.itemPayload.currentQuantity || 0,
          supplierName: doc.itemPayload.supplier || "",
        });
        await logAction("ITEM_CREATED_FROM_REQUEST", req.user!.username, doc.itemPayload.itemName || "");
      } else if (doc.requestType === "TRANSFER_ORDER" && doc.transferPayload?.orderId && doc.transferPayload?.targetUsername) {
        const target = doc.transferPayload.targetUsername;
        const order = await Order.findByIdAndUpdate(
          doc.transferPayload.orderId,
          {
            $set: { assignedTo: target, assignedToName: target, assignedAt: new Date(), assignedBy: req.user!.username },
            $unset: { startedAt: "", completedProcessingAt: "" },
            $push: { statusHistory: { status: "assigned", timestamp: new Date(), actor: req.user!.username, note: `Transferred via request approval (from ${doc.requester} to ${target})` } },
          },
          { new: true }
        );
        if (order) {
          emitEvent("order:assigned", { orderId: order._id.toString(), trackingNumber: order.trackingNumber, assignedTo: target, assignedBy: req.user!.username, customerName: order.customerName });
        }
      } else if (doc.requestType === "LEAVE") {
        await EmployeeProfile.updateOne({ username: doc.requester }, { $inc: { approvedLeaves: 1 } }, { upsert: true });
      }

      doc.status = "accepted";
      doc.approver = req.user!.username;
      doc.approverNote = note || "";
      doc.decidedAt = new Date();
      doc.history.push({ status: "accepted", actor: req.user!.username, timestamp: new Date(), note: note || "Accepted" });
      await doc.save();
      await logAction("REQUEST_ACCEPTED", req.user!.username, doc._id.toString(), { requestType: doc.requestType });
      emitEvent("request:updated", { requestId: doc._id.toString(), status: "accepted" });
      return ok(res, doc);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Decline request (admin)
  app.post("/api/requests/:id/decline", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { note } = req.body;
      const doc = await RequestModel.findById(req.params.id);
      if (!doc) return fail(res, 404, "Request not found");
      if (doc.status !== "pending") return fail(res, 400, "Request already decided");

      if (doc.requestType === "LEAVE") {
        await EmployeeProfile.updateOne({ username: doc.requester }, { $inc: { rejectedLeaves: 1 } }, { upsert: true });
      }

      doc.status = "declined";
      doc.approver = req.user!.username;
      doc.approverNote = note || "";
      doc.decidedAt = new Date();
      doc.history.push({ status: "declined", actor: req.user!.username, timestamp: new Date(), note: note || "Declined" });
      await doc.save();
      await logAction("REQUEST_DECLINED", req.user!.username, doc._id.toString(), { requestType: doc.requestType });
      emitEvent("request:updated", { requestId: doc._id.toString(), status: "declined" });
      return ok(res, doc);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // MESSAGES (admin ↔ employee internal messaging)
  // ════════════════════════════════════════════════════════════════════════════

  // List messages for current user (inbox)
  app.get("/api/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const me = req.user!.username;
      const { direction } = req.query as Record<string, string>;
      const filter: any = {};
      if (direction === "sent") filter.fromUsername = me;
      else filter.toUsername = me;
      const list = await Message.find(filter).sort({ createdAt: -1 }).lean();
      return ok(res, list);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Admin: list all messages (for admin's message management)
  app.get("/api/messages/admin/all", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      const list = await Message.find().sort({ createdAt: -1 }).lean();
      return ok(res, list);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Send message
  app.post("/api/messages", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { toUsername, subject, body } = req.body;
      if (!toUsername || !body) return fail(res, 400, "Recipient and body are required");
      const me = req.user!.username;
      const direction = req.user!.role === "ADMIN" ? "ADMIN_TO_EMPLOYEE" : "EMPLOYEE_TO_ADMIN";
      const msg = await Message.create({
        direction, fromUsername: me, toUsername, subject: subject || "", body, isRead: false,
      });
      await logAction("MESSAGE_SENT", me, toUsername, { subject });
      emitEvent("message:new", { messageId: msg._id.toString(), toUsername, fromUsername: me });
      return ok(res, msg);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Mark message as read
  app.patch("/api/messages/:id/read", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const me = req.user!.username;
      const msg = await Message.findById(req.params.id);
      if (!msg) return fail(res, 404, "Message not found");
      if (msg.toUsername !== me) return fail(res, 403, "Not your message");
      msg.isRead = true;
      msg.readAt = new Date();
      await msg.save();
      return ok(res, msg);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Delete single message (requires password verification on client side)
  app.delete("/api/messages/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const me = req.user!.username;
      const msg = await Message.findById(req.params.id);
      if (!msg) return fail(res, 404, "Message not found");
      // Allow admin to delete any; users can delete their own (sent or received)
      if (req.user!.role !== "ADMIN" && msg.toUsername !== me && msg.fromUsername !== me) {
        return fail(res, 403, "Not allowed");
      }
      await Message.findByIdAndDelete(req.params.id);
      await logAction("MESSAGE_DELETED", me, String(req.params.id));
      return ok(res, { deleted: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Bulk delete (admin only) — requires password confirmation on client
  app.post("/api/messages/bulk-delete", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!ids?.length) {
        await Message.deleteMany({});
      } else {
        await Message.deleteMany({ _id: { $in: ids } });
      }
      await logAction("MESSAGES_BULK_DELETED", req.user!.username, "", { count: ids?.length || "all" });
      return ok(res, { deleted: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // EMPLOYEE PROFILES (extended profile data: photo, email, contact, employee ID)
  // ════════════════════════════════════════════════════════════════════════════

  // Get my profile
  app.get("/api/employee-profile/me", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const me = req.user!.username;
      let profile = await EmployeeProfile.findOne({ username: me });
      if (!profile) {
        // Auto-create
        const userDoc = await User.findById(req.user!._id);
        const empId = `JOAP-${String(Date.now()).slice(-5).padStart(5, "0")}`;
        profile = await EmployeeProfile.create({
          username: me,
          employeeId: empId,
          hireDate: userDoc?.createdAt || new Date(),
        });
      }
      return ok(res, profile);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Get profile by username (admin only)
  app.get("/api/employee-profile/:username", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      let profile = await EmployeeProfile.findOne({ username: req.params.username });
      if (!profile) {
        const userDoc = await User.findOne({ username: req.params.username });
        if (!userDoc) return fail(res, 404, "User not found");
        const empId = `JOAP-${String(Date.now()).slice(-5).padStart(5, "0")}`;
        profile = await EmployeeProfile.create({
          username: String(req.params.username),
          employeeId: empId,
          hireDate: userDoc.createdAt,
        });
      }
      return ok(res, profile);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Update profile (self or admin)
  app.patch("/api/employee-profile/:username", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const isAdmin = req.user!.role === "ADMIN";
      if (!isAdmin && req.user!.username !== req.params.username) return fail(res, 403, "Not allowed");
      const allowedFields = ["photoDataUrl", "email", "contactNumber", "adminRemarks"];
      const updates: any = {};
      for (const key of allowedFields) {
        if (key in req.body) updates[key] = req.body[key];
      }
      // adminRemarks is admin-only
      if (updates.adminRemarks && !isAdmin) delete updates.adminRemarks;
      const profile = await EmployeeProfile.findOneAndUpdate(
        { username: req.params.username },
        updates,
        { new: true, upsert: true }
      );
      await logAction("EMPLOYEE_PROFILE_UPDATED", req.user!.username, String(req.params.username));
      return ok(res, profile);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Employee summary for admin profile modal — productivity, orders, attendance
  app.get("/api/employee-profile/:username/summary", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const username = req.params.username;
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [completedOrders, recentOrders, recentReservations, recentLogs, profile, userDoc] = await Promise.all([
        Order.countDocuments({ assignedTo: username, fulfillmentStatus: "completed" }),
        Order.find({ assignedTo: username }).sort({ createdAt: -1 }).limit(20).lean(),
        Order.find({
          assignedTo: username,
          orderType: { $in: ["online_reservation", "walkin_reservation"] },
          createdAt: { $gte: since },
        }).sort({ createdAt: -1 }).limit(20).lean(),
        SystemLog.find({ actor: username }).sort({ createdAt: -1 }).limit(50).lean(),
        EmployeeProfile.findOne({ username }).lean(),
        User.findOne({ username }).lean(),
      ]);

      const reservationsCount30d = await Order.countDocuments({
        assignedTo: username,
        orderType: { $in: ["online_reservation", "walkin_reservation"] },
        createdAt: { $gte: since },
      });
      const pendingLeaves = await RequestModel.countDocuments({ requester: username, requestType: "LEAVE", status: "pending" });

      // Per-day order count for last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const perDay = await Order.aggregate([
        { $match: { assignedTo: username, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // lastLogin is tracked separately (UserSession lastActivity); use createdAt as fallback
      const session = await UserSession.findOne({ userId: userDoc?._id }).sort({ lastActivity: -1 }).lean();
      const lastLogin = session?.lastActivity || userDoc?.createdAt || null;
      return ok(res, {
        profile,
        user: userDoc ? { username: userDoc.username, role: userDoc.role, isActive: userDoc.isActive, lastLogin, createdAt: userDoc.createdAt } : null,
        kpi: {
          completedOrders,
          reservationsCreated30d: reservationsCount30d,
          absences30d: 0,
          pendingLeaves,
        },
        recentOrders,
        recentReservations,
        recentLogs,
        productivityChart: perDay,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // List all employees (admin only) — used by Employees nav
  app.get("/api/employees", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      const employees = await User.find({ role: "EMPLOYEE" }).select("-password").lean();
      const usernames = employees.map((e) => e.username);
      const profiles = await EmployeeProfile.find({ username: { $in: usernames } }).lean();
      const profileMap = new Map(profiles.map((p) => [p.username, p]));
      const enriched = employees.map((e) => ({
        ...e,
        profile: profileMap.get(e.username) || null,
      }));
      return ok(res, enriched);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  return httpServer;
}
