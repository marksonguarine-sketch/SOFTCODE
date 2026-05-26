import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  HelpCircle,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  Mail,
  CheckCircle,
  Clock,
  Keyboard,
  BookOpen,
  Zap,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  BarChart3,
  Settings,
  TrendingUp,
  CreditCard,
  FileText,
  Wrench,
  Lightbulb,
  Star,
  UserCheck,
  CalendarDays,
  ClipboardList,
  ScrollText,
  Calculator,
  Reply,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const feedbackSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(10, "Message must be at least 10 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});
type FeedbackInput = z.infer<typeof feedbackSchema>;

const messageSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(5, "Message must be at least 5 characters"),
});
type MessageInput = z.infer<typeof messageSchema>;

// ─── MODULE GUIDE DATA ────────────────────────────────────────────────────────

const MODULES = [
  {
    icon: LayoutDashboard,
    name: "Dashboard",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    summary: "Live store overview — revenue, orders, active staff, and real-time activity feed.",
    tips: [
      "Click 'Export PDF' to download a full dashboard summary report.",
      "The daily sales goal ring updates live as orders are paid.",
      "Click the overdue banner to jump directly to unpaid orders.",
    ],
  },
  {
    icon: ShoppingCart,
    name: "Orders",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    summary: "Create walk-in, delivery, or reservation orders. Manage the order pool and staff assignments.",
    tips: [
      "Use the Pool tab to assign unassigned orders to employees.",
      "Orders move through: Pending Payment → Paid → Pending Release → Completed.",
      "Employees only see orders assigned to them.",
      "Admin can cancel orders and see full status history.",
    ],
  },
  {
    icon: Package,
    name: "Inventory",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    summary: "Track all SKUs, adjust stock, and monitor reorder alerts.",
    tips: [
      "Items flagged Critical (≤ reorder threshold) appear in the top alert strip.",
      "Click Adjust to restock, write-off, or log a manual correction.",
      "Total Stocks count updates in real time as orders are released.",
      "Use the barcode field to enable scanner lookup at checkout.",
    ],
  },
  {
    icon: Users,
    name: "Users",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    summary: "Manage staff accounts, roles, and shift activity.",
    tips: [
      "A green dot next to a user means they were active in the last 5 minutes.",
      "Deactivating a user prevents login without deleting their history.",
      "Admins can reset passwords and change roles at any time.",
    ],
  },
  {
    icon: BarChart3,
    name: "Reports",
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    summary: "Sales, inventory, and payment reports with date filters and CSV/PDF export.",
    tips: [
      "Use the Date Range presets (7d, 30d, YTD) to quickly scope reports.",
      "Download CSV for Excel-compatible exports.",
      "Payment mix pie chart shows the split between cash, GCash, and other methods.",
    ],
  },
  {
    icon: TrendingUp,
    name: "Forecasting",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    summary: "ARIMA(1,1,1) demand forecast for orders and revenue over 7–30 day horizons.",
    tips: [
      "Switch between 7-, 14-, and 30-day horizons using the buttons in the header.",
      "The shaded band shows the 95% confidence interval around each forecast.",
      "Per-item urgency colours: red = reorder now, amber = reorder soon.",
      "Export to PDF for a printable forecast with per-item reorder recommendations.",
    ],
  },
  {
    icon: CreditCard,
    name: "Accounting",
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    summary: "Double-entry general ledger, chart of accounts, and financial summaries.",
    tips: [
      "Payments automatically post to Cash and Sales Revenue accounts.",
      "Use Journal Entry to post custom debits/credits for expenses or corrections.",
      "The Summary tab shows net balance per account (debit − credit).",
    ],
  },
  {
    icon: FileText,
    name: "Billing",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    summary: "View all payment records, filter by date, method, and reference number.",
    tips: [
      "Search by GCash reference number, tracking number, or customer name.",
      "Click a payment row to jump to the order detail.",
      "Receipts can be printed from the order detail page.",
    ],
  },
  {
    icon: UserCheck,
    name: "Employees",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    summary: "View employee profiles, KPIs, activity timelines, and export employee PDFs.",
    tips: [
      "Click any employee card to open their full profile with performance metrics.",
      "The green dot indicates an active (enabled) account; gray means deactivated.",
      "Export a per-employee PDF for payroll or performance review records.",
      "KPI charts show orders created, revenue generated, and shift activity.",
    ],
  },
  {
    icon: CalendarDays,
    name: "Reservations",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    summary: "Book and manage customer reservations with scheduled pickup or delivery dates.",
    tips: [
      "Reservations are linked to orders — mark them fulfilled when the customer arrives.",
      "Use the calendar view to spot scheduling conflicts.",
      "Employees receive a notification when a reservation is assigned to them.",
    ],
  },
  {
    icon: ClipboardList,
    name: "Requests",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    summary: "Employees submit inventory requests, order transfers, and leave requests here.",
    tips: [
      "Pending requests show a badge count in the sidebar navigation.",
      "Accept or decline from the request detail view — the employee is notified instantly.",
      "Order transfer requests let an employee hand off an order to another staff member.",
      "Leave requests are stored and can be referenced for payroll purposes.",
    ],
  },
  {
    icon: ScrollText,
    name: "System Logs",
    color: "text-gray-500",
    bg: "bg-gray-500/10",
    summary: "Full audit trail of every action taken in the system with actor and timestamp.",
    tips: [
      "Search logs by actor, action type, or keyword to investigate incidents.",
      "Click any log entry to see the full payload and context.",
      "Logs are immutable — they cannot be deleted or edited.",
      "Use date filters to narrow down events to a specific shift or day.",
    ],
  },
  {
    icon: Calculator,
    name: "Floating Calculator",
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    summary: "A Casio-style floating calculator fixed at the bottom-right of every page, with memory keys.",
    tips: [
      "Toggle the calculator on or off in Settings — preference saved per user account.",
      "The calculator is fixed at the bottom-right corner and always stays in place.",
      "Memory keys: MC (clear), MR (recall), M+ (add to memory), M- (subtract from memory).",
      "Full keyboard support: type numbers and operators directly when the calc is open.",
    ],
  },
  {
    icon: Settings,
    name: "Settings",
    color: "text-slate-500",
    bg: "bg-slate-500/10",
    summary: "Company info, thresholds, fonts, gradients, TTS, calculator, and appearance tweaks.",
    tips: [
      "Density, Accent Color, and Font are saved per device — changes apply instantly.",
      "Daily Sales Goal sets the target on the dashboard ring for all users.",
      "Reorder Threshold controls when items show as Critical in inventory.",
      "Gradient and font changes apply across the entire sidebar immediately.",
    ],
  },
  {
    icon: Wrench,
    name: "Maintenance",
    color: "text-yellow-600",
    bg: "bg-yellow-500/10",
    summary: "Backup, restore, and system health tools. Admin only.",
    tips: [
      "Create a full backup before any major data change.",
      "Restore replaces all current data — use with caution.",
      "System health shows MongoDB connection and memory usage.",
      "Schedule automatic backups to run at a fixed time every day.",
    ],
  },
];

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ["0–9", ".", "±", "%"], action: "Type into calculator (when open)" },
  { keys: ["Backspace"], action: "Delete last calculator digit" },
  { keys: ["Enter", "="], action: "Calculate result" },
  { keys: ["Esc"], action: "Close calculator" },
  { keys: ["C"], action: "Clear calculator (AC)" },
  { keys: ["+ / - / * / /"], action: "Arithmetic operators" },
];

// ─── FAQ DATA ─────────────────────────────────────────────────────────────────

const faqs = [
  {
    question: "How do I create a new order?",
    answer: "Navigate to the Orders page and click the 'Create Order' button. Select a customer, add items, choose the source channel, and submit.",
  },
  {
    question: "How do I restock inventory?",
    answer: "Go to the Inventory page and click the 'Adjust' button next to the item. Select 'Restock', enter the quantity, and submit. The adjustment is logged with your username and a timestamp.",
  },
  {
    question: "How do I log a payment?",
    answer: "Open the order detail page for an order with 'Pending Payment' status. Fill in the payment method, reference number (for GCash), and amount, then submit the payment form.",
  },
  {
    question: "How do I release items for an order?",
    answer: "Open the order detail page for an order with 'Pending Release' status and click the 'Release Items' button. This marks the order as Completed and deducts stock automatically.",
  },
  {
    question: "How do I export data?",
    answer: "Use the Reports page for CSV/PDF exports. The Dashboard and Forecasting pages also have their own Export PDF buttons in the header. Each export is timestamped and includes all filtered data.",
  },
  {
    question: "How do I manage users?",
    answer: "Admin users can navigate to the Users page to create, activate/deactivate, and change roles for staff accounts.",
  },
  {
    question: "How do I adjust item prices?",
    answer: "Go to the Inventory page, find the item, and click the 'Edit' or 'Edit Price' button. Enter the new unit price and confirm. Changes are logged for auditing.",
  },
  {
    question: "How do I view order history?",
    answer: "The Orders page shows all orders with filters for status, date, and search. Click any row to open the full order detail, which includes a complete status timeline.",
  },
  {
    question: "How do I use the billing search?",
    answer: "On the Billing page, search by GCash reference number, tracking number, or customer name. Use the date range filter to narrow results by payment date.",
  },
  {
    question: "What happens when stock is critical?",
    answer: "When an item's quantity falls at or below the reorder threshold (configurable in Settings), it shows a red 'Critical' badge on the Dashboard and Inventory page.",
  },
  {
    question: "How do I create a backup?",
    answer: "Go to the Maintenance page (Admin only) and click 'Create Backup'. This exports all system data as a downloadable JSON file.",
  },
  {
    question: "What are the different order statuses?",
    answer: "Orders flow through: Pending Payment → Paid → Pending Release → Completed. Orders can also be Cancelled at any point by an admin. Each transition is timestamped.",
  },
  {
    question: "How do I use the accounting module?",
    answer: "The Accounting page lets you manage a chart of accounts and record double-entry journal entries. Payments automatically post entries to Cash and Sales Revenue. You can also post custom debits/credits for expenses.",
  },
  {
    question: "How do I use the Forecasting module?",
    answer: "The Forecasting page uses ARIMA(1,1,1) to predict future order volume and revenue. Select a horizon (7, 14, or 30 days) and view the forecast chart with 95% confidence bands. The per-item table shows reorder urgency.",
  },
  {
    question: "How do I change the interface appearance?",
    answer: "Go to Settings → Appearance Tweaks at the bottom. Change the density (Compact / Balanced / Comfortable), and pick an accent color. Changes apply instantly and are saved only to your device — other users are not affected.",
  },
  {
    question: "How do I handle refunds?",
    answer: "Cancel the order and create an inventory adjustment to restock the returned items. Log a note in the order detail explaining the refund reason for audit purposes.",
  },
  {
    question: "How do I contact the admin?",
    answer: "Employees can use the 'Send Message to Admin' form on this Help page. The admin will see your message in their Employee Messages section.",
  },
  {
    question: "How do I submit a leave request?",
    answer: "Go to your Profile page and scroll to the Leave Requests section. Fill in the start and end date, add a reason, and submit. The admin will see it under the Requests page and approve or decline.",
  },
  {
    question: "How do employee requests work?",
    answer: "Employees can submit three types of requests: (1) Inventory Item Request — ask for a new item to be added to inventory; (2) Order Transfer — hand an order off to another employee; (3) Leave Request — filed from the Profile page. All requests appear on the admin Requests page with full details.",
  },
  {
    question: "How do I view the activity on the Dashboard?",
    answer: "The Dashboard has a real-time Activity Feed on the right side. It shows the latest order, payment, and inventory events as they happen. It auto-refreshes every 30 seconds.",
  },
  {
    question: "How do I see who is currently on shift?",
    answer: "The Dashboard 'On Shift Now' section shows all employees with an active shift. A green animated dot next to their name means they are currently logged in and active.",
  },
  {
    question: "What is the Pending Payment page?",
    answer: "The Pending Payment page (accessible from the sidebar) lists every order that has been created but not yet paid. It shows the tracking number, customer, type, amount, and date. Click any row to jump to the order detail and log the payment.",
  },
  {
    question: "How do I use the floating calculator?",
    answer: "Click the calculator button fixed at the bottom-right corner of any page. The calculator supports all basic arithmetic, memory keys (MC, MR, M+, M-), and full keyboard input — just open it and start typing. Toggle it on or off from Settings. Press Esc to close it.",
  },
  {
    question: "How do I view employee performance?",
    answer: "Go to the Employees page and click on any employee card. This opens a profile modal with KPI metrics (orders created, revenue generated), productivity charts, recent orders, and an activity timeline. You can also export a PDF summary.",
  },
  {
    question: "How do I view the system audit trail?",
    answer: "Go to System Logs (admin only). Every action — orders, payments, inventory changes, user updates — is recorded with the actor's username and a timestamp. You can search by keyword, filter by action type, and click any entry for full details.",
  },
  {
    question: "How do orders get assigned to employees?",
    answer: "When an order is created without an assigned employee, it goes into the Pool. Admins see all pool orders and can click the 'Assign to…' button to assign the order to any staff member. The assigned employee then sees the order on their Orders page.",
  },
  {
    question: "How do I reset an employee's password?",
    answer: "Go to the Users page (admin only), find the employee, and click the actions menu on their row. Select 'Reset Password'. You can set a new temporary password for them.",
  },
  {
    question: "What happens to stock when an order is released?",
    answer: "When you click 'Release Items' on an order in Pending Release status, the system automatically deducts the ordered quantities from inventory. The stock count updates in real time and an inventory adjustment log entry is created.",
  },
  {
    question: "How do I handle partial payments?",
    answer: "On the order detail page, you can log multiple payments. Each payment is recorded with its own method, reference number, and amount. The remaining balance updates automatically after each payment entry.",
  },
  {
    question: "How does the forecasting model work?",
    answer: "The Forecasting module uses ARIMA(1,1,1) — a statistical time series model — on the last 60 days of order history to predict future demand. It outputs daily forecast values with 95% confidence intervals for both order count and revenue.",
  },
  {
    question: "How do I change the daily sales goal?",
    answer: "Go to Settings and find the 'Daily Sales Goal' field. Enter the target revenue amount and save. This value is displayed as a progress ring on the Dashboard for all users.",
  },
  {
    question: "How do I search the system logs?",
    answer: "On the System Logs page, use the search box to filter by keyword (e.g. username, action type, or item name). You can also filter by date range and action category to narrow down the audit trail.",
  },
  {
    question: "How do I process a GCash payment?",
    answer: "On the order detail page, select 'GCash' as the payment method. A reference number field will appear — enter the 13-digit GCash reference number from the customer's transaction screenshot. Enter the amount paid and submit. The payment is recorded with the reference number for reconciliation.",
  },
  {
    question: "How do I cancel an order?",
    answer: "Only admin users can cancel orders. Open the order detail page and click the 'Cancel Order' button. You will be prompted for a cancellation reason. Cancelled orders are logged and removed from the active queue, but their history remains visible in the Orders page under the 'Cancelled' filter.",
  },
  {
    question: "What does 'Dead Stock' mean?",
    answer: "Dead Stock refers to items that have had zero sales movement in an extended period (typically 90+ days). These items tie up capital without generating revenue. The Dashboard KPI strip shows the dead stock count so you can take action — consider running a promotion or returning them to the supplier.",
  },
  {
    question: "How does the reorder threshold work?",
    answer: "The reorder threshold is set per item in the Inventory page. When an item's current quantity falls at or below its threshold, it is flagged as 'Critical' and appears in the red alert strip on the Dashboard and the Inventory KPI. The Forecasting page also highlights these items with a red urgency color.",
  },
  {
    question: "How do I use TTS voice insights on the dashboard?",
    answer: "Double-click any KPI card on the Dashboard (such as Revenue Today or Orders Today) to trigger an AI voice insight. The system will speak an analysis of that metric using the built-in TTS engine. You can enable or disable TTS narration from the Settings page.",
  },
  {
    question: "How do I view per-employee revenue?",
    answer: "Go to the Employees page and click on any employee card. Their profile modal shows KPI charts with total revenue generated, orders created, and average order value for their account. You can export this as a PDF for performance review or payroll documentation.",
  },
  {
    question: "Why does the Forecasting chart show no data?",
    answer: "The ARIMA forecasting model requires at least a few days of historical order data to generate predictions. If you have fewer than 5 data points in the selected lookback period, the chart may show empty or flat lines. Create some orders and wait for data to accumulate for accurate forecasts.",
  },
  {
    question: "How do I add a new account type to Accounting?",
    answer: "On the Accounting page, click the 'Add Account' button at the top of the Chart of Accounts panel. Enter the account name, type (Asset, Liability, Equity, Revenue, or Expense), and account code. New accounts can then be selected when posting manual journal entries.",
  },
  {
    question: "How do I print an order receipt?",
    answer: "Open the order detail page and look for the print or receipt button. This generates a formatted receipt with the order tracking number, items, amounts, payment details, and store contact information. The receipt can be printed directly or saved as a PDF.",
  },
  {
    question: "What is the Order Pool?",
    answer: "The Order Pool is the tab in Orders that shows all unassigned orders — orders that were created but not yet assigned to any employee. Admin users can view the Pool and click 'Assign to…' to delegate each order to a staff member. Once assigned, the order disappears from the Pool and appears on the employee's order list.",
  },
  {
    question: "How do I transfer an order to another employee?",
    answer: "As an employee, go to the Requests page and submit a Transfer Order request. Select the order tracking number and the target employee username. Your admin will see the request, review it, and either accept (which moves the order) or decline it. The process is audited and both employees are notified.",
  },
  {
    question: "How do I create a reservation?",
    answer: "Go to the Reservations page and click 'New Reservation'. Fill in the customer name, phone number, scheduled date and time, sales channel, and add items. You can set a fulfillment status and assign it to an employee. The reservation auto-links to an order when fulfilled so payment can be processed.",
  },
  {
    question: "How does stock deduction work?",
    answer: "Stock is NOT deducted when an order is created or paid. Stock is only deducted when you click 'Release Items' on an order in 'Pending Release' status. This ensures physical items match the system count — you only deduct stock when items physically leave the store.",
  },
  {
    question: "How do I set up offers or discounts?",
    answer: "Go to the Offers & Promotions page and click 'Create Offer'. Choose the offer type (percentage discount, fixed amount, or BOGO), set the discount value, select eligible items, and set start and end dates. Enable the offer with the Active toggle. If 'Auto-Apply Offers' is on in Settings, it will automatically apply to matching new orders.",
  },
  {
    question: "What is the difference between admin and employee roles?",
    answer: "Admins have full access to all modules including Users, System Logs, Maintenance, Requests, Accounting, Forecasting, and all Settings. Employees can access Orders (their own), Inventory, Billing, Reservations, Requests (to submit), Profile, and Help. Employees cannot see other users' data or perform admin actions.",
  },
  {
    question: "How do I update my profile photo?",
    answer: "Go to your Profile page and click the camera icon on your avatar. Select an image file from your device. The photo is saved and displayed in your employee card in the directory, visible to the admin and in the Employees page.",
  },
  {
    question: "How do I know if an order is overdue for payment?",
    answer: "The Dashboard shows an 'Overdue Payments' banner when there are orders that have been in 'Pending Payment' status for more than 24 hours. Click the banner to go directly to the Pending Payment page. The sidebar badge also shows a live count of all unpaid orders.",
  },
  {
    question: "Can I restore a deleted item?",
    answer: "Deleted inventory items cannot be automatically restored, but if you have a system backup, you can restore the full database from the Maintenance page. Alternatively, you can create a new item with the same details. All deletion events are recorded in System Logs for reference.",
  },
  {
    question: "How do I schedule an automatic backup?",
    answer: "On the Maintenance page (admin only), look for the 'Schedule Backup' section. Set the time you want the backup to run daily and enable the schedule. The system will automatically export a full data backup at that time every day.",
  },
  {
    question: "How do I filter the Activity Feed on the Dashboard?",
    answer: "The Activity Feed on the Dashboard automatically shows the most recent store events. Scroll down to see older entries. The feed updates in real time as new orders, payments, and inventory events happen. There is no manual filter — all recent events are shown in chronological order.",
  },
  {
    question: "What happens if I accidentally mark an order as Released?",
    answer: "Releasing an order deducts stock and marks it Completed — this is a final step. Contact your admin to cancel the order if it was a mistake and then create a new order. The admin can also post a manual inventory adjustment to correct the stock count, and log a journal entry to correct the accounting.",
  },
  {
    question: "How do I see which items are low in stock right now?",
    answer: "The Dashboard KPI strip shows a 'Low Stock' count with a red badge. Click it to jump to the Inventory page filtered to show only Critical items. You can also check the Forecasting page's per-item table — items with 'CRITICAL' urgency need to be reordered immediately.",
  },
  {
    question: "How is revenue calculated in the Accounting module?",
    answer: "Revenue is posted to the Sales Revenue account automatically when an order payment is logged. Cash is posted to the Cash (or GCash) asset account. The General Ledger tab shows all entries. The Summary tab shows the net balance per account. Totals update in real time as payments are processed.",
  },
];

// ─── TIPS ─────────────────────────────────────────────────────────────────────

const QUICK_TIPS = [
  { icon: Zap, tip: "The floating calculator supports full keyboard input — just open it and start typing numbers.", },
  { icon: Star, tip: "The Activity Feed on the Dashboard updates in real time as orders are created, paid, and released.", },
  { icon: Lightbulb, tip: "Use the 30-day forecast horizon to plan weekly purchasing runs before stock runs out.", },
  { icon: Zap, tip: "Employees can only see orders assigned to them — use the Admin Pool view to manage assignments.", },
  { icon: Star, tip: "The Daily Sales Goal ring on the Dashboard turns green when the revenue target is met.", },
  { icon: Lightbulb, tip: "Appearance Tweaks (density, accent color, font) persist per device with no save button needed.", },
  { icon: Zap, tip: "Use Export PDF on the Forecasting page to create printable reorder lists for suppliers.", },
  { icon: Star, tip: "All inventory adjustments are logged with actor, timestamp, and reason for full auditability.", },
  { icon: Lightbulb, tip: "Double-click any chart card on the Dashboard to get an AI voice insight about that data.", },
  { icon: Zap, tip: "The Billing page search supports GCash reference numbers, tracking numbers, and customer names.", },
  { icon: Star, tip: "System Logs capture every login, order change, and inventory update — nothing is ever hidden.", },
  { icon: Lightbulb, tip: "Employee requests (inventory, transfer, leave) show a live badge count in the sidebar nav.", },
  { icon: Zap, tip: "Reservations can be linked to existing orders to track scheduled pickup or delivery dates.", },
  { icon: Star, tip: "The per-item urgency colors in Forecasting help you prioritize which items to reorder first.", },
  { icon: Lightbulb, tip: "Export the Accounting PDF to get a full ledger report with pie charts and KPI summaries.", },
  { icon: Zap, tip: "Admin can reply to employee messages directly from the Help page's Support tab.", },
];

export default function HelpPage() {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [faqSearch, setFaqSearch] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [replyText, setReplyText] = useState("");

  const form = useForm<FeedbackInput>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: { subject: "", message: "", email: "" },
  });

  const messageForm = useForm<MessageInput>({
    resolver: zodResolver(messageSchema),
    defaultValues: { subject: "", message: "" },
  });

  const feedbackMutation = useMutation({
    mutationFn: async (data: FeedbackInput) => {
      const res = await apiRequest("POST", "/api/feedback", data);
      return res.json();
    },
    onSuccess: () => {
      form.reset();
      toast({ title: "Feedback submitted", description: "Thank you for your feedback." });
    },
    onError: (err: Error) => toast({ title: "Failed to submit feedback", description: err.message, variant: "destructive" }),
  });

  const messageMutation = useMutation({
    mutationFn: async (data: MessageInput) => {
      const res = await apiRequest("POST", "/api/messages", {
        toUsername: "admin",
        subject: data.subject,
        body: data.message,
      });
      return res.json();
    },
    onSuccess: () => {
      messageForm.reset();
      toast({ title: "Message sent", description: "Your message has been sent to the admin." });
    },
    onError: (err: Error) => toast({ title: "Failed to send message", description: err.message, variant: "destructive" }),
  });

  const messagesQuery = useQuery<any>({
    queryKey: ["/api/messages"],
    enabled: isAdmin,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/messages/${id}/read`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/messages"] }); },
    onError: (err: Error) => toast({ title: "Failed to mark as read", description: err.message, variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async ({ toUsername, body }: { toUsername: string; body: string }) => {
      const res = await apiRequest("POST", "/api/messages", {
        toUsername,
        subject: "Re: Admin Reply",
        body,
      });
      return res.json();
    },
    onSuccess: () => {
      setReplyTo(null);
      setReplyText("");
      toast({ title: "Reply sent", description: "Your reply has been sent to the employee." });
    },
    onError: (err: Error) => toast({ title: "Failed to send reply", description: err.message, variant: "destructive" }),
  });

  const messages = messagesQuery.data?.data || [];
  const isEmployee = user?.role === "EMPLOYEE";

  const filteredFaqs = faqSearch.trim()
    ? faqs.filter((f) =>
        f.question.toLowerCase().includes(faqSearch.toLowerCase()) ||
        f.answer.toLowerCase().includes(faqSearch.toLowerCase())
      )
    : faqs;

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="page-help">
      <div className="shrink-0 px-3 sm:px-6 pt-3 sm:pt-6 pb-4">
      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl grid place-items-center shrink-0 shadow-md ring-1 ring-primary/20"
          style={{ background: "linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 42%))" }}
        >
          <HelpCircle className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold leading-tight" data-testid="text-help-title">
            Help & Support
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Guides, shortcuts, FAQs and direct support for JOAP Hardware ERP.
          </p>
        </div>
      </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-6 pb-3">
      {/* ── TABS ──────────────────────────────────────────────────────── */}
      <Tabs defaultValue="modules" className="flex-1 min-h-0 flex flex-col w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 mb-0 shrink-0 pb-3">
          <TabsTrigger value="modules" className="text-xs"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Module Guide</TabsTrigger>
          <TabsTrigger value="shortcuts" className="text-xs"><Keyboard className="h-3.5 w-3.5 mr-1.5" />Shortcuts</TabsTrigger>
          <TabsTrigger value="tips" className="text-xs"><Lightbulb className="h-3.5 w-3.5 mr-1.5" />Tips</TabsTrigger>
          <TabsTrigger value="faq" className="text-xs"><HelpCircle className="h-3.5 w-3.5 mr-1.5" />FAQs</TabsTrigger>
          <TabsTrigger value="support" className="text-xs"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />Support</TabsTrigger>
        </TabsList>
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {/* MODULE GUIDE */}
        <TabsContent value="modules" className="space-y-4 mt-3">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <Card key={mod.name} className="hover:shadow-md transition-shadow" data-testid={`card-module-${mod.name.toLowerCase()}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${mod.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${mod.color}`} />
                      </span>
                      {mod.name}
                    </CardTitle>
                    <CardDescription className="text-xs">{mod.summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {mod.tips.map((tip, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                          <span className={`shrink-0 mt-0.5 font-bold ${mod.color}`}>›</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* KEYBOARD SHORTCUTS */}
        <TabsContent value="shortcuts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Keyboard className="h-4 w-4" /> Keyboard Shortcuts
              </CardTitle>
              <CardDescription>
                The floating calculator supports full keyboard input. Open it by clicking the calculator button (bottom-right), then use your keyboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Keys</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {SHORTCUTS.map((s, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {s.keys.map((k) => (
                              <kbd key={k} className="inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-muted border border-border rounded shadow-sm">
                                {k}
                              </kbd>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 p-3 rounded-md bg-primary/5 border border-primary/20">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Note:</span>{" "}
                  Keyboard shortcuts only activate when the calculator is open and you are not focused on a text input field.
                  Press <kbd className="inline-flex items-center px-1 py-0.5 text-[10px] font-mono bg-muted border rounded">Esc</kbd> to close the calculator at any time.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TIPS */}
        <TabsContent value="tips">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {QUICK_TIPS.map((t, i) => {
              const Icon = t.icon;
              const colors = ["text-amber-500 bg-amber-500/10", "text-blue-500 bg-blue-500/10", "text-emerald-500 bg-emerald-500/10", "text-purple-500 bg-purple-500/10"];
              const c = colors[i % colors.length].split(" ");
              return (
                <div key={i} className="flex gap-3 p-3.5 rounded-xl border bg-card hover:shadow-sm transition-shadow" data-testid={`tip-${i}`}>
                  <span className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg ${c[1]}`}>
                    <Icon className={`h-4 w-4 ${c[0]}`} />
                  </span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t.tip}</p>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* FAQ */}
        <TabsContent value="faq" className="space-y-4">
          <div className="relative">
            <HelpCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search FAQs…"
              value={faqSearch}
              onChange={(e) => { setFaqSearch(e.target.value); setExpandedFaq(null); }}
              data-testid="input-faq-search"
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 justify-between">
                <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4" /> Frequently Asked Questions</span>
                <Badge variant="secondary" className="text-xs">{filteredFaqs.length} answers</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filteredFaqs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No matching FAQs.</p>
              ) : filteredFaqs.map((faq, index) => (
                <div key={index} className="border rounded-lg overflow-hidden">
                  <button
                    className="flex items-center justify-between gap-2 w-full p-3.5 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
                    onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                    data-testid={`button-faq-${index}`}
                  >
                    <span>{faq.question}</span>
                    {expandedFaq === index ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {expandedFaq === index && (
                    <div className="px-4 pb-4 pt-0 text-sm text-muted-foreground leading-relaxed border-t bg-muted/20">
                      <div className="pt-3">{faq.answer}</div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SUPPORT */}
        <TabsContent value="support" className="space-y-4">
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <div className="space-y-4">

              {/* Feedback form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> Send Feedback
                  </CardTitle>
                  <CardDescription>Have a question or suggestion? Let us know.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit((data) => feedbackMutation.mutate(data))} className="space-y-4">
                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email (optional)</FormLabel>
                          <FormControl><Input type="email" placeholder="your@email.com" {...field} data-testid="input-feedback-email" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="subject" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subject</FormLabel>
                          <FormControl><Input placeholder="Brief description of your feedback" {...field} data-testid="input-feedback-subject" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="message" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Message</FormLabel>
                          <FormControl><Textarea placeholder="Describe your feedback in detail…" {...field} className="min-h-[120px]" data-testid="input-feedback-message" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" disabled={feedbackMutation.isPending} data-testid="button-submit-feedback">
                        {feedbackMutation.isPending ? <Loader2 className="animate-spin mr-1.5 h-4 w-4" /> : <Send className="mr-1.5 h-4 w-4" />}
                        Submit Feedback
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* Employee → Admin message */}
              {isEmployee && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4" /> Send Message to Admin
                    </CardTitle>
                    <CardDescription>Send a direct internal message to the admin team.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...messageForm}>
                      <form onSubmit={messageForm.handleSubmit((data) => messageMutation.mutate(data))} className="space-y-4">
                        <FormField control={messageForm.control} name="subject" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subject</FormLabel>
                            <FormControl><Input placeholder="e.g. Low stock on Item X" {...field} data-testid="input-message-subject" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={messageForm.control} name="message" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Message</FormLabel>
                            <FormControl><Textarea placeholder="Your message…" {...field} className="min-h-[100px]" data-testid="input-message-body" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <Button type="submit" disabled={messageMutation.isPending} data-testid="button-send-message">
                          {messageMutation.isPending ? <Loader2 className="animate-spin mr-1.5 h-4 w-4" /> : <Send className="mr-1.5 h-4 w-4" />}
                          Send Message
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              {/* Inbox from Admin (employee only) */}
              {isEmployee && <InboxFromAdmin />}

              {/* Admin — Employee messages inbox */}
              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4" /> Employee Messages
                      {messages.filter((m: any) => !m.metadata?.read).length > 0 && (
                        <Badge className="bg-blue-500 text-white border-transparent text-xs">
                          {messages.filter((m: any) => !m.metadata?.read).length} new
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>Messages from staff members. Click Reply to respond directly.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {messagesQuery.isLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No messages yet.</p>
                    ) : (
                      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                        {messages.map((msg: any) => (
                          <div key={msg._id} className={`border rounded-lg p-3.5 space-y-2 transition-colors ${!msg.metadata?.read ? "border-primary/30 bg-primary/5" : ""}`}>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold" data-testid={`text-msg-sender-${msg._id}`}>{msg.actor}</span>
                                {msg.metadata?.subject && (
                                  <Badge variant="outline" className="text-xs">{msg.metadata.subject}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  {new Date(msg.createdAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {!msg.metadata?.read && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs px-2"
                                    onClick={() => markReadMutation.mutate(msg._id)}
                                    disabled={markReadMutation.isPending}
                                    data-testid={`button-mark-read-${msg._id}`}
                                  >
                                    <Clock className="h-3 w-3 mr-1" /> Mark Read
                                  </Button>
                                )}
                                {msg.metadata?.read && (
                                  <Badge variant="secondary" className="text-xs">
                                    <CheckCircle className="h-3 w-3 mr-1" /> Read
                                  </Badge>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs px-2 text-blue-600 hover:text-blue-700"
                                  onClick={() => {
                                    setReplyTo({ id: msg._id, username: msg.actor });
                                    setReplyText("");
                                  }}
                                  data-testid={`button-reply-${msg._id}`}
                                >
                                  <Reply className="h-3 w-3 mr-1" /> Reply
                                </Button>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-msg-body-${msg._id}`}>
                              {msg.metadata?.message}
                            </p>
                            {replyTo?.id === msg._id && (
                              <div className="mt-2 pt-2 border-t space-y-2">
                                <Textarea
                                  placeholder={`Reply to ${msg.actor}…`}
                                  className="min-h-[80px] text-sm"
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  data-testid={`input-reply-${msg._id}`}
                                />
                                <div className="flex gap-2 justify-end">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => { setReplyTo(null); setReplyText(""); }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={!replyText.trim() || replyMutation.isPending}
                                    onClick={() => replyMutation.mutate({ toUsername: msg.actor, body: replyText })}
                                    data-testid={`button-send-reply-${msg._id}`}
                                  >
                                    {replyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
                                    Send Reply
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* System info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4" /> System Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: "ERP Version", value: "v3.2" },
                    { label: "Stack", value: "Express · MongoDB · React · Socket.io" },
                    { label: "TTS Engine", value: "Microsoft Edge TTS · Guy (US Male)" },
                    { label: "Forecast Model", value: "ARIMA(1,1,1) · 60-day lookback" },
                    { label: "Branch", value: "JOAP Hardware Trading · Antipolo" },
                    { label: "Data Location", value: "MongoDB Atlas (Cloud)" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium font-mono text-xs">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        </div>
      </Tabs>
      </div>
    </div>
  );
}

function InboxFromAdmin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/messages"],
  });
  const messages = (data?.data || []).filter((m: any) => m.direction === "ADMIN_TO_EMPLOYEE");

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/messages/${id}/read`);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/messages"] }); },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || messages.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" /> Messages from Admin
          {messages.filter((m: any) => !m.isRead).length > 0 && (
            <Badge className="bg-blue-500 text-white border-transparent text-xs">
              {messages.filter((m: any) => !m.isRead).length} new
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Internal messages sent to you by the admin team.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
        {messages.map((msg: any) => (
          <div
            key={msg._id}
            className={`border rounded-lg p-3.5 space-y-1.5 cursor-pointer transition-colors ${msg.isRead ? "opacity-60" : "border-primary/40 bg-primary/5"}`}
            data-testid={`msg-from-admin-${msg._id}`}
            onClick={() => !msg.isRead && markReadMutation.mutate(msg._id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">From: {msg.fromUsername}</Badge>
                {msg.subject && <span className="text-xs font-medium">{msg.subject}</span>}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(msg.createdAt).toLocaleString("en-PH")}</span>
            </div>
            <p className="text-sm">{msg.body}</p>
            {!msg.isRead && <Badge className="text-[10px] bg-blue-500 text-white border-transparent">NEW</Badge>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
