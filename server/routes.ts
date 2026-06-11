import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import cron from "node-cron";
import { randomUUID } from "crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

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
import SiteVisitor from "./models/SiteVisitor";
import Notification from "./models/Notification";
import ItemRequest from "./models/ItemRequest";
import PaymentAudit, { type PaymentAuditFlag } from "./models/PaymentAudit";
import { arima, bucketByDay } from "./lib/arima";
import { DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD } from "./seed";

// ─── Resend transactional email (auto-backup delivery) ───────────────────────
// The JSON backup is emailed as an attachment so the owner always has an
// off-box copy. Key can be overridden via env; default ships with the project.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_NiAiTR6w_71WAZ6hvgseuyD6vDR7kKvX6";
const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

async function sendBackupEmail(to: string, filename: string, json: string): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "No recipient email configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `JOAP Backup <${RESEND_FROM}>`,
        to: [to],
        subject: `JOAP Backup — ${filename}`,
        html: `<p>Attached is the latest <strong>JOAP Hardware Trading</strong> database backup.</p>
               <p>File: <code>${filename}</code><br/>Generated: ${new Date().toLocaleString("en-PH")}</p>
               <p>Keep this JSON safe — uploading it under Maintenance → Restore fully repopulates the system.</p>`,
        attachments: [{ filename, content: Buffer.from(json).toString("base64") }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

let io: SocketIOServer;

function emitEvent(event: string, data?: any) {
  if (io) io.emit(event, data);
}

// In-memory store for login-attempt alerts so the polling fallback works
// even when the socket event was missed (e.g. socket momentarily disconnected).
// Map<username, timestampMs>  — entries expire after 2 minutes.
const loginAttemptStore = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  loginAttemptStore.forEach((ts, username) => {
    if (ts < cutoff) loginAttemptStore.delete(username);
  });
}, 30_000);

async function logAction(action: string, actor: string, target = "", metadata: Record<string, any> = {}) {
  await SystemLog.create({ action, actor, target, metadata });
}

/**
 * Stock-health helpers. New thresholds (REQUEST.pdf round 7):
 *   Low      = currentQuantity ≤ startingStock × 0.25
 *   Critical = currentQuantity ≤ startingStock × 0.125
 *
 * Legacy fallback: items created before the startingStock field existed
 * have startingStock=0. For those, use the reorderLevel as a stand-in
 * baseline so they don't silently report as "Normal" forever:
 *   Low      = currentQuantity ≤ reorderLevel
 *   Critical = currentQuantity ≤ reorderLevel / 2 (or 0)
 * If both startingStock AND reorderLevel are 0, only outright zero counts
 * as critical.
 *
 * Bands are mutually exclusive: Critical is the inner band so an item that
 * is critical is NOT also counted as low.
 */
function stockBands(item: { currentQuantity?: number; startingStock?: number; reorderLevel?: number }) {
  const start = Math.max(0, item.startingStock || 0);
  const reorder = Math.max(0, item.reorderLevel || 0);
  const q = Math.max(0, item.currentQuantity || 0);

  let lowThreshold = 0;
  let criticalThreshold = 0;
  if (start > 0) {
    lowThreshold = start * 0.25;
    criticalThreshold = start * 0.125;
  } else if (reorder > 0) {
    // Legacy fallback — interpret reorderLevel as the boundary of "low".
    lowThreshold = reorder;
    criticalThreshold = reorder * 0.5;
  } else {
    return { critical: q <= 0, low: false, lowThreshold: 0, criticalThreshold: 0 };
  }
  const critical = q <= criticalThreshold;
  const low = !critical && q <= lowThreshold;
  return { critical, low, lowThreshold, criticalThreshold };
}

/**
 * Fire a Reorder Point notification if currentQuantity just crossed the
 * item's computed ROP downward. Called from every stock-decrement path.
 */
async function maybeFireROPAlert(item: any, before: number, after: number) {
  try {
    const rop = (item.avgDailyUsage || 0) * (item.leadTimeDays || 0) + (item.safetyStock || 0);
    if (rop <= 0) return;
    if (before > rop && after <= rop) {
      await notify({
        category: "INVENTORY",
        title: `Reorder Point Reached: ${item.itemName}`,
        body: `Current stock ${after} ≤ ROP ${Math.ceil(rop)} (avg daily ${item.avgDailyUsage} × lead ${item.leadTimeDays}d + safety ${item.safetyStock}). Reorder now.`,
        link: "/inventory",
        recipientRole: "ADMIN",
      });
      await notify({
        category: "INVENTORY",
        title: `Reorder Point Reached: ${item.itemName}`,
        body: `Current stock ${after} ≤ ROP ${Math.ceil(rop)}.`,
        link: "/inventory",
        recipientRole: "INVENTORY_MANAGER",
      });
    }
  } catch {}
}

/**
 * Bump (or seed-and-bump) the balance on a single accounting account.
 *
 * The naive `findOneAndUpdate({ accountName }, { $inc: { balance } },
 * { upsert: true })` blew up with a duplicate-key error on `accountCode_1`
 * whenever the account didn't yet exist — two parallel upserts both inserted
 * an "accountCode: null" row at the same time. This helper supplies a
 * deterministic accountCode + accountType via `$setOnInsert` so the upsert
 * is always safe even on a fresh DB.
 */
const KNOWN_ACCOUNTS: Record<string, { accountCode: string; accountType: string }> = {
  "Cash/GCash": { accountCode: "1000", accountType: "Asset" },
  "Accounts Receivable": { accountCode: "1100", accountType: "Asset" },
  "Inventory": { accountCode: "1200", accountType: "Asset" },
  "Accounts Payable": { accountCode: "2000", accountType: "Liability" },
  "Owner's Equity": { accountCode: "3000", accountType: "Equity" },
  "Sales Revenue": { accountCode: "4000", accountType: "Revenue" },
  "Cost of Goods Sold": { accountCode: "5000", accountType: "Expense" },
  "Operating Expenses": { accountCode: "5100", accountType: "Expense" },
};
async function bumpAccountBalance(accountName: string, delta: number) {
  const meta = KNOWN_ACCOUNTS[accountName] || {
    accountCode: `9${Date.now().toString().slice(-5)}`,
    accountType: "Asset",
  };
  // Self-heal any legacy rows that are missing accountCode/accountType
  // (left over from earlier upserts that failed the unique-key check).
  await AccountingAccount.updateMany(
    {
      accountName,
      $or: [
        { accountCode: { $exists: false } },
        { accountCode: null },
        { accountCode: "" },
      ],
    },
    { $set: { accountCode: meta.accountCode, accountType: meta.accountType } },
  );
  return AccountingAccount.findOneAndUpdate(
    { accountName },
    {
      $inc: { balance: delta },
      $setOnInsert: { accountCode: meta.accountCode, accountType: meta.accountType, accountName },
    },
    { upsert: true, new: true },
  );
}

/**
 * Fire-and-forget notification creator. Persists a Notification doc and
 * emits a socket event so every connected client refetches its bell.
 * Errors are swallowed — a notification failure must never break the
 * primary action that triggered it.
 */
async function notify(opts: {
  category: "REQUEST" | "ORDER" | "PAYMENT" | "INVENTORY" | "DELIVERY" | "RESERVATION" | "SYSTEM";
  title: string;
  body?: string;
  link?: string;
  recipientUsername?: string;
  recipientRole?: string;
  createdBy?: string;
}) {
  try {
    const doc = await Notification.create({
      category: opts.category,
      title: opts.title,
      body: opts.body || "",
      link: opts.link || "",
      recipientUsername: opts.recipientUsername || "",
      recipientRole: opts.recipientRole || "",
      createdBy: opts.createdBy || "system",
    });
    emitEvent("NOTIFICATION_NEW", {
      _id: doc._id.toString(),
      category: doc.category,
      title: doc.title,
      recipientUsername: doc.recipientUsername,
      recipientRole: doc.recipientRole,
    });
    return doc;
  } catch (err) {
    console.warn("[notify] failed:", err);
    return null;
  }
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

// ─── GCASH REFERENCE VALIDATION ─────────────────────────────────────────────
//
// Real GCash transaction references are 8–15 character alphanumeric strings
// (the mobile app generates 13-digit numerics, but channel partners and
// merchant flows produce variations). We treat anything outside that band as
// "format invalid" — the payment is STILL accepted (direct-save policy) but
// an audit row is filed so the daily audit catches it.
//
// We also strip a single leading "Ref:" / "Reference No:" prefix that staff
// sometimes paste in by accident, so a well-meaning typist isn't punished.
const GCASH_REF_RE = /^[A-Z0-9]{8,15}$/i;
function normalizeGcashRef(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^(ref(?:erence)?\s*(?:no\.?|number|#)?\s*:?\s*)/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}
function classifyGcashRef(raw: string): { ok: true; ref: string } | { ok: false; reason: string; ref: string } {
  const ref = normalizeGcashRef(raw);
  if (ref.length === 0) return { ok: false, reason: "GCash reference is required for GCash payments", ref };
  if (ref.length < 8) return { ok: false, reason: `Reference too short (got ${ref.length}, need 8–15)`, ref };
  if (ref.length > 15) return { ok: false, reason: `Reference too long (got ${ref.length}, need 8–15)`, ref };
  if (!GCASH_REF_RE.test(ref)) return { ok: false, reason: "Reference must be alphanumeric (A–Z, 0–9)", ref };
  return { ok: true, ref };
}

// ─── PAYMENT AUDIT — append-only anomaly log ────────────────────────────────
async function fileAudit(row: {
  flag: PaymentAuditFlag;
  severity?: "info" | "warn" | "alert";
  detail: string;
  paymentId?: string;
  orderId?: string;
  trackingNumber?: string;
  amount?: number;
  paymentMethod?: string;
  gcashReferenceNumber?: string;
  loggedBy: string;
}) {
  try {
    await PaymentAudit.create({
      flag: row.flag,
      severity: row.severity || "warn",
      detail: row.detail,
      paymentId: row.paymentId,
      orderId: row.orderId,
      trackingNumber: row.trackingNumber,
      amount: row.amount,
      paymentMethod: row.paymentMethod,
      gcashReferenceNumber: row.gcashReferenceNumber,
      loggedBy: row.loggedBy,
    });
  } catch (e) {
    console.error("[PaymentAudit] failed to file audit row", e);
  }
}

// PHT business-hours check (06:00–22:00). Outside this window we still take
// the payment, but flag it for the next morning's audit.
function isAfterHoursPHT(at: Date = new Date()): boolean {
  // PHT is UTC+8 with no DST.
  const phtHours = (at.getUTCHours() + 8) % 24;
  return phtHours < 6 || phtHours >= 22;
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

    // Email the backup as an attachment via Resend so an off-box copy always exists.
    const settings = await Settings.findOne();
    const to = settings?.backupEmail || "marksonguarine@gmail.com";
    const mail = await sendBackupEmail(to, filename, json);
    if (mail.ok) console.log(`[auto-backup] Emailed backup to ${to}`);
    else console.error(`[auto-backup] Email failed: ${mail.error}`);
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

      // Find active sessions created within the past 24 h (matches JWT lifetime).
      // We use createdAt instead of jwt.verify() so this works even if the
      // stored token is null or was rotated — no crypto check needed here.
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const activeSessions = await UserSession.find({
        userId: user._id,
        isActive: true,
        $or: [
          { createdAt: { $gt: since24h } },
          { lastActivity: { $gt: since24h } },
        ],
      }).lean();

      const isPrivilegedRole = user.role === "ADMIN" || user.role === "SUPERADMIN";

      if (activeSessions.length > 0) {
        if (isPrivilegedRole) {
          // ADMIN / SUPERADMIN: force-kick the existing session so the new login wins.
          // Invalidate all active sessions in the DB and in the in-memory cache.
          const sessionTokens = activeSessions.map((s) => s.token);
          await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false });
          sessionTokens.forEach((t) => clearSessionCache(t));
          // Notify the displaced session so it can auto-logout on the client.
          emitEvent("auth:session_kicked", { username: user.username });
        } else {
          // Non-privileged accounts: alert the active device and block the new login.
          emitEvent("auth:login_attempt", { username: user.username });
          loginAttemptStore.set(user.username, Date.now());
          return res.status(409).json({ success: false, error: "ALREADY_ACTIVE_SESSION" });
        }
      } else {
        // No live active sessions — mark any lingering stale ones as inactive.
        await UserSession.updateMany({ userId: user._id, isActive: true }, { isActive: false });
      }

      const token = generateToken({ _id: user._id.toString(), username: user.username, role: user.role });
      await UserSession.create({ userId: user._id, token, isActive: true });

      await logAction("USER_LOGIN", user.username, user.username, {});
      // Broadcast presence so admin tabs can pop the right-side toast.
      emitEvent("presence:login", { username: user.username, role: user.role });

      res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 86400000 });
      return ok(res, {
        token,
        user: { _id: user._id, username: user.username, role: user.role, isActive: user.isActive },
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
      emitEvent("presence:logout", { username: req.user!.username, role: req.user!.role });
      res.clearCookie("token");
      return ok(res, { message: "Logged out" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Polling fallback for security alerts — presence-toaster calls this every
  // 20 s so the active device sees the banner even if the socket event was
  // missed (e.g. brief disconnect). Returns the alert and clears it atomically.
  app.get("/api/auth/security-alert", authMiddleware, (req: AuthRequest, res: Response) => {
    const username = req.user!.username;
    const ts = loginAttemptStore.get(username);
    if (ts && Date.now() - ts < 2 * 60 * 1000) {
      loginAttemptStore.delete(username);
      return ok(res, { alert: true });
    }
    return ok(res, { alert: false });
  });

  /**
   * Forgot password — unauthenticated request handler (REQUEST.pdf R11 §6).
   * Employee or Inventory Manager submits their username; the system files
   * a Request (type=PASSWORD_RESET) visible to admins + super-admin in
   * Requests → Others. Admin "Reset Password" button is race-safe via
   * findOneAndUpdate atomic claim — two admins simultaneously clicking
   * Reset on the same request will produce exactly one success and one
   * "already handled" response.
   */
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { username } = req.body as { username?: string };
      if (!username) return fail(res, 400, "Username is required");
      // Always respond OK to avoid leaking which usernames exist.
      const user = await User.findOne({ username: username.toLowerCase() }).lean();
      if (!user) return ok(res, { filed: false });

      // Block forgot-password for the super admin (must be reset manually).
      if (user.username.toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase()) {
        return fail(res, 403, "The super admin's password cannot be reset via the forgot-password flow.");
      }

      // Dedupe — one pending PASSWORD_RESET per user.
      const existing = await RequestModel.findOne({
        requester: user.username,
        requestType: "PASSWORD_RESET",
        status: "pending",
      });
      if (existing) {
        return ok(res, { filed: true, alreadyPending: true });
      }

      const reqDoc = await RequestModel.create({
        requestType: "PASSWORD_RESET",
        requester: user.username,
        requesterDisplay: user.username,
        reason: `Forgot-password request from login screen at ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`,
        status: "pending",
      });

      await notify({
        category: "REQUEST",
        title: `Password reset requested by ${user.username}`,
        body: `${user.username} (${user.role}) used the "Forgot password" link on the login page. Open Requests → Others to reset.`,
        link: "/requests",
        recipientRole: "ADMIN",
        createdBy: "system",
      });

      await logAction("PASSWORD_RESET_REQUESTED", "system", user.username);
      return ok(res, { filed: true, requestId: reqDoc._id });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Best-effort presence beacon from the browser on tab close.
  app.post("/api/auth/presence-ping", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const kind = req.body?.kind === "login" ? "presence:login" : "presence:logout";
      emitEvent(kind, { username: req.user!.username, role: req.user!.role });
      return ok(res, { ok: true });
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

  // ─── TOS acceptance (server-tracked, per account) ──────────
  // Returns whether the caller has already accepted the current Terms of
  // Service version. The client uses this to decide whether to show the
  // one-shot agreement dialog. Server-side tracking means the prompt
  // follows the account across browsers / devices — accepting on the
  // shop tablet stops it from re-prompting on a manager's laptop.
  app.get("/api/auth/tos-status", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await User.findById(req.user!._id).select("tosAcceptedAt tosVersion");
      const accepted = !!user?.tosAcceptedAt;
      return ok(res, { accepted, acceptedAt: user?.tosAcceptedAt || null, version: user?.tosVersion || null });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/auth/accept-tos", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const version = String(req.body?.version || "1.0");
      await User.findByIdAndUpdate(req.user!._id, {
        $set: { tosAcceptedAt: new Date(), tosVersion: version },
      });
      await logAction("TOS_ACCEPTED", req.user!.username, version, {});
      return ok(res, { accepted: true, version });
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

      // New thresholds (REQUEST.pdf round 7): low/critical against the
      // item's startingStock snapshot, not its reorderLevel.
      //   Low      = currentQuantity ≤ 25%  of startingStock
      //   Critical = currentQuantity ≤ 12.5% of startingStock
      // The two bands are mutually exclusive — Critical is the inner band.
      const isCritical = (i: any) => stockBands(i).critical;
      const isLow = (i: any) => {
        const b = stockBands(i);
        return !b.critical && b.low;
      };
      const criticalStock = items.filter(isCritical).length;
      const lowStock = items.filter(isLow).length;
      const criticalItems = items
        .filter(isCritical)
        .map((i: any) => ({ _id: i._id, itemName: i.itemName, currentQuantity: i.currentQuantity, reorderLevel: i.reorderLevel || 0, startingStock: i.startingStock || 0, unitPrice: i.unitPrice }))
        .sort((a, b) => a.currentQuantity - b.currentQuantity)
        .slice(0, 50);
      const lowStockItems = items
        .filter(isLow)
        .map((i: any) => ({ _id: i._id, itemName: i.itemName, currentQuantity: i.currentQuantity, reorderLevel: i.reorderLevel || 0, startingStock: i.startingStock || 0, unitPrice: i.unitPrice }))
        .slice(0, 50);
      const totalInventoryValue = items.reduce((sum, i) => sum + i.unitPrice * i.currentQuantity, 0);

      const paymentStatusCounts: Record<string, number> = {};
      paymentStatusAgg.forEach((a: any) => { paymentStatusCounts[a._id || "unknown"] = a.count; });

      const orderTypeCounts: Record<string, number> = {};
      orderTypeAgg.forEach((a: any) => { orderTypeCounts[a._id || "unknown"] = a.count; });

      const orderChannelCounts: Record<string, number> = {};
      orderChannelAgg.forEach((a: any) => { orderChannelCounts[a._id || "unknown"] = a.count; });

      // ── Gross margin (real) ───────────────────────────────────────────────
      // (revenue − cost-of-goods-sold) ÷ revenue, computed across PAID orders.
      // COGS approximated as 80% of unitPrice per line (matches the Inventory
      // table's Cost column). Returns a percentage 0–100; 0 if no revenue yet.
      const paidOrderItems = await Order.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $unwind: "$items" },
        {
          $group: {
            _id: null,
            revenue: { $sum: "$items.lineTotal" },
            cost: { $sum: { $multiply: ["$items.originalUnitPrice", "$items.qty", 0.8] } },
          },
        },
      ]);
      const rev = paidOrderItems[0]?.revenue || 0;
      const cost = paidOrderItems[0]?.cost || 0;
      const grossMargin = rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : 0;

      // ── Pending-payments total (real) ─────────────────────────────────────
      // The dashboard banner used to sum the 10 most-recent orders only, so
      // "3 orders ₱73" never matched the Pending Payment page total. Compute
      // the true unpaid balance across ALL pending_payment + partial orders.
      const pendingAgg = await Order.aggregate([
        { $match: { paymentStatus: { $in: ["pending_payment", "partial"] }, fulfillmentStatus: { $nin: ["cancelled"] } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      ]);
      const pendingPaymentsTotal = pendingAgg[0]?.total || 0;
      const pendingPaymentsCount = pendingAgg[0]?.count || 0;

      // ── Pool tally (unassigned active orders) ──────────────────────────
      // Sits next to the pending-payments banner so admins/employees see at
      // a glance how many orders are sitting in the pool waiting for a
      // claim. We treat both empty-string and missing assignedTo as "in
      // pool" (legacy rows may not have the field at all).
      const poolAgg = await Order.aggregate([
        { $match: {
          fulfillmentStatus: { $nin: ["completed", "cancelled"] },
          $or: [{ assignedTo: "" }, { assignedTo: { $exists: false } }, { assignedTo: null }],
        } },
        { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      ]);
      const poolOrdersCount = poolAgg[0]?.count || 0;
      const poolOrdersTotal = poolAgg[0]?.total || 0;

      return ok(res, {
        totalOrdersToday,
        poolOrdersCount, // unassigned active orders
        poolOrdersTotal,
        completedOrders,
        pendingPayments,
        pendingPaymentsTotal, // true sum across ALL pending orders, not just recent
        pendingPaymentsCount, // matches the pending-payment page row count
        pendingReleases,
        todayRevenue: todayPayments[0]?.total || 0,
        totalRevenue: allPayments[0]?.total || 0,
        grossMargin, // live %, 0 when no sales
        activeUsers,
        totalItems,
        criticalStock,
        lowStock,
        criticalItems, // [{itemName, currentQuantity, reorderLevel, unitPrice}] for the KPI dialog
        lowStockItems,
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

      // Rolling-window periods — Today | 7d | 30d | 3m | 1y (REQUEST.pdf §17).
      const dayBucket = "%m-%d"; // MM-DD daily bucket
      const hourBucket = "%H";    // HH hourly bucket (for "today")
      const getPeriodRange = (p: string): { start: Date; prevStart: Date; groupFormat: string; labels: string[] } => {
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const isoDay = (d: Date) => {
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${m}-${day}`;
        };
        const buildDayLabels = (days: number) => {
          const out: string[] = [];
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            out.push(isoDay(d));
          }
          return out;
        };
        const rolling = (days: number) => {
          const s = new Date(today);
          s.setDate(s.getDate() - (days - 1));
          const ps = new Date(s);
          ps.setDate(ps.getDate() - days);
          return { start: s, prevStart: ps, groupFormat: dayBucket, labels: buildDayLabels(days) };
        };
        if (p === "today") {
          // 24 hourly buckets for today; compare against yesterday's totals.
          const s = new Date(today);
          const ps = new Date(today);
          ps.setDate(ps.getDate() - 1);
          const labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
          return { start: s, prevStart: ps, groupFormat: hourBucket, labels };
        }
        if (p === "weekly") return rolling(7);
        if (p === "daily") return rolling(14);     // back-compat
        if (p === "monthly") return rolling(30);
        if (p === "quarterly") return rolling(90); // 3 months
        return rolling(365);                       // 1 year
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
        // Top-items aggregation. PREVIOUSLY this read $items.quantity +
        // $items.unitPrice — neither of which exist on the IOrderItem
        // sub-document (real fields are `qty` and `originalUnitPrice`/
        // `discountedUnitPrice`). Result: every row came back with totalQty=0,
        // which is why the dashboard's "Top items today" rail always showed
        // a flat zero. Fixed to use the actual schema fields.
        Order.aggregate([
          { $match: { createdAt: { $gte: range.start }, fulfillmentStatus: { $ne: "cancelled" } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: { itemId: "$items.itemId", itemName: "$items.itemName" },
              totalQty: { $sum: "$items.qty" },
              totalRevenue: { $sum: "$items.lineTotal" },
              unitPrice: { $first: "$items.originalUnitPrice" },
            },
          },
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

      // Now that labels are MM-DD strings and groupFormat is the matching
      // "%m-%d", we can use the label itself as the bucket key.
      const periodKey = (_: any, i: number): string => range.labels[i];

      const sparklineRevenue = range.labels.map((l, i) => revMap[periodKey(l, i)] || 0);
      const sparklineOrders = range.labels.map((l, i) => ordMap[periodKey(l, i)]?.orders || 0);
      const sparklineCustomers = range.labels.map((l, i) => custMap[periodKey(l, i)] || 0);

      const revenueChartData = range.labels.map((label, i) => {
        const key = periodKey(label, i);
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

  // ─── Super-admin gating ────────────────────────────────────────────────
  // The hardcoded super-admin (DEFAULT_ADMIN_USERNAME) is the only one
  // allowed to deactivate / revoke other admins. Regular admins can still
  // reset passwords on other admins, but they cannot touch the super-admin
  // at all (even passwords). The super-admin's row is fully untouchable.
  const isSuperAdmin = (username?: string) => (username || "").toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase();

  app.patch("/api/admin/users/:id/status", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return fail(res, 404, "User not found");
      if (isSuperAdmin(target.username)) {
        return fail(res, 403, "The super admin cannot be deactivated.");
      }
      // Non-super-admins cannot deactivate any other admin (even peers).
      if (target.role === "ADMIN" && !isSuperAdmin(req.user!.username)) {
        return fail(res, 403, "Only the super admin can deactivate another admin account.");
      }
      target.isActive = !!req.body.isActive;
      await target.save();
      if (!target.isActive) await UserSession.updateMany({ userId: target._id }, { isActive: false });
      await logAction("USER_STATUS_CHANGED", req.user!.username, target.username, { isActive: target.isActive });
      return ok(res, target.toObject({ versionKey: false }));
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/admin/users/:id/role", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return fail(res, 404, "User not found");
      if (isSuperAdmin(target.username)) {
        return fail(res, 403, "The super admin's role cannot be changed.");
      }
      // Demoting (revoking) an admin requires super-admin
      if (target.role === "ADMIN" && req.body.role !== "ADMIN" && !isSuperAdmin(req.user!.username)) {
        return fail(res, 403, "Only the super admin can revoke another admin's access.");
      }
      target.role = req.body.role;
      await target.save();
      await logAction("USER_ROLE_CHANGED", req.user!.username, target.username, { role: target.role });
      return ok(res, target.toObject({ versionKey: false }));
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.post("/api/admin/users/:id/reset-password", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const target = await User.findById(req.params.id);
      if (!target) return fail(res, 404, "User not found");
      // Even super-admins do not reset their OWN credentials through this
      // endpoint — the super admin's password is the hardcoded one. Other
      // admins can have their passwords reset by any admin (per spec).
      if (isSuperAdmin(target.username)) {
        return fail(res, 403, "The super admin's password cannot be reset from here.");
      }
      const tempPass = Math.random().toString(36).slice(-8);
      const hashed = await bcrypt.hash(tempPass, 10);
      target.password = hashed;
      await target.save();
      await logAction("USER_PASSWORD_RESET", req.user!.username, target.username);
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

      // Employees need an APPROVED ADD_ITEM request to add. Admins and
      // inventory managers add directly. The grant is single-use: as soon
      // as the item lands, we flip the request to "used" so they need to
      // request again for the next one.
      let grant: any = null;
      if (req.user!.role === "EMPLOYEE") {
        grant = await ItemRequest.findOneAndUpdate(
          { requestedBy: req.user!.username, action: "ADD_ITEM", status: "approved" },
          { $set: { status: "used", usedAt: new Date() } },
          { sort: { approvedAt: 1 }, new: true },
        );
        if (!grant) {
          return fail(
            res,
            403,
            "Adding items requires admin / inventory-manager approval. Open Inventory → Request to Add Item to ask for permission.",
          );
        }
      }

      // Reorder Point = avg daily sales × lead time + safety stock.
      // (Official ROP formula spec — REQUEST.pdf round 7.)
      const { avgDailyUsage, leadTimeDays, safetyStock } = parsed.data;
      const reorderLevel = Math.ceil((avgDailyUsage * leadTimeDays) + safetyStock);

      // Snapshot the starting stock so low/critical thresholds can later
      // compare against the original — not against an ever-shrinking
      // currentQuantity. Without this, every item would always read "OK".
      const item = await Item.create({
        ...parsed.data,
        reorderLevel,
        startingStock: parsed.data.currentQuantity,
      });

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

      await logAction("ITEM_CREATED", req.user!.username, item.itemName, { grantedBy: grant?.approvedBy });
      await notify({
        category: "INVENTORY",
        title: `New item added: ${item.itemName}`,
        body: `By ${req.user!.username}. Stock starts at ${item.currentQuantity}.`,
        link: "/inventory",
        recipientRole: "ADMIN",
        createdBy: req.user!.username,
      });
      emitEvent("INVENTORY_LOG_CREATED");
      emitEvent("ITEMS_CHANGED");
      return ok(res, item);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Full inventory edit. The previous version only accepted `unitPrice`,
  // which is why "i tried changing the Category cement / Supplier nestea /
  // Unit price 899 / Current stock etc as admin nothing applied". Now we
  // accept every editable field, write a proper InventoryLog when the qty
  // changes, and emit the broad ITEMS_CHANGED socket so every open client
  // refetches their inventory grid + dashboard KPIs.
  app.patch("/api/items/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role === "EMPLOYEE") {
        return fail(res, 403, "Only admin or inventory manager can edit items.");
      }
      const item = await Item.findById(req.params.id);
      if (!item) return fail(res, 404, "Item not found");

      const updates: Record<string, any> = {};
      const before = {
        itemName: item.itemName,
        category: item.category,
        supplierName: (item as any).supplierName,
        unitPrice: item.unitPrice,
        currentQuantity: item.currentQuantity,
        reorderLevel: item.reorderLevel,
      };

      const {
        itemName,
        category,
        supplierName,
        unitPrice,
        currentQuantity,
        reorderLevel,
        avgDailyUsage,
        leadTimeDays,
        safetyStock,
      } = req.body || {};

      if (typeof itemName === "string" && itemName.trim()) updates.itemName = itemName.trim();
      if (typeof category === "string" && category.trim()) updates.category = category.trim();
      if (typeof supplierName === "string") updates.supplierName = supplierName.trim();
      if (typeof unitPrice === "number") {
        if (unitPrice < 0) return fail(res, 400, "Price cannot be negative");
        updates.unitPrice = unitPrice;
      }
      if (typeof currentQuantity === "number") {
        if (currentQuantity < 0) return fail(res, 400, "Current quantity cannot be negative");
        updates.currentQuantity = Math.floor(currentQuantity);
      }
      if (typeof reorderLevel === "number" && reorderLevel >= 0) updates.reorderLevel = Math.floor(reorderLevel);
      // Reorder formula: avg daily × lead days + safety. Only recompute when
      // the caller actually changed those inputs.
      if (typeof avgDailyUsage === "number" || typeof leadTimeDays === "number" || typeof safetyStock === "number") {
        const a = typeof avgDailyUsage === "number" ? avgDailyUsage : (item as any).avgDailyUsage || 0;
        const l = typeof leadTimeDays === "number" ? leadTimeDays : (item as any).leadTimeDays || 0;
        const s = typeof safetyStock === "number" ? safetyStock : (item as any).safetyStock || 0;
        updates.reorderLevel = Math.ceil(a * l + s);
        if (typeof avgDailyUsage === "number") updates.avgDailyUsage = avgDailyUsage;
        if (typeof leadTimeDays === "number") updates.leadTimeDays = leadTimeDays;
        if (typeof safetyStock === "number") updates.safetyStock = safetyStock;
      }

      if (Object.keys(updates).length === 0) {
        return fail(res, 400, "Nothing to update.");
      }

      const updated = await Item.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
      if (!updated) return fail(res, 404, "Item not found");

      // Log a stock adjustment when quantity changed manually.
      if (updates.currentQuantity !== undefined && updates.currentQuantity !== before.currentQuantity) {
        const delta = updates.currentQuantity - before.currentQuantity;
        await InventoryLog.create({
          itemId: updated._id,
          itemName: updated.itemName,
          type: delta >= 0 ? "restock" : "deduction",
          quantity: delta,
          reason: `Manual adjustment by ${req.user!.username} (was ${before.currentQuantity}, now ${updates.currentQuantity})`,
          actor: req.user!.username,
        });
        // A restock that pushes current ABOVE the previous starting stock
        // counts as a fresh starting baseline — otherwise low/critical
        // bands would never reset after admin refills the shelf.
        if (delta > 0 && updates.currentQuantity > ((updated as any).startingStock || 0)) {
          (updated as any).startingStock = updates.currentQuantity;
          await updated.save();
        }
        // ROP alert when adjustment pushes stock at or below the reorder
        // point for the first time.
        if (delta < 0) await maybeFireROPAlert(updated, before.currentQuantity, updates.currentQuantity);
      }

      await logAction("ITEM_UPDATED", req.user!.username, updated.itemName, {
        before,
        after: { ...before, ...updates },
        fields: Object.keys(updates),
      });
      emitEvent("INVENTORY_LOG_CREATED");
      emitEvent("ITEMS_CHANGED");
      return ok(res, updated);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Delete an item — admin / IM only. Refuses if the item is referenced
  // by any non-cancelled order.
  app.delete("/api/items/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role === "EMPLOYEE") {
        return fail(res, 403, "Only admin or inventory manager can delete items.");
      }
      const item = await Item.findById(req.params.id);
      if (!item) return fail(res, 404, "Item not found");

      const inUse = await Order.exists({
        "items.itemId": item._id,
        fulfillmentStatus: { $nin: ["cancelled"] },
      });
      if (inUse) return fail(res, 400, "Cannot delete — item appears in active orders.");

      await Item.findByIdAndDelete(req.params.id);
      await logAction("ITEM_DELETED", req.user!.username, item.itemName);
      emitEvent("ITEMS_CHANGED");
      return ok(res, { deleted: item.itemName });
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

  // Handle a reservation — convert it into a live order so it enters the normal
  // fulfillment pipeline (the order pool). The reservation Order document is
  // promoted in place: its type drops the "_reservation" suffix and fulfillment
  // is reset to pending so staff can claim it.
  app.post("/api/reservations/:id/handle", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Reservation not found");
      if (!["online_reservation", "walkin_reservation"].includes(order.orderType)) {
        return fail(res, 400, "This order is not a reservation");
      }
      const newType = order.orderType === "online_reservation" ? "online_pickup" : "walkin_pickup";
      order.orderType = newType as any;
      if ((order.paymentStatus as string) === "reservation_only") order.paymentStatus = "pending_payment";
      order.fulfillmentStatus = "pending";
      order.currentStatus = order.paymentStatus === "paid" ? "Pending Release" : "Pending Payment";
      (order as any).assignedTo = "";
      (order as any).statusHistory = [
        ...((order as any).statusHistory || []),
        { status: order.currentStatus, timestamp: new Date(), actor: req.user!.username, note: "Reservation handled → converted to order" },
      ];
      await order.save();
      await logAction("RESERVATION_HANDLED", req.user!.username, order.trackingNumber, { newType });
      emitEvent("orders:changed");
      return ok(res, order);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Delete a reservation. Cancelled ones can be removed by any admin; non-cancelled
  // removal also requires admin (client gates this behind a password prompt).
  app.delete("/api/reservations/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role !== "ADMIN") return fail(res, 403, "Admin only");
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Reservation not found");
      const force = req.query.force === "true";
      if (order.fulfillmentStatus !== "cancelled" && !force) {
        return fail(res, 400, "Only cancelled reservations can be deleted (pass force=true to override)");
      }
      await Order.findByIdAndDelete(req.params.id);
      await logAction("RESERVATION_DELETED", req.user!.username, order.trackingNumber, { force });
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

      // Employees can only edit stock with an approved EDIT_STOCK grant
      // (single-use). Admins and inventory managers have direct access.
      let grant: any = null;
      if (req.user!.role === "EMPLOYEE") {
        grant = await ItemRequest.findOneAndUpdate(
          { requestedBy: req.user!.username, action: "EDIT_STOCK", status: "approved" },
          { $set: { status: "used", usedAt: new Date() } },
          { sort: { approvedAt: 1 }, new: true },
        );
        if (!grant) {
          return fail(
            res,
            403,
            "Editing stock requires admin / inventory-manager approval. Open Inventory → Request to Edit Stock to ask for permission.",
          );
        }
      }

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

      // If new stock arrives (restock with positive qty), see if any partially
      // released orders are now fulfilable and notify the team.
      if (quantityChange > 0) {
        try {
          const blockedOrders = await Order.find({
            fulfillmentStatus: { $nin: ["completed", "cancelled"] },
            "items.itemId": item._id,
            "items.pendingQty": { $gt: 0 },
          })
            .select("trackingNumber customerName")
            .lean();
          for (const o of blockedOrders) {
            await notify({
              category: "INVENTORY",
              title: `Stock arrived for order ${o.trackingNumber}`,
              body: `${item.itemName} restocked by ${quantityChange}. Customer ${o.customerName} may now be releasable.`,
              link: `/orders/${o._id}`,
              recipientRole: "ADMIN",
              createdBy: req.user!.username,
            });
            await notify({
              category: "INVENTORY",
              title: `Stock arrived for order ${o.trackingNumber}`,
              body: `${item.itemName} restocked by ${quantityChange}. May now be releasable.`,
              link: `/orders/${o._id}`,
              recipientRole: "EMPLOYEE",
              createdBy: req.user!.username,
            });
          }
        } catch {}
      }

      await logAction("INVENTORY_LOG_CREATED", req.user!.username, item.itemName, { type: parsed.data.type, quantity: quantityChange });
      emitEvent("INVENTORY_LOG_CREATED", { itemId: item._id });
      emitEvent("ITEMS_CHANGED");
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
  // ── Pending Release feed (REQUEST.pdf §18b) ────────────────────────────
  // Orders eligible for release: paid in full OR partial ≥ 50%, AND
  // fulfillment is not yet completed/cancelled. Returns each row with
  // computed totalPaid/balance so the client doesn't need a per-row roundtrip.
  app.get("/api/orders/pending-release", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { search, page = "1", pageSize = "20" } = req.query as Record<string, string>;
      const baseFilter: any = {
        fulfillmentStatus: { $nin: ["completed", "cancelled"] },
        paymentStatus: { $in: ["paid", "partial"] },
      };
      if (search) baseFilter.$or = [
        { trackingNumber: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
      ];
      const skip = (parseInt(page) - 1) * parseInt(pageSize);
      const [rawOrders, total] = await Promise.all([
        Order.find(baseFilter).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(pageSize)).lean(),
        Order.countDocuments(baseFilter),
      ]);

      // Compute totalPaid per order in one aggregate so we can filter partials
      // below the 50% threshold out of the result without N round-trips.
      const orderIds = rawOrders.map((o: any) => String(o._id));
      const paidAgg = orderIds.length === 0 ? [] : await BillingPayment.aggregate([
        { $match: { orderId: { $in: orderIds } } },
        { $group: { _id: "$orderId", paid: { $sum: "$amountPaid" } } },
      ]);
      const paidById = new Map<string, number>(paidAgg.map((x: any) => [x._id, x.paid]));

      const filtered = rawOrders
        .map((o: any) => {
          const paid = paidById.get(String(o._id)) || 0;
          const balance = Math.max(0, (o.totalAmount || 0) - paid);
          // Walk-in PAID orders book a BillingPayment at creation but if any
          // ever slip through with paymentStatus=paid + paid=0 (legacy), we
          // still surface them because paymentStatus already says paid.
          const eligible = o.paymentStatus === "paid" || paid >= (o.totalAmount || 0) * 0.5;
          return { ...o, totalPaid: paid, balance, releaseEligible: eligible };
        })
        .filter((o: any) => o.releaseEligible);

      return ok(res, {
        orders: filtered,
        total: filtered.length, // post-filter total for THIS page
        rawTotal: total, // pre-filter total (for paging hint)
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

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
      } else {
        // Unassigning via POST with empty username — return order to pool by
        // resetting the fulfillment lifecycle. Without this reset the pool
        // query (which requires fulfillmentStatus === "pending") would skip
        // any order that had already entered "processing" or later.
        (order as any).startedAt = undefined;
        (order as any).completedProcessingAt = undefined;
        order.fulfillmentStatus = "pending";
        order.currentStatus = "Pending Payment";
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
      order.fulfillmentStatus = "pending";
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
      }).select("trackingNumber customerName items fulfillmentStatus paymentStatus totalAmount createdAt _id createdBy").lean();
      // Also expose any pre-existing approved DUPLICATE_ORDER grant the
      // caller already holds, so the client can skip the approval dialog.
      const grant = await ItemRequest.findOne({
        requestedBy: req.user!.username,
        action: "DUPLICATE_ORDER",
        status: "approved",
      }).lean();
      return ok(res, { duplicate: existing || null, approvedGrantId: grant?._id || null });
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

  // Currently-online users — anyone with an active session in the last 15 min.
  // Drives the dashboard "On shift now" rail. Visible to all logged-in users.
  app.get("/api/users/online", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000);
      const sessions = await UserSession.find({
        isActive: true,
        lastActivity: { $gte: cutoff },
      })
        .select("userId lastActivity")
        .sort({ lastActivity: -1 })
        .lean();
      const userIds = Array.from(new Set(sessions.map((s: any) => String(s.userId))));
      const users = userIds.length
        ? await User.find({ _id: { $in: userIds }, isActive: true }).select("username role").lean()
        : [];
      const lastByUser = new Map<string, Date>();
      for (const s of sessions as any[]) {
        const k = String(s.userId);
        const cur = lastByUser.get(k);
        if (!cur || new Date(s.lastActivity) > cur) lastByUser.set(k, new Date(s.lastActivity));
      }
      const out = users
        .map((u: any) => ({
          username: u.username,
          role: u.role,
          lastActivity: (lastByUser.get(String(u._id)) || new Date()).toISOString(),
        }))
        .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
      return ok(res, { users: out });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ── Top customers by revenue, time-windowed ───────────────────────────
  // Powers the dashboard "Top Customers" card. Window options:
  //   24h | 7d | 1m | 6m. Returns top 5 by revenue with latest purchase.
  app.get("/api/dashboard/top-customers", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const window = (req.query.window as string) || "7d";
      const since = new Date();
      if (window === "24h") since.setDate(since.getDate() - 1);
      else if (window === "7d") since.setDate(since.getDate() - 7);
      else if (window === "1m") since.setMonth(since.getMonth() - 1);
      else if (window === "6m") since.setMonth(since.getMonth() - 6);
      else since.setDate(since.getDate() - 7);

      const rows = await Order.aggregate([
        { $match: { createdAt: { $gte: since }, paymentStatus: { $in: ["paid", "partial"] }, fulfillmentStatus: { $ne: "cancelled" } } },
        {
          $group: {
            _id: { $toLower: "$customerName" },
            displayName: { $last: "$customerName" },
            totalSpend: { $sum: "$totalAmount" },
            orderCount: { $sum: 1 },
            latestPurchase: { $max: "$createdAt" },
          },
        },
        { $sort: { totalSpend: -1 } },
        { $limit: 5 },
      ]);

      return ok(res, {
        window,
        rows: rows.map((r: any) => ({
          name: r.displayName || "Walk-in",
          totalSpend: r.totalSpend,
          orderCount: r.orderCount,
          latestPurchase: r.latestPurchase,
        })),
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ── Employee progress (today) ─────────────────────────────────────────
  // Powers the dashboard "Employee Progress" widget. For every employee +
  // inventory manager + admin, count today's:
  //   pending     = assignedTo me, fulfillment ∈ pending/processing/ready,
  //                  not yet completedProcessingAt
  //   completed   = createdBy me OR assignedTo me, completedProcessingAt today
  //   reservations= createdBy me, orderType ∈ reservation, today
  app.get("/api/dashboard/employees-progress", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const users = await User.find({ isActive: true }).select("username role").lean();

      const [pendingAgg, completedAgg, reservationAgg, profiles] = await Promise.all([
        Order.aggregate([
          { $match: { assignedTo: { $ne: "" }, fulfillmentStatus: { $in: ["pending", "processing", "ready"] }, completedProcessingAt: { $exists: false } } },
          { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
        ]),
        Order.aggregate([
          { $match: { completedProcessingAt: { $gte: dayStart } } },
          { $group: { _id: { $ifNull: ["$assignedTo", "$createdBy"] }, count: { $sum: 1 } } },
        ]),
        Order.aggregate([
          { $match: { createdAt: { $gte: dayStart }, orderType: { $in: ["online_reservation", "walkin_reservation"] } } },
          { $group: { _id: "$createdBy", count: { $sum: 1 } } },
        ]),
        EmployeeProfile.find({}).select("username profilePictureFilename").lean(),
      ]);

      const pendingByUser = new Map<string, number>(pendingAgg.map((a: any) => [a._id, a.count]));
      const completedByUser = new Map<string, number>(completedAgg.map((a: any) => [a._id, a.count]));
      const reservationsByUser = new Map<string, number>(reservationAgg.map((a: any) => [a._id, a.count]));
      const photoByUser = new Map<string, string>(
        (profiles as any[]).map((p) => [p.username, p.profilePictureFilename || ""])
      );

      const rows = users.map((u: any) => ({
        username: u.username,
        role: u.role,
        photo: photoByUser.get(u.username) || "",
        pending: pendingByUser.get(u.username) || 0,
        completed: completedByUser.get(u.username) || 0,
        reservations: reservationsByUser.get(u.username) || 0,
      })).sort((a, b) =>
        (b.pending + b.completed + b.reservations) - (a.pending + a.completed + a.reservations)
        || a.username.localeCompare(b.username)
      );

      return ok(res, { rows });
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

      // ── Duplicate-order admin approval (REQUEST.pdf round 7 section 9-10) ──
      // If a non-cancelled order already exists for the same customer with
      // overlapping items, the caller must consume an APPROVED DUPLICATE_ORDER
      // grant. Admins and the original requester bypass when the grant is
      // present (single-use, marked "used" on consumption).
      const itemIds = parsed.data.items.map((i) => i.itemId);
      const dup = await Order.findOne({
        customerName: { $regex: new RegExp(`^${parsed.data.customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        fulfillmentStatus: { $nin: ["completed", "cancelled"] },
        "items.itemId": { $in: itemIds },
      }).select("_id trackingNumber").lean();
      if (dup) {
        const grant = await ItemRequest.findOneAndUpdate(
          { requestedBy: req.user!.username, action: "DUPLICATE_ORDER", status: "approved" },
          { $set: { status: "used", usedAt: new Date() } },
          { sort: { approvedAt: 1 }, new: true },
        );
        if (!grant) {
          return fail(
            res,
            409,
            `Possible duplicate of ${dup.trackingNumber} for ${parsed.data.customerName}. An admin must approve a DUPLICATE_ORDER request before this can proceed.`,
          );
        }
      }

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

      // Compute per-line released/pending tallies for partial-release tracking.
      // On creation everything starts pending; release routes will decrement.
      const itemsWithRelease = processedItems.map((p) => ({ ...p, releasedQty: 0, pendingQty: p.qty }));

      // Walk-in non-reservation orders are settled at the counter. The order's
      // paymentStatus is already "paid" at this point — record the payment +
      // ledger entries here so the dashboard/billing/accounting actually move
      // the second the order is created (previously revenue only moved when
      // /api/billing/pay ran, so walk-in paid orders left every metric at zero).
      const walkInPaid = parsed.data.paymentStatus === "paid";

      const order = await Order.create({
        trackingNumber,
        ...(parsed.data.customerId ? { customerId: parsed.data.customerId } : {}),
        customerName: parsed.data.customerName,
        items: itemsWithRelease,
        totalAmount: Math.round(totalAmount * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee: parsed.data.deliveryFee || 0,
        orderType: parsed.data.orderType,
        orderChannel: parsed.data.orderChannel,
        paymentStatus: parsed.data.paymentStatus,
        paymentMethod: parsed.data.paymentMethod,
        fulfillmentStatus: parsed.data.fulfillmentStatus,
        sourceChannel: parsed.data.orderChannel,
        createdBy: req.user!.username,
        notes: parsed.data.notes,
        scheduledDate: parsed.data.scheduledDate ? new Date(parsed.data.scheduledDate) : undefined,
        currentStatus: walkInPaid ? "Pending Release" : parsed.data.fulfillmentStatus,
        statusHistory: [{ status: parsed.data.fulfillmentStatus, timestamp: new Date(), actor: req.user!.username, note: "Order created" }],
        ...(hasAddress ? { address: addressData } : {}),
      });

      // ─── Direct-save rollback wrapper ───────────────────────────────────
      // Order.create succeeded. Everything below (inventory reservation logs,
      // walk-in payment booking, ledger pair, offer counters) is "best-effort
      // append" — but if anything throws, we'd be left with a phantom order
      // that has no inventory reservation and no payment. To keep direct-save
      // honest, we wrap the post-create work and on failure we hard-delete the
      // Order plus any partial children we managed to create. The original
      // error is re-thrown so the client sees the real reason.
      const createdChildren: { type: "payment" | "ledger" | "log"; id: string }[] = [];
      try {
        // Stock model: on creation we DO NOT subtract from `currentQuantity`. The
        // physical stock is only debited when an order is released (so partial
        // releases can leave a balance). Keeping inventory untouched here also
        // means the "release stock" button can correctly say "have X, need Y".
        // We still write an inventory log entry (type "reservation") so audit
        // trails stay complete.
        for (const oi of itemsWithRelease) {
          const log = await InventoryLog.create({
            itemId: oi.itemId,
            itemName: oi.itemName,
            type: "adjustment",
            quantity: 0,
            reason: `Reserved by order ${trackingNumber} (qty ${oi.qty})`,
            actor: req.user!.username,
          });
          createdChildren.push({ type: "log", id: log._id.toString() });
        }

        // Walk-in PAID: book the payment + ledger NOW so dashboard reflects it.
        if (walkInPaid) {
          const txn = generateTransactionCode();
          const payment = await BillingPayment.create({
            orderId: order._id.toString(),
            paymentMethod: parsed.data.paymentMethod,
            gcashNumber: "",
            gcashReferenceNumber: txn,
            amountPaid: order.totalAmount,
            paymentDate: new Date(),
            proofNote: "Auto-recorded at order creation (walk-in paid)",
            loggedBy: req.user!.username,
            transactionCode: txn,
            isFullPayment: true,
          });
          createdChildren.push({ type: "payment", id: payment._id.toString() });
          const accountName = "Cash/GCash";
          const ledgerRows = await GeneralLedgerEntry.create([
            { date: new Date(), accountName, debit: order.totalAmount, credit: 0, description: `Payment for walk-in order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
            { date: new Date(), accountName: "Sales Revenue", debit: 0, credit: order.totalAmount, description: `Revenue from walk-in order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
          ]);
          for (const r of ledgerRows as any[]) createdChildren.push({ type: "ledger", id: r._id.toString() });
          await Promise.all([
            bumpAccountBalance(accountName, order.totalAmount),
            bumpAccountBalance("Sales Revenue", order.totalAmount),
          ]);
          order.statusHistory.push({ status: "Paid", timestamp: new Date(), actor: req.user!.username, note: `₱${order.totalAmount.toFixed(2)} received at counter · Txn: ${txn}` });
          await order.save();
          emitEvent("PAYMENT_LOGGED", { orderId: order._id, transactionCode: txn });
          emitEvent("LEDGER_POSTED");
        }
      } catch (childErr: any) {
        // Compensating delete — undo everything we did so far.
        try {
          for (const c of createdChildren) {
            if (c.type === "payment") await BillingPayment.findByIdAndDelete(c.id).catch(() => {});
            else if (c.type === "ledger") await GeneralLedgerEntry.findByIdAndDelete(c.id).catch(() => {});
            else if (c.type === "log") await InventoryLog.findByIdAndDelete(c.id).catch(() => {});
          }
          // If we already bumped balances, reverse them.
          if (walkInPaid) {
            await bumpAccountBalance("Cash/GCash", -order.totalAmount).catch(() => {});
            await bumpAccountBalance("Sales Revenue", -order.totalAmount).catch(() => {});
          }
          await Order.findByIdAndDelete(order._id).catch(() => {});
        } catch { /* swallow — surfacing the original error is more useful */ }
        console.error("[ORDER_CREATE] rolled back due to:", childErr);
        return fail(res, 500, `Order create failed mid-flight and was rolled back: ${childErr?.message || "unknown error"}`);
      }

      for (const [offerId, { totalSavings: savings }] of Array.from(offersUsed)) {
        await Offer.findByIdAndUpdate(offerId, {
          $inc: { usageCount: 1, totalSavingsGenerated: savings },
        });
      }

      await logAction("ORDER_CREATED", req.user!.username, order.trackingNumber, { totalAmount, totalSavings });

      // Notification to admins + employees so the floor team picks it up.
      await notify({
        category: "ORDER",
        title: `New order ${order.trackingNumber}`,
        body: `${order.customerName} · ₱${order.totalAmount.toFixed(2)} · ${parsed.data.orderType.replace("_", " ")}`,
        link: `/orders/${order._id}`,
        recipientRole: "ADMIN",
        createdBy: req.user!.username,
      });
      await notify({
        category: "ORDER",
        title: `New order ${order.trackingNumber}`,
        body: `${order.customerName} · ₱${order.totalAmount.toFixed(2)}`,
        link: `/orders/${order._id}`,
        recipientRole: "EMPLOYEE",
        createdBy: req.user!.username,
      });

      emitEvent("ORDER_CREATED", { orderId: order._id });
      emitEvent("DASHBOARD_STATS_UPDATED");
      emitEvent("INVENTORY_LOG_CREATED");
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
      if (!order) {
        await fileAudit({ flag: "order_missing", severity: "alert", detail: `quick-pay attempted on missing order ${parsed.data.orderId}`, orderId: parsed.data.orderId, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: parsed.data.gcashReferenceNumber, loggedBy: req.user!.username });
        return fail(res, 404, "Order not found");
      }

      // ── Cross-check: order must still be open for payment ────────────────
      if (order.paymentStatus === "paid") {
        await fileAudit({ flag: "order_already_paid", severity: "alert", detail: `quick-pay against already-paid order ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
        return fail(res, 400, `Order ${order.trackingNumber} is already fully paid — post a Reversing Entry first to refund.`);
      }

      // ── Cross-check: only the assignee or an admin may log this order's payment ──
      const isAdmin = req.user!.role === "ADMIN";
      if (!isAdmin && order.assignedTo && order.assignedTo !== req.user!.username) {
        await fileAudit({ flag: "actor_not_assignee", severity: "alert", detail: `${req.user!.username} tried to log payment for ${order.trackingNumber} assigned to ${order.assignedTo}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
        return fail(res, 403, `This order is assigned to ${order.assignedTo}. Only the assignee or an admin can log its payment.`);
      }

      const totalPaid = await BillingPayment.aggregate([
        { $match: { orderId: order._id.toString() } },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]);
      const alreadyPaid = totalPaid[0]?.total || 0;
      const remaining = order.totalAmount - alreadyPaid;

      // Cross-check: never accept more than the remaining balance.
      const EPS = 0.005;
      if (parsed.data.amount > remaining + EPS) {
        await fileAudit({ flag: "amount_mismatch", severity: "alert", detail: `overpayment: ₱${parsed.data.amount.toFixed(2)} > remaining ₱${remaining.toFixed(2)} on ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: parsed.data.gcashReferenceNumber, loggedBy: req.user!.username });
        return fail(res, 400, `Amount ₱${parsed.data.amount.toFixed(2)} exceeds remaining balance ₱${remaining.toFixed(2)}.`);
      }

      // Partial payments must reach ≥50% of the order total before being
      // accepted as "partial" — anything below is rejected with a clear
      // explanation. (REQUEST.pdf round 7 + section 18.)
      const projected = alreadyPaid + parsed.data.amount;
      const halfThreshold = order.totalAmount * 0.5;
      if (projected < order.totalAmount && projected < halfThreshold) {
        await fileAudit({ flag: "amount_below_min", severity: "warn", detail: `partial-pay below 50%: projected ₱${projected.toFixed(2)} / threshold ₱${halfThreshold.toFixed(2)} on ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
        return fail(
          res,
          400,
          `Partial payment must be at least 50% of the total (₱${halfThreshold.toFixed(2)}). Currently received ₱${projected.toFixed(2)}.`,
        );
      }

      // ── GCash reference validation (direct-save: anomalies are filed not blocked) ──
      const isGcash = parsed.data.paymentMethod === "gcash" || parsed.data.paymentMethod === "gcash_qr";
      let cleanRef = parsed.data.gcashReferenceNumber || "";
      const auditQueue: Array<{ flag: PaymentAuditFlag; severity?: "info" | "warn" | "alert"; detail: string }> = [];
      if (isGcash) {
        const cls = classifyGcashRef(parsed.data.gcashReferenceNumber || "");
        if (!cls.ok) {
          return fail(res, 400, cls.reason);
        }
        cleanRef = cls.ref;
        const dup = await BillingPayment.findOne({ gcashReferenceNumber: cleanRef });
        if (dup) {
          await fileAudit({ flag: "gcash_ref_duplicate", severity: "alert", detail: `GCash ref ${cleanRef} already on payment ${dup._id}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: cleanRef, loggedBy: req.user!.username });
          return fail(res, 409, "Duplicate GCash reference — that exact reference was already recorded.");
        }
      }
      if (isAfterHoursPHT()) {
        auditQueue.push({ flag: "after_hours", severity: "info", detail: "payment logged outside 06:00–22:00 PHT" });
      }

      const payment = await BillingPayment.create({
        orderId: parsed.data.orderId,
        paymentMethod: parsed.data.paymentMethod,
        gcashNumber: "",
        gcashReferenceNumber: cleanRef,
        amountPaid: parsed.data.amount,
        paymentDate: new Date(),
        proofNote: parsed.data.note || "",
        loggedBy: req.user!.username,
      });

      // Drain queued info-audits now that we have the paymentId.
      for (const a of auditQueue) {
        await fileAudit({ ...a, paymentId: payment._id.toString(), orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: cleanRef, loggedBy: req.user!.username });
      }

      const newTotalPaid = alreadyPaid + parsed.data.amount;
      let newPaymentStatus = order.paymentStatus;
      if (newTotalPaid >= order.totalAmount) {
        newPaymentStatus = "paid";
      } else if (newTotalPaid > 0) {
        newPaymentStatus = "partial";
      }

      await Order.findByIdAndUpdate(parsed.data.orderId, { paymentStatus: newPaymentStatus });

      // Double-entry ledger: Cash/GCash debit + Sales Revenue credit so the
      // accounting dashboard moves the same way the slow /billing/pay path
      // does. Without this quick-pay revenue silently never reached the
      // ledger / Gross Margin / Account Type Distribution.
      const accountName = "Cash/GCash";
      await GeneralLedgerEntry.create([
        { date: new Date(), accountName, debit: parsed.data.amount, credit: 0, description: `Quick payment for order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
        { date: new Date(), accountName: "Sales Revenue", debit: 0, credit: parsed.data.amount, description: `Revenue from order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
      ]);
      await Promise.all([
        bumpAccountBalance(accountName, parsed.data.amount),
        bumpAccountBalance("Sales Revenue", parsed.data.amount),
      ]);

      await logAction("QUICK_PAYMENT_RECORDED", req.user!.username, order.trackingNumber, {
        amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, newPaymentStatus,
      });
      emitEvent("PAYMENT_LOGGED", { orderId: order._id });
      emitEvent("LEDGER_POSTED");
      emitEvent("DASHBOARD_STATS_UPDATED");
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
      if (!order) {
        await fileAudit({ flag: "order_missing", severity: "alert", detail: `pay attempted on missing order ${parsed.data.orderId}`, orderId: parsed.data.orderId, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: parsed.data.gcashReferenceNumber, loggedBy: req.user!.username });
        return fail(res, 404, "Order not found");
      }
      if (order.paymentStatus === "paid") {
        await fileAudit({ flag: "order_already_paid", severity: "alert", detail: `pay against already-paid order ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
        return fail(res, 400, "Order has already been paid");
      }

      // Actor must be assignee or admin (mirrors quick-pay).
      const isAdminAct = req.user!.role === "ADMIN";
      if (!isAdminAct && order.assignedTo && order.assignedTo !== req.user!.username) {
        await fileAudit({ flag: "actor_not_assignee", severity: "alert", detail: `${req.user!.username} tried to log payment for ${order.trackingNumber} assigned to ${order.assignedTo}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
        return fail(res, 403, `This order is assigned to ${order.assignedTo}. Only the assignee or an admin can log its payment.`);
      }

      if (!parsed.data.isFullPayment) {
        if (parsed.data.amountPaid <= 0) return fail(res, 400, "Amount paid must be greater than 0");
        // Partial payments must reach ≥50% of the order total
        const halfThreshold = order.totalAmount * 0.5;
        if (parsed.data.amountPaid < halfThreshold) {
          await fileAudit({ flag: "amount_below_min", severity: "warn", detail: `partial-pay below 50%: ₱${parsed.data.amountPaid.toFixed(2)} / threshold ₱${halfThreshold.toFixed(2)} on ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, loggedBy: req.user!.username });
          return fail(
            res,
            400,
            `Partial payment must be at least 50% of the total (₱${halfThreshold.toFixed(2)}).`,
          );
        }
      } else {
        if (parsed.data.amountPaid < order.totalAmount) return fail(res, 400, `Full payment must be at least ₱${order.totalAmount.toFixed(2)}`);
        // Overpayment (full mode) — accept but file audit so the admin can post a partial Reversing Entry refund.
        if (parsed.data.amountPaid > order.totalAmount + 0.005) {
          await fileAudit({ flag: "amount_mismatch", severity: "warn", detail: `overpayment ₱${parsed.data.amountPaid.toFixed(2)} > total ₱${order.totalAmount.toFixed(2)} on ${order.trackingNumber}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: parsed.data.gcashReferenceNumber, loggedBy: req.user!.username });
        }
      }

      const isGcash = parsed.data.paymentMethod === "gcash" || parsed.data.paymentMethod === "gcash_qr";
      let cleanGcashRef = parsed.data.gcashReferenceNumber || "";
      if (isGcash) {
        const cls = classifyGcashRef(parsed.data.gcashReferenceNumber || "");
        if (!cls.ok) {
          return fail(res, 400, cls.reason);
        }
        cleanGcashRef = cls.ref;
        const existingRef = await BillingPayment.findOne({ gcashReferenceNumber: cleanGcashRef });
        if (existingRef) {
          await fileAudit({ flag: "gcash_ref_duplicate", severity: "alert", detail: `GCash ref ${cleanGcashRef} already on payment ${existingRef._id}`, orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: cleanGcashRef, loggedBy: req.user!.username });
          return fail(res, 409, "Duplicate GCash reference number — already recorded");
        }
      }
      if (isAfterHoursPHT()) {
        await fileAudit({ flag: "after_hours", severity: "info", detail: "payment logged outside 06:00–22:00 PHT", orderId: order._id.toString(), trackingNumber: order.trackingNumber, amount: parsed.data.amountPaid, paymentMethod: parsed.data.paymentMethod, gcashReferenceNumber: cleanGcashRef, loggedBy: req.user!.username });
      }

      const transactionCode = parsed.data.transactionCode || generateTransactionCode();

      const payment = await BillingPayment.create({
        orderId: parsed.data.orderId,
        paymentMethod: parsed.data.paymentMethod,
        gcashNumber: parsed.data.gcashSenderNumber || "",
        gcashSenderName: parsed.data.gcashSenderName || "",
        gcashReferenceNumber: isGcash ? cleanGcashRef : transactionCode,
        amountPaid: parsed.data.amountPaid,
        amountTendered: parsed.data.amountTendered,
        transactionCode,
        receiptImagePath: parsed.data.receiptImagePath || "",
        deliveryAddress: parsed.data.deliveryAddress || "",
        orNumber: parsed.data.orNumber || "",
        recipientName: parsed.data.recipientName || "",
        contactNumber: parsed.data.contactNumber || "",
        checkerName: parsed.data.checkerName || "",
        driverName: parsed.data.driverName || "",
        plateNumber: parsed.data.plateNumber || "",
        allItemsComplete: parsed.data.allItemsComplete ?? true,
        itemConditionNotes: parsed.data.itemConditionNotes || "",
        isFullPayment: parsed.data.isFullPayment ?? true,
        remainingBalance: parsed.data.remainingBalance || 0,
        balanceDueDate: parsed.data.balanceDueDate ? new Date(parsed.data.balanceDueDate) : undefined,
        paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
        proofNote: parsed.data.notes || "",
        loggedBy: req.user!.username,
      });

      const methodLabel = isGcash ? `GCash (ref: ${cleanGcashRef})` : parsed.data.paymentMethod === "cod" ? "Cash on Delivery" : "Cash";
      order.currentStatus = "Pending Release";
      order.paymentStatus = "paid";
      order.statusHistory.push(
        { status: "Paid", timestamp: new Date(), actor: req.user!.username, note: `₱${parsed.data.amountPaid.toFixed(2)} received via ${methodLabel} · Txn: ${transactionCode}` },
        { status: "Pending Release", timestamp: new Date(), actor: req.user!.username, note: "Payment confirmed, awaiting release" }
      );
      await order.save();

      const accountName = "Cash/GCash";
      await GeneralLedgerEntry.create([
        { date: new Date(), accountName, debit: parsed.data.amountPaid, credit: 0, description: `Payment for order ${order.trackingNumber} via ${methodLabel}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
        { date: new Date(), accountName: "Sales Revenue", debit: 0, credit: parsed.data.amountPaid, description: `Revenue from order ${order.trackingNumber}`, referenceType: "payment", referenceId: payment._id.toString(), actor: req.user!.username },
      ]);
      // Sync AccountingAccount balances (asset accounts: balance += debit-credit; revenue: balance += credit-debit)
      await Promise.all([
        bumpAccountBalance(accountName, parsed.data.amountPaid),
        bumpAccountBalance("Sales Revenue", parsed.data.amountPaid),
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
  // Release stock for an order — supports PARTIAL release.
  //  • If every line has enough stock → full release, status becomes "completed".
  //  • If some lines have less → release whatever's available now; the rest
  //    stays in `pendingQty` and the order keeps its place in the active
  //    Orders tab with a "Partial Release" badge. The Release Stock button
  //    becomes available again whenever new stock comes in.
  // Inventory Managers may NOT release — only admin / employees.
  app.post("/api/orders/:id/release", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role === "INVENTORY_MANAGER") {
        return fail(res, 403, "Inventory managers cannot release orders — that's the floor team's call.");
      }
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      if (order.currentStatus === "Completed" || order.fulfillmentStatus === "completed") {
        return fail(res, 400, "Order is already fully released.");
      }

      let anyReleased = false;
      let anyPending = false;
      const releaseSummary: string[] = [];
      const partialSummary: string[] = [];

      for (const oi of order.items as any[]) {
        const pending = oi.pendingQty ?? oi.qty ?? 0;
        if (pending <= 0) continue;

        const item = await Item.findById(oi.itemId);
        const have = item?.currentQuantity ?? 0;
        if (!item || have <= 0) {
          anyPending = true;
          partialSummary.push(`${oi.itemName}: need ${pending}, have ${have}`);
          continue;
        }
        const releaseNow = Math.min(have, pending);
        const before = item.currentQuantity;
        item.currentQuantity = have - releaseNow;
        await item.save();
        // Fire ROP alert if we just crossed the reorder point downward.
        await maybeFireROPAlert(item, before, item.currentQuantity);
        oi.releasedQty = (oi.releasedQty ?? 0) + releaseNow;
        oi.pendingQty = pending - releaseNow;
        if (oi.pendingQty > 0) {
          anyPending = true;
          partialSummary.push(`${oi.itemName}: released ${releaseNow}/${pending}, still owe ${oi.pendingQty}`);
        }
        anyReleased = true;
        releaseSummary.push(`${oi.itemName} ×${releaseNow}`);
        await InventoryLog.create({
          itemId: item._id,
          itemName: item.itemName,
          type: "deduction",
          quantity: -releaseNow,
          reason: `Released for order ${order.trackingNumber}${pending > releaseNow ? " (partial)" : ""}`,
          actor: req.user!.username,
        });
      }

      if (!anyReleased) {
        return fail(res, 400, `Nothing to release — stock unchanged.\n${partialSummary.join("\n")}`);
      }

      if (anyPending) {
        order.currentStatus = "Pending Release";
        order.fulfillmentStatus = "processing"; // stays in active orders tab
        order.statusHistory.push({
          status: "Released",
          timestamp: new Date(),
          actor: req.user!.username,
          note: `Partial release: ${releaseSummary.join(", ")} · still owed: ${partialSummary.join(", ")}`,
        });
        order.markModified("items");
        await order.save();
        await logAction("ORDER_PARTIAL_RELEASE", req.user!.username, order.trackingNumber, { released: releaseSummary, pending: partialSummary });
      } else {
        order.currentStatus = "Completed";
        order.fulfillmentStatus = "completed";
        order.completedProcessingAt = new Date();
        order.statusHistory.push(
          { status: "Released", timestamp: new Date(), actor: req.user!.username, note: `Full release: ${releaseSummary.join(", ")}` },
          { status: "Completed", timestamp: new Date(), actor: req.user!.username, note: "Order fulfilled" },
        );
        order.markModified("items");
        await order.save();
        await logAction("ORDER_RELEASED", req.user!.username, order.trackingNumber);
      }

      emitEvent("ORDER_RELEASED", { orderId: order._id, partial: anyPending });
      emitEvent("INVENTORY_LOG_CREATED");
      emitEvent("DASHBOARD_STATS_UPDATED");
      return ok(res, {
        order,
        partial: anyPending,
        releasedNow: releaseSummary,
        stillPending: partialSummary,
        message: anyPending
          ? `Partial release recorded. Order stays in Active until stock catches up.`
          : `Order fully released. Inventory + revenue updated.`,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Mark order as DELIVERED — only admin / employee (NOT inventory manager).
  // Once delivered the order is moved to history (fulfillmentStatus="completed").
  app.post("/api/orders/:id/deliver", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role === "INVENTORY_MANAGER") {
        return fail(res, 403, "Only admin or employees can confirm delivery.");
      }
      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");
      const stillPending = (order.items as any[]).some((oi) => (oi.pendingQty ?? 0) > 0);
      if (stillPending) {
        return fail(res, 400, "Order still has pending items — release the full quantity before marking delivered.");
      }
      order.currentStatus = "Completed";
      order.fulfillmentStatus = "completed";
      order.completedProcessingAt = new Date();
      order.statusHistory.push({
        status: "Completed",
        timestamp: new Date(),
        actor: req.user!.username,
        note: `Delivery confirmed${req.body?.note ? `: ${req.body.note}` : ""}`,
      });
      await order.save();
      await logAction("ORDER_DELIVERED", req.user!.username, order.trackingNumber, { note: req.body?.note });
      emitEvent("ORDER_RELEASED", { orderId: order._id });
      emitEvent("DASHBOARD_STATS_UPDATED");
      return ok(res, { order, message: "Marked delivered, moved to History." });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ACCOUNTING ─────────────────────────────────────────
  app.get("/api/accounting/accounts", authMiddleware, async (_req: AuthRequest, res: Response) => {
    try {
      // Always derive live balances from the ledger so the Chart of Accounts
      // panel never shows stale zeros even if AccountingAccount.balance got
      // out of sync with GeneralLedgerEntry totals.
      const [accounts, entries] = await Promise.all([
        AccountingAccount.find().sort({ accountCode: 1 }).lean(),
        GeneralLedgerEntry.find().lean(),
      ]);
      const totals: Record<string, { debit: number; credit: number }> = {};
      for (const e of entries) {
        if (!totals[e.accountName]) totals[e.accountName] = { debit: 0, credit: 0 };
        totals[e.accountName].debit += e.debit;
        totals[e.accountName].credit += e.credit;
      }
      const withLiveBalance = accounts.map((a) => {
        const t = totals[a.accountName] || { debit: 0, credit: 0 };
        const isDebitNormal = ["Asset", "Expense"].includes(a.accountType);
        const liveBalance = isDebitNormal ? t.debit - t.credit : t.credit - t.debit;
        return { ...a, balance: liveBalance };
      });
      return ok(res, withLiveBalance);
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Delete a Chart-of-Accounts entry (admin only). Safe-guards against
  // deleting accounts that have ledger history.
  app.delete("/api/accounting/accounts/:id", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const acct = await AccountingAccount.findById(req.params.id);
      if (!acct) return fail(res, 404, "Account not found");
      const hasEntries = await GeneralLedgerEntry.exists({ accountName: acct.accountName });
      if (hasEntries) return fail(res, 400, `Cannot delete "${acct.accountName}" — it has ledger history. Archive instead.`);
      await AccountingAccount.findByIdAndDelete(req.params.id);
      await logAction("ACCOUNT_DELETED", req.user!.username, acct.accountName);
      emitEvent("LEDGER_POSTED");
      return ok(res, { deleted: acct.accountName });
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
      // Sync AccountingAccount balance for manually posted entries
      // For Asset/Expense accounts: debit increases balance, credit decreases
      // For Liability/Equity/Revenue accounts: credit increases balance, debit decreases
      const account = await AccountingAccount.findOne({ accountName: entry.accountName });
      if (account) {
        const isDebitNormal = ["Asset", "Expense"].includes(account.accountType);
        const balanceDelta = isDebitNormal
          ? entry.debit - entry.credit
          : entry.credit - entry.debit;
        await AccountingAccount.findByIdAndUpdate(account._id, { $inc: { balance: balanceDelta } });
      }
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

  // ─── REVERSING ENTRIES ─────────────────────────────────────
  //
  // Append-only correction path. Posting a Reversing Entry for an existing
  // ledger row appends a new row with swapped debit/credit, marks it as
  // isReversing=true, links back to the original via referenceType="reversal",
  // and decrements the corresponding AccountingAccount balance.
  //
  // Companion route: /api/orders/:id/reverse-payment reverses the BOTH legs
  // of a payment pair in one shot and stamps the order as "Corrected".
  //
  // Per the proposal: an admin (not employee) initiates corrections; the
  // original entry is NEVER mutated or deleted.
  app.post("/api/accounting/ledger/:id/reverse", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const reason = String(req.body?.reason || "").trim();
      if (reason.length < 3) return fail(res, 400, "Reversal reason is required (min 3 chars).");

      const original = await GeneralLedgerEntry.findById(req.params.id);
      if (!original) return fail(res, 404, "Ledger entry not found");
      if (original.isReversing) return fail(res, 400, "Cannot reverse a reversing entry.");

      const already = await GeneralLedgerEntry.findOne({
        referenceType: "reversal",
        referenceId: original._id.toString(),
      });
      if (already) return fail(res, 409, "This entry has already been reversed.");

      const reversal = await GeneralLedgerEntry.create({
        date: new Date(),
        accountName: original.accountName,
        debit: original.credit,
        credit: original.debit,
        description: `REVERSAL of ${original._id} — ${reason}`,
        referenceType: "reversal",
        referenceId: original._id.toString(),
        isReversing: true,
        actor: req.user!.username,
      });

      // Account balance: reverse direction of the original.
      const account = await AccountingAccount.findOne({ accountName: original.accountName });
      if (account) {
        const isDebitNormal = ["Asset", "Expense"].includes(account.accountType);
        const originalDelta = isDebitNormal ? original.debit - original.credit : original.credit - original.debit;
        await AccountingAccount.findByIdAndUpdate(account._id, { $inc: { balance: -originalDelta } });
      } else {
        // Fall back to bumpAccountBalance for KNOWN_ACCOUNTS map.
        const reverseDelta = original.credit - original.debit;
        await bumpAccountBalance(original.accountName, reverseDelta);
      }

      await logAction("LEDGER_REVERSED", req.user!.username, original.accountName, {
        originalId: original._id, reason, debit: original.debit, credit: original.credit,
      });
      emitEvent("LEDGER_POSTED");
      return ok(res, { original, reversal });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Reverse BOTH legs of a payment in one shot, and stamp the order as
  // "Corrected" so it stops showing up in revenue / pending-release tallies.
  app.post("/api/orders/:id/reverse-payment", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const reason = String(req.body?.reason || "").trim();
      if (reason.length < 3) return fail(res, 400, "Reason is required (min 3 chars).");

      const order = await Order.findById(req.params.id);
      if (!order) return fail(res, 404, "Order not found");

      const payments = await BillingPayment.find({ orderId: order._id.toString() }).lean();
      if (payments.length === 0) return fail(res, 400, "No payments to reverse on this order.");

      const paymentIds = payments.map((p) => p._id.toString());
      const entries = await GeneralLedgerEntry.find({
        referenceType: "payment",
        referenceId: { $in: paymentIds },
        isReversing: { $ne: true },
      });
      if (entries.length === 0) return fail(res, 400, "Original ledger entries not found.");

      // Already reversed? Refuse a second pass.
      const reversed = await GeneralLedgerEntry.exists({
        referenceType: "reversal",
        referenceId: { $in: entries.map((e) => e._id.toString()) },
      });
      if (reversed) return fail(res, 409, "Payment has already been reversed.");

      for (const original of entries) {
        await GeneralLedgerEntry.create({
          date: new Date(),
          accountName: original.accountName,
          debit: original.credit,
          credit: original.debit,
          description: `REVERSAL of payment for ${order.trackingNumber} — ${reason}`,
          referenceType: "reversal",
          referenceId: original._id.toString(),
          isReversing: true,
          actor: req.user!.username,
        });
        const account = await AccountingAccount.findOne({ accountName: original.accountName });
        if (account) {
          const isDebitNormal = ["Asset", "Expense"].includes(account.accountType);
          const originalDelta = isDebitNormal ? original.debit - original.credit : original.credit - original.debit;
          await AccountingAccount.findByIdAndUpdate(account._id, { $inc: { balance: -originalDelta } });
        } else {
          await bumpAccountBalance(original.accountName, original.credit - original.debit);
        }
      }

      order.paymentStatus = "pending_payment";
      order.currentStatus = "Corrected";
      order.statusHistory.push({
        status: "Corrected",
        timestamp: new Date(),
        actor: req.user!.username,
        note: `Payment reversed — ${reason}`,
      });
      await order.save();

      // File one audit row so the daily report shows it.
      await fileAudit({
        flag: "amount_mismatch",
        severity: "alert",
        detail: `payment reversed — ${reason}`,
        orderId: order._id.toString(),
        trackingNumber: order.trackingNumber,
        amount: order.totalAmount,
        loggedBy: req.user!.username,
      });

      await logAction("PAYMENT_REVERSED", req.user!.username, order.trackingNumber, { reason, paymentIds });
      emitEvent("LEDGER_POSTED");
      emitEvent("ORDER_STATUS_UPDATED", { orderId: order._id });
      emitEvent("DASHBOARD_STATS_UPDATED");
      return ok(res, { order, reversed: entries.length });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── DAILY PAYMENT AUDIT REPORT ────────────────────────────
  //
  // One-shot fraud-detection dashboard. Surfaces, for a given PHT day:
  //   • every payment logged (employee, order, method, amount, ref)
  //   • every audit flag fired during the same window
  //   • per-employee totals (count + amount)
  //
  // The client renders this as a Reports → "Daily Payment Audit" tab.
  app.get("/api/reports/payment-audit", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const dateStr = String(req.query.date || "");
      // Parse YYYY-MM-DD as a PHT calendar day, convert to UTC range.
      let start: Date, end: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        // PHT midnight = UTC of previous day 16:00.
        start = new Date(`${dateStr}T00:00:00+08:00`);
        end = new Date(`${dateStr}T23:59:59.999+08:00`);
      } else {
        const now = new Date();
        const phtNow = new Date(now.getTime() + 8 * 3600 * 1000);
        const ymd = phtNow.toISOString().slice(0, 10);
        start = new Date(`${ymd}T00:00:00+08:00`);
        end = new Date(`${ymd}T23:59:59.999+08:00`);
      }

      const [payments, audits, orders] = await Promise.all([
        BillingPayment.find({ paymentDate: { $gte: start, $lte: end } }).sort({ paymentDate: -1 }).lean(),
        PaymentAudit.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
        Order.find({}).select("_id trackingNumber customerName totalAmount assignedTo").lean(),
      ]);

      const orderById: Record<string, any> = {};
      for (const o of orders) orderById[o._id.toString()] = o;

      // Build per-payment flag groups.
      const flagsByPayment: Record<string, any[]> = {};
      const flagsByOrder: Record<string, any[]> = {};
      for (const a of audits) {
        if (a.paymentId) {
          (flagsByPayment[a.paymentId] ||= []).push(a);
        }
        if (a.orderId) {
          (flagsByOrder[a.orderId] ||= []).push(a);
        }
      }

      const enrichedPayments = payments.map((p) => {
        const order = orderById[String(p.orderId)] || {};
        const pid = String(p._id);
        const oid = String(p.orderId);
        const flags = [...(flagsByPayment[pid] || []), ...(flagsByOrder[oid] || [])];
        return {
          paymentId: pid,
          orderId: oid,
          trackingNumber: order.trackingNumber,
          customerName: order.customerName,
          orderTotal: order.totalAmount,
          paymentMethod: p.paymentMethod,
          amountPaid: p.amountPaid,
          gcashReferenceNumber: p.gcashReferenceNumber,
          transactionCode: p.transactionCode,
          loggedBy: p.loggedBy,
          paymentDate: p.paymentDate,
          assignedTo: order.assignedTo,
          flags: flags.map((f) => ({ flag: f.flag, severity: f.severity, detail: f.detail })),
        };
      });

      // Per-employee summary.
      const byEmployee: Record<string, { username: string; count: number; amount: number; flagged: number }> = {};
      for (const p of enrichedPayments) {
        const u = p.loggedBy || "(unknown)";
        if (!byEmployee[u]) byEmployee[u] = { username: u, count: 0, amount: 0, flagged: 0 };
        byEmployee[u].count += 1;
        byEmployee[u].amount += Number(p.amountPaid || 0);
        if (p.flags.length > 0) byEmployee[u].flagged += 1;
      }

      // Flag tally
      const flagTally: Record<string, number> = {};
      for (const a of audits) flagTally[a.flag] = (flagTally[a.flag] || 0) + 1;

      const totalAmount = enrichedPayments.reduce((s, p) => s + Number(p.amountPaid || 0), 0);

      return ok(res, {
        date: start.toISOString().slice(0, 10),
        rangeStart: start,
        rangeEnd: end,
        summary: {
          paymentCount: enrichedPayments.length,
          totalAmount,
          auditCount: audits.length,
          flaggedPayments: enrichedPayments.filter((p) => p.flags.length > 0).length,
          flagTally,
        },
        payments: enrichedPayments,
        employees: Object.values(byEmployee).sort((a, b) => b.amount - a.amount),
        audits, // raw rows for the "All Flags" view
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // List historical audit rows for the Maintenance/Audit drawer.
  app.get("/api/reports/payment-audit/feed", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
      const rows = await PaymentAudit.find().sort({ createdAt: -1 }).limit(limit).lean();
      return ok(res, rows);
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
    try {
      const { text } = req.body as { text?: string };
      if (!text || !text.trim()) return fail(res, 400, "text is required");
      // Locked to a single voice per project owner directive — do NOT read
      // from Settings.ttsVoice anymore. Always use Guy (US Male).
      const voice = "en-US-GuyNeural";
      const truncated = text.slice(0, 1000);

      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(truncated);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");

      audioStream.pipe(res);

      audioStream.on("error", (e: Error) => {
        tts.close();
        if (!res.headersSent) fail(res, 500, e.message);
      });

      res.on("close", () => {
        tts.close();
      });
    } catch (err: any) {
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

  // Restock request — fired by Create Order when employees try to add an
  // item that's out of stock or only partially available. Notifies all
  // admins + inventory managers so they can react.
  app.post("/api/inventory/notify-restock", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { itemId, itemName, needed, currentStock } = req.body || {};
      if (!itemName) return fail(res, 400, "Item name required.");
      const body = `${req.user!.username} needs ${needed ?? "?"} of "${itemName}" (only ${currentStock ?? "?"} in stock).`;
      await notify({
        category: "INVENTORY",
        title: `Restock requested: ${itemName}`,
        body,
        link: `/inventory`,
        recipientRole: "ADMIN",
        createdBy: req.user!.username,
      });
      await notify({
        category: "INVENTORY",
        title: `Restock requested: ${itemName}`,
        body,
        link: `/inventory`,
        recipientRole: "INVENTORY_MANAGER",
        createdBy: req.user!.username,
      });
      await logAction("RESTOCK_REQUESTED", req.user!.username, itemName, { itemId, needed, currentStock });
      return ok(res, { sent: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── NOTIFICATIONS ─────────────────────────────────────────────
  // Every logged-in user sees: notifs targeted at their username, notifs
  // targeted at their role, and global broadcasts (no recipient at all).
  app.get("/api/notifications", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const username = req.user!.username;
      const role = req.user!.role;
      const docs = await Notification.find({
        $or: [
          { recipientUsername: username },
          { recipientRole: role },
          { recipientUsername: "", recipientRole: "" },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      const enriched = docs.map((d: any) => ({ ...d, isRead: (d.readBy || []).includes(username) }));
      const unreadCount = enriched.filter((d) => !d.isRead).length;
      return ok(res, { notifications: enriched, unreadCount });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Mark a single notification read (push username into readBy).
  app.post("/api/notifications/:id/read", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const username = req.user!.username;
      await Notification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: username } });
      return ok(res, { ok: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Mark every visible notification read for this user.
  app.post("/api/notifications/read-all", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const username = req.user!.username;
      const role = req.user!.role;
      await Notification.updateMany(
        {
          $or: [
            { recipientUsername: username },
            { recipientRole: role },
            { recipientUsername: "", recipientRole: "" },
          ],
          readBy: { $ne: username },
        },
        { $addToSet: { readBy: username } },
      );
      return ok(res, { ok: true });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // ─── ITEM REQUESTS (employee → admin/IM approval) ─────────────
  // Employees create a pending request when they want to add or edit stock.
  // Approval needs the approver's password; the grant is single-use and
  // consumed when the underlying create/update endpoint runs.

  // Create a new request (employee).
  app.post("/api/item-requests", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user!.role === "ADMIN" || req.user!.role === "INVENTORY_MANAGER") {
        return fail(res, 400, "Admins and inventory managers do not need to request — you have direct access.");
      }
      const { action, payload, notes } = req.body as {
        action?: string;
        payload?: Record<string, any>;
        notes?: string;
      };
      if (!action || !["ADD_ITEM", "EDIT_STOCK", "DELETE_ITEM", "DUPLICATE_ORDER"].includes(action)) {
        return fail(res, 400, "Invalid action — must be ADD_ITEM, EDIT_STOCK, DELETE_ITEM, or DUPLICATE_ORDER");
      }
      // Block duplicates: one pending request of the same action per user.
      const existing = await ItemRequest.findOne({
        requestedBy: req.user!.username,
        action,
        status: "pending",
      });
      if (existing) {
        return ok(res, { request: existing, alreadyPending: true });
      }
      const reqDoc = await ItemRequest.create({
        requestedBy: req.user!.username,
        action,
        payload: payload || {},
        notes: notes || "",
      });
      await notify({
        category: "REQUEST",
        title: `${req.user!.username} wants to ${action === "ADD_ITEM" ? "add a new item" : action === "EDIT_STOCK" ? "edit stock" : "delete an item"}`,
        body: notes || "Awaiting approval. Open Inventory → Pending Requests to review.",
        link: "/inventory",
        recipientRole: "ADMIN",
        createdBy: req.user!.username,
      });
      await notify({
        category: "REQUEST",
        title: `${req.user!.username} wants to ${action === "ADD_ITEM" ? "add a new item" : action === "EDIT_STOCK" ? "edit stock" : "delete an item"}`,
        body: notes || "Awaiting approval. Open Inventory → Pending Requests to review.",
        link: "/inventory",
        recipientRole: "INVENTORY_MANAGER",
        createdBy: req.user!.username,
      });
      emitEvent("ITEM_REQUEST_CREATED", { requestId: reqDoc._id });
      return ok(res, { request: reqDoc, alreadyPending: false });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // List requests. Employees see their own; admins/IMs see everything.
  app.get("/api/item-requests", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const username = req.user!.username;
      const role = req.user!.role;
      const status = (req.query.status as string) || "";
      const filter: any = {};
      if (status) filter.status = status;
      if (role !== "ADMIN" && role !== "INVENTORY_MANAGER") {
        filter.requestedBy = username;
      }
      const requests = await ItemRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      return ok(res, { requests });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Race-safe approval. Requires the approver's password. The atomic
  // findOneAndUpdate guarantees only one approver can flip a pending
  // request to approved — duplicate approvers get a 409.
  app.post("/api/item-requests/:id/approve", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const role = req.user!.role;
      if (role !== "ADMIN" && role !== "INVENTORY_MANAGER") {
        return fail(res, 403, "Only admin or inventory manager can approve requests.");
      }
      const { password } = req.body as { password?: string };
      if (!password) return fail(res, 400, "Your password is required to approve.");
      const approver = await User.findById(req.user!._id).select("+password");
      const valid = approver && (await bcrypt.compare(password, (approver as any).password));
      if (!valid) return fail(res, 401, "Incorrect password.");

      const updated = await ItemRequest.findOneAndUpdate(
        { _id: req.params.id, status: "pending" },
        {
          $set: {
            status: "approved",
            approvedBy: req.user!.username,
            approvedAt: new Date(),
          },
        },
        { new: true },
      );
      if (!updated) {
        return fail(res, 409, "This request is no longer pending — somebody else already handled it.");
      }
      await notify({
        category: "REQUEST",
        title: `Your request was approved by ${req.user!.username}`,
        body: `You can now ${updated.action === "ADD_ITEM" ? "add a new item" : updated.action === "EDIT_STOCK" ? "edit stock" : "delete an item"} once. To do it again you'll need to request again.`,
        link: "/inventory",
        recipientUsername: updated.requestedBy,
        createdBy: req.user!.username,
      });
      await logAction("ITEM_REQUEST_APPROVED", req.user!.username, updated.requestedBy, { action: updated.action, requestId: updated._id });
      emitEvent("ITEM_REQUEST_UPDATED", { requestId: updated._id, status: "approved" });
      return ok(res, { request: updated });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Reject a pending request.
  app.post("/api/item-requests/:id/reject", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const role = req.user!.role;
      if (role !== "ADMIN" && role !== "INVENTORY_MANAGER") {
        return fail(res, 403, "Only admin or inventory manager can reject requests.");
      }
      const { reason, password } = req.body as { reason?: string; password?: string };
      if (!password) return fail(res, 400, "Your password is required to reject.");
      const approver = await User.findById(req.user!._id).select("+password");
      const valid = approver && (await bcrypt.compare(password, (approver as any).password));
      if (!valid) return fail(res, 401, "Incorrect password.");

      const updated = await ItemRequest.findOneAndUpdate(
        { _id: req.params.id, status: "pending" },
        {
          $set: {
            status: "rejected",
            rejectedBy: req.user!.username,
            rejectedAt: new Date(),
            rejectionReason: reason || "",
          },
        },
        { new: true },
      );
      if (!updated) return fail(res, 409, "This request is no longer pending.");
      await notify({
        category: "REQUEST",
        title: `Your request was rejected by ${req.user!.username}`,
        body: reason || "No reason given.",
        link: "/inventory",
        recipientUsername: updated.requestedBy,
        createdBy: req.user!.username,
      });
      await logAction("ITEM_REQUEST_REJECTED", req.user!.username, updated.requestedBy, { reason, requestId: updated._id });
      emitEvent("ITEM_REQUEST_UPDATED", { requestId: updated._id, status: "rejected" });
      return ok(res, { request: updated });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Requester can cancel their own pending request (e.g. they changed their
  // mind while waiting).
  app.post("/api/item-requests/:id/cancel", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const reqDoc = await ItemRequest.findById(req.params.id);
      if (!reqDoc) return fail(res, 404, "Request not found.");
      if (reqDoc.requestedBy !== req.user!.username) {
        return fail(res, 403, "You can only cancel your own request.");
      }
      if (reqDoc.status !== "pending") {
        return fail(res, 400, "Only pending requests can be cancelled.");
      }
      reqDoc.status = "cancelled";
      await reqDoc.save();
      emitEvent("ITEM_REQUEST_UPDATED", { requestId: reqDoc._id, status: "cancelled" });
      return ok(res, { request: reqDoc });
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

  // Backup email address — displayed in Maintenance; editing requires admin password.
  app.get("/api/maintenance/backup-email", authMiddleware, adminOnly, async (_req: AuthRequest, res: Response) => {
    try {
      let settings = await Settings.findOne();
      if (!settings) settings = await Settings.create({});
      return ok(res, { email: settings.backupEmail || "marksonguarine@gmail.com" });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  app.patch("/api/maintenance/backup-email", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, "Enter a valid email address");
      if (!password) return fail(res, 400, "Admin password is required to change the backup email");
      const admin = await User.findById(req.user!._id).select("+password");
      const valid = admin && (await bcrypt.compare(password, (admin as any).password));
      if (!valid) return fail(res, 401, "Incorrect admin password");
      let settings = await Settings.findOne();
      if (!settings) settings = await Settings.create({});
      settings.backupEmail = email.trim();
      await settings.save();
      await logAction("BACKUP_EMAIL_CHANGED", req.user!.username, "", { email: settings.backupEmail });
      return ok(res, { email: settings.backupEmail });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Email the current full backup right now (manual trigger).
  app.post("/api/maintenance/backup/email", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
    try {
      const data = await createBackupData();
      const json = JSON.stringify(data, null, 2);
      const filename = `manual-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const settings = await Settings.findOne();
      const to = settings?.backupEmail || "marksonguarine@gmail.com";
      const mail = await sendBackupEmail(to, filename, json);
      if (!mail.ok) return fail(res, 502, `Failed to send backup email: ${mail.error}`);
      await logAction("BACKUP_EMAILED", req.user!.username, "", { to, filename });
      return ok(res, { message: `Backup emailed to ${to}`, to });
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

  // [REMOVED] Legacy POST /api/messages handler. It expected `{subject,
  // message}` and was registered BEFORE the real /api/messages handler
  // (which expects `{toUsername, body}`) — so Express was always routing to
  // the old one and rejecting valid requests with "Subject and message
  // required" even when the form had both fields. The real handler lives
  // further down (~line 4307).

  app.patch("/api/messages/:id/read-legacy", authMiddleware, adminOnly, async (req: AuthRequest, res: Response) => {
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
      // Full wipe — EVERYTHING, including users, settings, offers, customers.
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
        Offer.deleteMany({}),
        RequestModel.deleteMany({}),
        Message.deleteMany({}),
        EmployeeProfile.deleteMany({}),
        UserSession.deleteMany({}),
        SiteVisitor.deleteMany({}),
        Settings.deleteMany({}),
        User.deleteMany({}),
        Notification.deleteMany({}),
        ItemRequest.deleteMany({}),
      ]);

      const uploadFiles = fs.readdirSync(UPLOADS_DIR);
      uploadFiles.forEach((f) => {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch {}
      });
      const backupFiles = fs.readdirSync(BACKUPS_DIR);
      backupFiles.forEach((f) => {
        try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); } catch {}
      });

      // Re-seed only a minimal baseline so the system isn't bricked: a single
      // default admin (JoapAdmin20Jk / AdminPriv23#Ds) + a fresh Settings doc.
      // Everything else (inventory, offers, employees, customers) is left empty
      // to repopulate manually or by uploading an old JSON backup.
      const adminPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await User.create({ username: DEFAULT_ADMIN_USERNAME, password: adminPassword, role: "ADMIN", isActive: true });
      await Settings.create({});

      await logAction("SYSTEM_WIPE", req.user!.username, "", { action: "complete_wipe", reseeded: `${DEFAULT_ADMIN_USERNAME}/${DEFAULT_ADMIN_PASSWORD}` });
      return ok(res, { message: `All data wiped. A default admin (${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}) was recreated so you can log back in and repopulate.` });
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
      // Race-safe claim (REQUEST.pdf R11 §6 spec): atomically reserve this
      // pending request by stamping `approver` on the first admin to win
      // the optimistic update. Second admin gets a 409 instead of
      // double-handling. We don't flip status here — the existing business
      // logic below still does the real "accepted" transition.
      const claimed = await RequestModel.findOneAndUpdate(
        { _id: req.params.id, status: "pending", $or: [{ approver: { $exists: false } }, { approver: "" }, { approver: null }] },
        { $set: { approver: req.user!.username } },
        { new: true },
      );
      if (!claimed) {
        const probe = await RequestModel.findById(req.params.id);
        if (!probe) return fail(res, 404, "Request not found");
        if (probe.status !== "pending") return fail(res, 409, `This request was already ${probe.status} by ${probe.approver || "another admin"}.`);
        return fail(res, 409, `This request is already being handled by ${probe.approver || "another admin"}.`);
      }
      const doc = claimed;

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

  // ════════════════════════════════════════════════════════════════════════════
  // FORECASTING — ARIMA(1, 1, 1) demand forecast
  // Inputs: per-item daily outflow series derived from InventoryLog deductions
  // Outputs: 7/14/30-day forecasts with 95% prediction intervals + reorder advice
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/api/forecast/items", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const horizon = Math.max(1, Math.min(60, parseInt((req.query.horizon as string) || "14")));
      const lookbackDays = Math.max(7, Math.min(365, parseInt((req.query.lookback as string) || "60")));

      const now = new Date();
      const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

      // Pull every inventory deduction within the lookback window — these
      // represent actual sales velocity per item.
      const logs = await InventoryLog.find({
        type: "deduction",
        createdAt: { $gte: startDate },
      }).select("itemId itemName quantity createdAt").lean();

      // Group by item
      const byItem = new Map<string, { itemName: string; events: Array<{ date: Date; qty: number }> }>();
      for (const log of logs) {
        const id = String(log.itemId);
        const existing = byItem.get(id);
        const ev = { date: new Date(log.createdAt), qty: Math.abs(log.quantity || 0) };
        if (existing) existing.events.push(ev);
        else byItem.set(id, { itemName: log.itemName, events: [ev] });
      }

      // Also pull current inventory levels for reorder advice
      const items = await Item.find().select("itemName currentQuantity unitPrice category").lean();

      // Build a forecast for EVERY item so the per-item view is complete. Items
      // with enough sales history get a real ARIMA(1,1,1) fit; sparse items fall
      // back to a flat forecast at their observed average daily demand (often 0),
      // so they still appear with current stock + reorder advice.
      const forecasts: any[] = [];
      for (const item of items) {
        const itemId = String(item._id);
        const events = byItem.get(itemId)?.events || [];
        const series = bucketByDay(events, startDate, now);

        let forecast: number[];
        let lower95: number[];
        let upper95: number[];
        let modelParams: any;
        let sigma = 0;
        let observations = series.length;

        if (series.length >= 5 && events.length > 0) {
          const result = arima(series, { p: 1, d: 1, q: 1, horizon });
          forecast = result.forecast;
          lower95 = result.lower95;
          upper95 = result.upper95;
          modelParams = result.params;
          sigma = result.sigma;
          observations = result.observations;
        } else {
          // Fallback: flat forecast at the observed mean daily demand.
          const totalQty = events.reduce((s, e) => s + e.qty, 0);
          const mean = series.length > 0 ? totalQty / series.length : 0;
          forecast = Array(horizon).fill(mean);
          lower95 = Array(horizon).fill(Math.max(0, mean * 0.5));
          upper95 = Array(horizon).fill(mean * 1.5);
          modelParams = { note: "insufficient history — flat mean", mean: Math.round(mean * 100) / 100 };
        }

        const totalForecastDemand = forecast.reduce((s, v) => s + Math.max(0, v), 0);
        const avgDailyDemand = totalForecastDemand / horizon;
        const currentStock = item.currentQuantity ?? 0;
        const daysOfStock = avgDailyDemand > 0 ? currentStock / avgDailyDemand : Infinity;
        const reorderUrgency =
          daysOfStock < 3 ? "critical" :
          daysOfStock < 7 ? "high" :
          daysOfStock < 14 ? "medium" : "low";

        forecasts.push({
          itemId,
          itemName: item.itemName,
          category: item.category || "",
          currentStock,
          unitPrice: item.unitPrice || 0,
          series,
          forecast: forecast.map((v) => Math.max(0, Math.round(v * 100) / 100)),
          lower95: lower95.map((v) => Math.max(0, Math.round(v * 100) / 100)),
          upper95: upper95.map((v) => Math.max(0, Math.round(v * 100) / 100)),
          avgDailyDemand: Math.round(avgDailyDemand * 100) / 100,
          totalForecastDemand: Math.round(totalForecastDemand * 100) / 100,
          daysOfStock: Number.isFinite(daysOfStock) ? Math.round(daysOfStock * 10) / 10 : null,
          reorderUrgency,
          model: modelParams,
          sigma: Math.round(sigma * 100) / 100,
          observations,
          hasHistory: events.length > 0,
        });
      }

      // Sort by urgency then by forecast demand descending
      const urgencyRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      forecasts.sort((a, b) =>
        (urgencyRank[a.reorderUrgency] - urgencyRank[b.reorderUrgency]) ||
        (b.totalForecastDemand - a.totalForecastDemand)
      );

      return ok(res, {
        horizon,
        lookbackDays,
        generatedAt: now.toISOString(),
        model: "ARIMA(1, 1, 1)",
        itemsAnalyzed: forecasts.length,
        itemsWithHistory: byItem.size,
        forecasts,
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  // Aggregate forecast across all items — used for dashboard widgets
  app.get("/api/forecast/aggregate", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const horizon = Math.max(1, Math.min(60, parseInt((req.query.horizon as string) || "14")));
      const lookbackDays = Math.max(7, Math.min(365, parseInt((req.query.lookback as string) || "60")));

      const now = new Date();
      const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

      // Aggregate ORDER count + revenue per day
      const orders = await Order.find({
        createdAt: { $gte: startDate },
        fulfillmentStatus: { $nin: ["cancelled"] },
      }).select("createdAt totalAmount").lean();

      const orderEvents = orders.map((o) => ({ date: new Date(o.createdAt), qty: 1 }));
      const revenueEvents = orders.map((o) => ({ date: new Date(o.createdAt), qty: o.totalAmount || 0 }));

      const orderSeries = bucketByDay(orderEvents, startDate, now);
      const revenueSeries = bucketByDay(revenueEvents, startDate, now);

      const orderForecast = arima(orderSeries, { p: 1, d: 1, q: 1, horizon });
      const revenueForecast = arima(revenueSeries, { p: 1, d: 1, q: 1, horizon });

      // Build date labels
      const labels: string[] = [];
      for (let i = 0; i < horizon; i++) {
        const d = new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
        labels.push(d.toISOString().slice(0, 10));
      }
      const historyLabels: string[] = [];
      for (let i = 0; i < orderSeries.length; i++) {
        const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        historyLabels.push(d.toISOString().slice(0, 10));
      }

      return ok(res, {
        horizon,
        lookbackDays,
        model: "ARIMA(1, 1, 1)",
        historyLabels,
        forecastLabels: labels,
        orders: {
          history: orderSeries,
          forecast: orderForecast.forecast.map((v) => Math.max(0, Math.round(v))),
          lower95: orderForecast.lower95.map((v) => Math.max(0, Math.round(v))),
          upper95: orderForecast.upper95.map((v) => Math.max(0, Math.round(v))),
          totalForecastDemand: orderForecast.forecast.reduce((s, v) => s + Math.max(0, v), 0),
          sigma: orderForecast.sigma,
          params: orderForecast.params,
        },
        revenue: {
          history: revenueSeries,
          forecast: revenueForecast.forecast.map((v) => Math.max(0, Math.round(v))),
          lower95: revenueForecast.lower95.map((v) => Math.max(0, Math.round(v))),
          upper95: revenueForecast.upper95.map((v) => Math.max(0, Math.round(v))),
          totalForecastRevenue: revenueForecast.forecast.reduce((s, v) => s + Math.max(0, v), 0),
          sigma: revenueForecast.sigma,
          params: revenueForecast.params,
        },
      });
    } catch (err: any) {
      return fail(res, 500, err.message);
    }
  });

  return httpServer;
}
