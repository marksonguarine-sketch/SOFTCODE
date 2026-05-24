import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import UserSession from "../models/UserSession";
import User from "../models/User";

const JWT_SECRET = process.env.SESSION_SECRET || "joap-hardware-secret-key";

export interface AuthRequest extends Request {
  user?: {
    _id: string;
    username: string;
    role: "ADMIN" | "EMPLOYEE";
  };
}

export function generateToken(payload: { _id: string; username: string; role: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

// ── In-memory session cache ─────────────────────────────────────────────────
// Avoids 3 sequential DB round trips on every authenticated request.
// Cache entries expire after 30 s; cleared immediately on logout/deactivation.
const SESSION_CACHE_TTL = 30_000;          // 30 s
const LAST_ACTIVITY_THROTTLE = 60_000;     // update DB at most once per 60 s

type CacheEntry = { user: NonNullable<AuthRequest["user"]>; expiresAt: number };
const sessionCache = new Map<string, CacheEntry>();
const lastActivityMap = new Map<string, number>();

export function clearSessionCache(token: string) {
  sessionCache.delete(token);
  lastActivityMap.delete(token);
}

export function clearAllSessionsForUser(userId: string) {
  Array.from(sessionCache.entries()).forEach(([token, entry]) => {
    if (entry.user._id === userId) {
      sessionCache.delete(token);
      lastActivityMap.delete(token);
    }
  });
}

// Prune expired entries periodically to prevent memory growth
setInterval(() => {
  const now = Date.now();
  Array.from(sessionCache.entries()).forEach(([token, entry]) => {
    if (entry.expiresAt <= now) {
      sessionCache.delete(token);
      lastActivityMap.delete(token);
    }
  });
}, 60_000);

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.token;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;

    if (!token) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    // ── Fast path: serve from in-memory cache ──────────────────────────────
    const cached = sessionCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      // Throttle lastActivity DB writes to once per 60 s
      const lastUpdate = lastActivityMap.get(token) ?? 0;
      if (Date.now() - lastUpdate > LAST_ACTIVITY_THROTTLE) {
        lastActivityMap.set(token, Date.now());
        UserSession.updateOne({ token }, { lastActivity: new Date() }).catch(() => {});
      }
      return next();
    }

    // ── Slow path: verify + DB lookup ─────────────────────────────────────
    const decoded = jwt.verify(token, JWT_SECRET) as {
      _id: string; username: string; role: "ADMIN" | "EMPLOYEE";
    };

    // Parallelize both DB queries
    const [session, user] = await Promise.all([
      UserSession.findOne({ token, isActive: true }).lean(),
      User.findById(decoded._id).select("isActive").lean(),
    ]);

    if (!session) {
      sessionCache.delete(token);
      return res.status(401).json({ success: false, error: "Session expired or invalid" });
    }
    if (!user || !user.isActive) {
      sessionCache.delete(token);
      return res.status(401).json({ success: false, error: "Account is inactive" });
    }

    const userPayload = { _id: decoded._id, username: decoded.username, role: decoded.role };

    // Populate cache for subsequent requests
    sessionCache.set(token, { user: userPayload, expiresAt: Date.now() + SESSION_CACHE_TTL });
    lastActivityMap.set(token, Date.now());
    UserSession.updateOne({ token }, { lastActivity: new Date() }).catch(() => {});

    req.user = userPayload;
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
}
