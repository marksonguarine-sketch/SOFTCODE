import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { connectDB } from "./db";
import { seedDatabase } from "./seed";
import SiteVisitor from "./models/SiteVisitor";
import { sendTelegramNotification, parseDeviceName } from "./lib/telegram";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

function visitorTrackingMiddleware(req: Request, res: Response, next: NextFunction) {
  const isPageLoad =
    req.method === "GET" &&
    !req.path.startsWith("/api") &&
    !req.path.startsWith("/node_modules") &&
    !req.path.startsWith("/@") &&
    !req.path.startsWith("/src") &&
    !req.path.startsWith("/assets") &&
    !req.path.match(/\.(js|ts|css|map|ico|png|jpg|jpeg|svg|woff|woff2|ttf|gif|webp)$/i);

  if (!isPageLoad) return next();

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const userAgent = req.headers["user-agent"] || "";
  const deviceName = parseDeviceName(userAgent);

  SiteVisitor.findOneAndUpdate(
    { ip },
    { $inc: { visitCount: 1 }, lastSeen: new Date() },
    { upsert: true, returnDocument: "after" }
  )
    .then((visitor) => {
      const count = visitor?.visitCount ?? 1;
      const message =
        `🔔 <b>New Site Visit</b>\n\n` +
        `📱 <b>Device name:</b> ${deviceName}\n` +
        `🔢 <b>How many times visit:</b> ${count}`;
      return sendTelegramNotification(message);
    })
    .catch((err) => {
      console.warn("[visitor] tracking error:", err);
    });

  next();
}

(async () => {
  await connectDB();
  await seedDatabase();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    app.use(visitorTrackingMiddleware);
    serveStatic(app);
  } else {
    app.use(visitorTrackingMiddleware);
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const isWindows = process.platform === "win32";
  const listenOpts: any = { port, host: "0.0.0.0" };
  if (!isWindows) listenOpts.reusePort = true;
  httpServer.listen(listenOpts, () => {
    log(`serving on port ${port}`);
  });
})();
