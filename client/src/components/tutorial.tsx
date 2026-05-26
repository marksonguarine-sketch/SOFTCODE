import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, SkipForward, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface TutorialStep {
  path: string;
  target: string;
  title: string;
  narration: string;
  highlightPadding?: number;
}

// ─── ADMIN STEPS ──────────────────────────────────────────────────────────────
const ADMIN_STEPS: TutorialStep[] = [
  {
    path: "/",
    target: "[data-testid='button-sidebar-toggle']",
    title: "Welcome to JOAP Hardware Trading",
    narration: "Welcome to JOAP Hardware Trading management system! I will guide you through every feature. This is the sidebar toggle button. Click it to expand or collapse the navigation menu on the left side. The sidebar gives you access to every module in the system.",
  },
  {
    path: "/",
    target: "[data-testid='breadcrumbs']",
    title: "Header & Navigation",
    narration: "The header always shows your current location as a breadcrumb trail. To the right you will see a live Philippine Time clock that updates every second. Your username is displayed so you always know which account is active. Use the logout button on the far right to sign out safely.",
  },
  {
    path: "/",
    target: "[data-testid='card-earnings']",
    title: "Dashboard — KPI Cards",
    narration: "This is your dashboard. At the top you see four key performance indicator cards showing Revenue Today, Orders Today, Gross Margin, and Low-stock Items. Each card has a sparkline trend chart and a percentage badge showing change versus the prior period. The data updates automatically every 30 seconds.",
  },
  {
    path: "/",
    target: "[data-testid='section-revenue']",
    title: "Revenue Trend Chart",
    narration: "This is the revenue trend chart. It shows your daily revenue and order volume over the selected period. Use the period buttons — 7 days, 14 days, 30 days, or 90 days — to zoom in or out. Hover over any data point to see the exact revenue and order count for that day.",
  },
  {
    path: "/",
    target: "[data-testid='page-dashboard']",
    title: "Daily Sales Goal Ring",
    narration: "The daily sales goal ring shows how close you are to your revenue target for today. The ring fills up as revenue comes in. The target is set by the admin in the Settings page. When you hit the goal, the ring turns green. Below the ring you see the achieved amount, target, and remaining gap.",
  },
  {
    path: "/",
    target: "[data-testid='page-dashboard']",
    title: "Activity Feed & Payment Mix",
    narration: "Below the charts you see the Activity Feed showing the most recent orders in real time with a green Live badge. Next to it is the Payment Mix donut chart showing the split between Cash, GCash, COD, and Bank payments this week. Click any order in the activity feed to open its full detail page.",
  },
  {
    path: "/",
    target: "[data-testid='button-export-dashboard']",
    title: "Export Dashboard PDF",
    narration: "This Export PDF button generates a complete dashboard summary report as a PDF file. It includes all KPI values, revenue by day, top items, and a timestamp. Click it now to download a copy. This is useful for daily morning stand-ups or management briefings.",
  },
  {
    path: "/inventory",
    target: "[data-testid='button-add-item']",
    title: "Inventory — Adding Items",
    narration: "This is the Inventory page. All your products are listed here with SKU, price, quantity, and stock health. Click the Add Item button to create a new product. You will enter the item name, category, supplier, unit price, current quantity, and reorder level. Admin users can upload product images directly.",
  },
  {
    path: "/inventory",
    target: "[data-testid='input-inventory-search']",
    title: "Search & Filter Inventory",
    narration: "Use this search bar to find items by name or SKU. Below the search bar are category pills — click any category to filter the list. On the right is a toggle to switch between Table view and Grid view. The KPI strip at the top shows Total Stocks, Stock Value, Low-stock items, and Dead Stock at a glance.",
  },
  {
    path: "/orders",
    target: "[data-testid='button-create-order']",
    title: "Creating Orders",
    narration: "This is the Orders page — the heart of your daily operations. Click Create Order to start a new transaction. You will enter the customer name, add items with quantities, choose the sales channel such as walk-in or delivery, and optionally add a delivery address. The system calculates the total automatically and can auto-apply active discount offers.",
  },
  {
    path: "/orders",
    target: "[data-testid='tab-all']",
    title: "Order Status Tabs",
    narration: "Orders are organized by status tabs at the top. You can view All orders, Pending Payment, Paid, Pending Release, Released, or Cancelled. The Pool tab shows unassigned orders that need to be assigned to an employee. Click any order row to open its full detail page where you can log payments and update status.",
  },
  {
    path: "/orders",
    target: "[data-testid='page-orders']",
    title: "Assigning Orders to Staff",
    narration: "In the Pool tab, each unassigned order has a professional Assign button. Click it to open a dropdown list of all staff members with their avatar initials. Select a staff member to assign the order — they will hear a voice announcement immediately and the order appears in their queue.",
  },
  {
    path: "/billing",
    target: "[data-testid='button-toggle-search']",
    title: "Billing & Payment Records",
    narration: "The Billing page shows all payment records across the store. Click the search button to filter by date range, order tracking number, GCash reference number, or customer name. Each row shows the payment method, amount, and timestamp. Click any row to jump straight to the full order detail.",
  },
  {
    path: "/pending-payment",
    target: "[data-testid='text-pending-payment-title']",
    title: "Pending Payment Dashboard",
    narration: "This dedicated page lists every order that is waiting on payment. The table shows tracking number, customer name, order type, payment method, amount due, and date created. The sidebar badge shows the live count of unpaid orders. Click any row to open the order and log the payment immediately.",
  },
  {
    path: "/accounting",
    target: "[data-testid='button-add-entry']",
    title: "Accounting — General Ledger",
    narration: "The Accounting page has two sections — the Chart of Accounts on the left and the General Ledger on the right. Every time an order is paid, the system automatically posts entries to Cash and Sales Revenue. You can also add manual journal entries for expenses, corrections, or other transactions using this Add Entry button.",
  },
  {
    path: "/reports",
    target: "[data-testid='tab-sales']",
    title: "Reports — Sales Analytics",
    narration: "The Reports page gives you deep analytics with date-range filters. The Sales tab shows total orders, revenue, completed versus cancelled orders, and a top customers table. The Inventory tab shows stock movements. The Financial tab shows payment method breakdown. You can export any report as a PDF or CSV spreadsheet.",
  },
  {
    path: "/forecasting",
    target: "[data-testid='button-export-forecast']",
    title: "Demand Forecasting",
    narration: "The Forecasting page uses an ARIMA statistical model to predict future order volume and revenue. Choose a 7, 14, or 30-day horizon. The blue line shows actual historical data. The dashed orange line shows the forecast. The shaded band is the 95 percent confidence interval. Per-item urgency colors show Red for reorder now and Amber for reorder soon. Export the full report as a PDF for supplier meetings.",
  },
  {
    path: "/reservations",
    target: "[data-testid='text-reservations-title']",
    title: "Reservations",
    narration: "The Reservations page lets you book scheduled pickup or delivery orders for a future date. Each reservation shows the customer name, scheduled date, assigned employee, and current status. You can confirm, complete, or cancel reservations as the pickup date approaches. Reservations automatically link to an order for payment processing.",
  },
  {
    path: "/requests",
    target: "[data-testid='text-requests-title']",
    title: "Employee Requests",
    narration: "Employees can submit three types of requests — Add Item requests to add a new product to inventory, Transfer Order requests to hand off an order to another staff member, and Leave Requests. All pending requests appear here with a badge count. Click any pending request to see the full details and use the Accept or Decline buttons.",
  },
  {
    path: "/employees",
    target: "[data-testid='text-employees-title']",
    title: "Employee Directory",
    narration: "This is your team directory. Each card shows the employee photo, ID, account status indicator, email, and a link to their full profile. The green dot means the account is active. Gray means deactivated. Click any card to open a full modal with KPI charts, productivity metrics, recent orders, activity timeline, and an Export PDF button for payroll or performance reviews.",
  },
  {
    path: "/users",
    target: "[data-testid='button-create-user']",
    title: "User Management",
    narration: "As an admin, you manage all user accounts here. Click Create User to add a new staff member with a username, password, and role. You can change roles between Admin and Employee, reset passwords, and deactivate accounts to prevent login without deleting any history. Note that you cannot deactivate the last remaining admin account for safety.",
  },
  {
    path: "/offers",
    target: "[data-testid='page-offers']",
    title: "Offers & Discounts",
    narration: "The Offers page lets you create promotional discounts that automatically apply to new orders. You can set percentage discounts, fixed amount discounts, or buy-one-get-one offers. Each offer has a start and end date, a minimum order amount, and can be limited to specific items or categories. Active offers show a green status badge.",
  },
  {
    path: "/settings",
    target: "[data-testid='input-daily-sales-goal']",
    title: "System Settings — Daily Goal",
    narration: "In Settings, you can configure the entire system. The Daily Sales Goal here sets the revenue target shown on every dashboard as a progress ring — both yours and every employee's dashboard reads this value. Only admins can change it. Below you will also find company information, store address for receipts, font choices, and color themes.",
  },
  {
    path: "/settings",
    target: "[data-testid='card-appearance-tweaks']",
    title: "Appearance Tweaks",
    narration: "The Appearance Tweaks section at the bottom of Settings lets you personalize the interface. Choose a density — Compact, Balanced, or Comfortable — and pick an accent color. These preferences are saved in your browser per device so they only apply to you, not to other users. Changes apply instantly with no save needed.",
  },
  {
    path: "/maintenance",
    target: "[data-testid='button-export-backup']",
    title: "Maintenance & Backup",
    narration: "The Maintenance page lets you export a full system backup, upload and restore from a previous backup, and schedule automatic daily backups. Always create a backup before any major data change. The system health panel shows MongoDB connection status and server memory usage.",
  },
  {
    path: "/system-logs",
    target: "[data-testid='input-search-logs']",
    title: "System Logs",
    narration: "System Logs record every single action taken in the system with the actor username, action type, timestamp, and full details. Use this search bar to find specific events. Filter by user, date, or action type. Logs are immutable — they cannot be edited or deleted. This is your complete audit trail for accountability.",
  },
  {
    path: "/help",
    target: "[data-testid='text-help-title']",
    title: "Help & Support",
    narration: "The Help page has a comprehensive module guide, frequently asked questions, and keyboard shortcuts. Employees can also send messages directly to you from here. Unread messages show a badge count on the Help link in the sidebar. That completes the full admin tutorial — you are now ready to run the store like a professional!",
  },
];

// ─── EMPLOYEE STEPS ───────────────────────────────────────────────────────────
const EMPLOYEE_STEPS: TutorialStep[] = [
  {
    path: "/",
    target: "[data-testid='button-sidebar-toggle']",
    title: "Welcome — Employee Guide",
    narration: "Welcome to JOAP Hardware Trading! I will show you everything you need to operate the system as an employee. This sidebar toggle opens and closes the navigation menu. Use the sidebar to jump between Inventory, Orders, Reservations, Billing, and Reports.",
  },
  {
    path: "/",
    target: "[data-testid='breadcrumbs']",
    title: "Header & Your Identity",
    narration: "The header always shows your breadcrumb location. Your username is displayed on the right so you always know which account is logged in. The live Philippine Time clock ticks every second. Use the logout button on the far right to sign out when your shift ends.",
  },
  {
    path: "/",
    target: "[data-testid='card-earnings']",
    title: "Your Dashboard",
    narration: "Your dashboard shows the store's key metrics. At the top are four cards showing Revenue Today, Orders Today, Gross Margin, and Low-stock Items. These numbers update in real time. The daily sales goal ring shows how close the store is to today's revenue target set by your admin.",
  },
  {
    path: "/",
    target: "[data-testid='page-dashboard']",
    title: "Activity Feed",
    narration: "Scroll down to see the Activity Feed showing the most recent orders across the store in real time. You can see which orders were just placed, which are pending payment, and which have been completed. Click any order in the feed to open it directly.",
  },
  {
    path: "/inventory",
    target: "[data-testid='input-inventory-search']",
    title: "Searching Inventory",
    narration: "The Inventory page shows all products. Use this search bar to find any item by name or SKU code. Click the category pills to filter by type. Switch between Table and Grid views using the toggle on the right. The KPI strip shows Total Stocks, Stock Value, and how many items are running low.",
  },
  {
    path: "/inventory",
    target: "[data-testid='button-add-item']",
    title: "Adding Inventory Items",
    narration: "Click Add Item to add a new product. Fill in the item name, category, supplier, price, and current quantity. When you upload an image, it goes to your admin for approval before it appears publicly. You can request to add items that are not yet in the system using the Requests module.",
  },
  {
    path: "/orders",
    target: "[data-testid='button-create-order']",
    title: "Creating an Order",
    narration: "The Orders page is where you will spend most of your time. Click Create Order to start. Enter the customer name, then add items by searching and selecting quantities. Choose the sales channel — walk-in, delivery, or pickup. If delivery, check the delivery address box and fill in the address. The total calculates automatically.",
  },
  {
    path: "/orders",
    target: "[data-testid='tab-all']",
    title: "Managing Your Orders",
    narration: "You can see all orders assigned to you in the All tab. Use the status tabs to filter — Pending Payment, Paid, Pending Release, Released, and Cancelled. Click any order row to open its detail page. From there you can start processing it, log the payment when the customer pays, and release the items when fulfilled.",
  },
  {
    path: "/orders",
    target: "[data-testid='page-orders']",
    title: "Processing an Order",
    narration: "When you open an order detail page, you will see the full order information. First click Start to claim the order. Then log the payment by selecting the payment method and entering the reference number if paying by GCash. After payment is confirmed, release the items to complete the order. Each step is logged with your name and a timestamp.",
  },
  {
    path: "/billing",
    target: "[data-testid='button-toggle-search']",
    title: "Billing Records",
    narration: "The Billing page shows payment records. You can search for a specific payment by date range, customer name, or GCash reference number. Click any payment row to open the linked order. This page helps you verify that payments were recorded correctly.",
  },
  {
    path: "/pending-payment",
    target: "[data-testid='text-pending-payment-title']",
    title: "Pending Payments",
    narration: "This page shows every order waiting for payment. The sidebar badge counts unpaid orders so you never miss one. When a customer comes to pay, find their order here, click it to open the detail, and log the payment. The system will post the entry to accounting automatically.",
  },
  {
    path: "/reservations",
    target: "[data-testid='text-reservations-title']",
    title: "Reservations",
    narration: "The Reservations page shows bookings for future orders. When a reservation is assigned to you, you will receive a voice announcement. On the scheduled date, open the reservation, confirm the customer has arrived, and process it like a regular order. You can also create new reservations for customers who want to schedule pickup.",
  },
  {
    path: "/requests",
    target: "[data-testid='text-requests-title']",
    title: "Submitting Requests",
    narration: "As an employee, you can submit three types of requests from this page. An Add Item request asks your admin to add a new product to inventory. A Transfer Order request lets you hand off one of your orders to another staff member. A Leave Request files a leave application for your admin to review. Your admin will be notified immediately.",
  },
  {
    path: "/profile",
    target: "[data-testid='text-profile-title']",
    title: "Your Profile",
    narration: "The My Profile page shows your personal information and account details. You can update your contact number and email address. Upload a professional photo by clicking the camera icon — it will be visible to the admin and in the employee directory. Your KPI stats show your order count and productivity metrics.",
  },
  {
    path: "/settings",
    target: "[data-testid='card-appearance-tweaks']",
    title: "Personalizing Your View",
    narration: "In Settings, scroll to the Appearance Tweaks section. You can change the interface density and accent color. These are saved per device and only affect your view — not other users. You can also toggle the floating calculator on or off. The calculator supports full keyboard input — type numbers directly when it is open.",
  },
  {
    path: "/help",
    target: "[data-testid='text-help-title']",
    title: "Help & Sending Messages",
    narration: "The Help page is always here when you need it. Browse the module guide, search the FAQs, and check the keyboard shortcuts. You can also send a direct message to your admin using the Message form at the bottom. Your admin will see a badge notification immediately. That completes the employee tutorial — you are ready to work!",
  },
];

// ─── TYPES ─────────────────────────────────────────────────────────────────────
interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// ─── CURSOR SVG ─────────────────────────────────────────────────────────────────
function CursorIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}
    >
      <path
        d="M4 2L22 14L13.5 15.5L9 24L4 2Z"
        fill="white"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="22" cy="22" r="4" fill="hsl(var(--primary))" opacity="0.85" />
    </svg>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export function Tutorial({
  isAdmin,
  onComplete,
}: {
  isAdmin: boolean;
  onComplete: () => void;
}) {
  const steps = isAdmin ? ADMIN_STEPS : EMPLOYEE_STEPS;
  const [currentStep, setCurrentStep] = useState(0);
  const [wordIndex, setWordIndex] = useState(-1);
  const [cursorPos, setCursorPos] = useState({
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 400,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 300,
  });
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const [, navigate] = useLocation();
  const wordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const step = steps[currentStep];
  const words = step.narration.split(" ");
  const totalSteps = steps.length;

  // ── Find target and update spotlight + cursor ───────────────────────────────
  const focusTarget = useCallback(() => {
    const pad = step.highlightPadding ?? 12;
    const el = document.querySelector(step.target);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      setTimeout(() => {
        const rect = el.getBoundingClientRect();
        setSpotlightRect({
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        });
        setCursorPos({
          x: rect.left + rect.width * 0.7,
          y: rect.top + rect.height * 0.6,
        });
      }, 300);
    } else {
      setSpotlightRect(null);
    }
  }, [step.target, step.highlightPadding]);

  // ── Navigate + focus on step change ────────────────────────────────────────
  useEffect(() => {
    setWordIndex(-1);
    setIsNavigating(true);
    if (wordTimerRef.current) clearInterval(wordTimerRef.current);
    if (targetTimerRef.current) clearTimeout(targetTimerRef.current);
    if (ttsAbortRef.current) ttsAbortRef.current.abort();

    navigate(step.path);

    targetTimerRef.current = setTimeout(() => {
      focusTarget();
      setIsNavigating(false);

      // Start word animation
      let idx = 0;
      setWordIndex(0);
      wordTimerRef.current = setInterval(() => {
        idx += 1;
        if (idx >= words.length) {
          if (wordTimerRef.current) clearInterval(wordTimerRef.current);
          return;
        }
        setWordIndex(idx);
      }, 220);

      // TTS narration
      if (ttsEnabled) {
        ttsAbortRef.current = new AbortController();
        apiRequest("POST", "/api/voice-insight", { text: step.narration })
          .then((res) => res.json())
          .then((data) => {
            if (data?.audioUrl) {
              const audio = new Audio(data.audioUrl);
              audio.play().catch(() => {});
            }
          })
          .catch(() => {});
      }
    }, 700);

    return () => {
      if (wordTimerRef.current) clearInterval(wordTimerRef.current);
      if (targetTimerRef.current) clearTimeout(targetTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) setCurrentStep((s) => s + 1);
    else onComplete();
  }, [currentStep, totalSteps, onComplete]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  }, [currentStep]);

  // ── Keyboard shortcut ───────────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") { e.preventDefault(); onComplete(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev, onComplete]);

  // ── Dialog positioning: avoid covering the spotlight ───────────────────────
  const dialogStyle: React.CSSProperties = (() => {
    if (!spotlightRect) return { bottom: 32, left: "50%", transform: "translateX(-50%)" };
    const spBottom = spotlightRect.top + spotlightRect.height;
    const spTop = spotlightRect.top;
    const spRight = spotlightRect.left + spotlightRect.width;
    const winH = window.innerHeight;
    const winW = window.innerWidth;
    const dlgH = 240;
    const dlgW = Math.min(480, winW - 32);

    if (spBottom < winH - dlgH - 40) {
      // Place below spotlight
      return { top: spBottom + 20, left: Math.max(16, Math.min(winW - dlgW - 16, spotlightRect.left)), width: dlgW };
    }
    if (spTop > dlgH + 40) {
      // Place above spotlight
      return { bottom: winH - spTop + 20, left: Math.max(16, Math.min(winW - dlgW - 16, spotlightRect.left)), width: dlgW };
    }
    if (spRight < winW - dlgW - 40) {
      // Place to the right
      return { top: Math.max(16, spTop), left: spRight + 20, width: dlgW };
    }
    // Fallback: bottom center
    return { bottom: 24, left: "50%", transform: "translateX(-50%)", width: dlgW };
  })();

  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <>
      {/* ── Dark overlay ─────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-[9980] pointer-events-none"
        style={{ background: "rgba(0,0,0,0.62)" }}
        aria-hidden
      />

      {/* ── Spotlight hole ────────────────────────────────────────────────────── */}
      {spotlightRect && !isNavigating && (
        <div
          className="fixed z-[9981] pointer-events-none transition-all duration-500"
          style={{
            top: spotlightRect.top,
            left: spotlightRect.left,
            width: spotlightRect.width,
            height: spotlightRect.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
            borderRadius: 10,
            border: "2px solid hsl(var(--primary) / 0.7)",
            outline: "4px solid hsl(var(--primary) / 0.18)",
          }}
          aria-hidden
        />
      )}

      {/* ── Animated cursor ──────────────────────────────────────────────────── */}
      {!isNavigating && (
        <div
          className="fixed z-[9990] pointer-events-none"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            transition: "left 0.9s cubic-bezier(0.4,0,0.2,1), top 0.9s cubic-bezier(0.4,0,0.2,1)",
            transform: "translate(-4px, -4px)",
          }}
          aria-hidden
        >
          {/* Cursor ripple */}
          <span className="absolute -inset-3 rounded-full bg-primary/20 animate-ping pointer-events-none" />
          <CursorIcon />
        </div>
      )}

      {/* ── Tutorial dialog ───────────────────────────────────────────────────── */}
      <div
        className="fixed z-[9995] bg-card/98 backdrop-blur-sm border border-border rounded-2xl shadow-2xl flex flex-col"
        style={{ ...dialogStyle, maxWidth: 480, minWidth: 300 }}
        role="dialog"
        aria-label="Tutorial"
      >
        {/* Progress bar */}
        <div className="h-1 w-full bg-muted rounded-t-2xl overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-t-2xl"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {currentStep + 1} / {totalSteps}
            </span>
            <span className="text-[13px] font-semibold text-foreground truncate">{step.title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTtsEnabled((v) => !v)}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
              title={ttsEnabled ? "Mute narration" : "Unmute narration"}
            >
              {ttsEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onComplete}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Close tutorial (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Narration with word-by-word highlight */}
        <div className="px-4 py-2 text-[13px] leading-relaxed text-foreground/90 min-h-[72px]">
          {words.map((word, i) => (
            <span
              key={i}
              className={cn(
                "transition-all duration-100 inline",
                i <= wordIndex
                  ? "text-foreground font-medium"
                  : "text-muted-foreground/50"
              )}
            >
              {word}{" "}
            </span>
          ))}
        </div>

        {/* Footer: navigation */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-1 border-t border-border">
          <button
            onClick={onComplete}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors mr-auto flex items-center gap-1"
          >
            <SkipForward className="h-3 w-3" />
            Skip tutorial
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={goPrev}
            disabled={currentStep === 0}
            className="h-8 px-3 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <Button
            size="sm"
            onClick={goNext}
            className="h-8 px-4 text-xs"
          >
            {currentStep === totalSteps - 1 ? "Finish" : "Next"}
            {currentStep < totalSteps - 1 && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
          </Button>
        </div>
      </div>
    </>
  );
}
