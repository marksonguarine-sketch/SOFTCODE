import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users, Search, Mail, Phone, Calendar, Activity, Award, Briefcase,
  MessageSquare, Camera, Trash2, Download, ChevronRight, Loader2,
  ShoppingCart, CalendarCheck, Clock, FileText, UserCircle, X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as ChartTooltip, CartesianGrid } from "recharts";

interface EmployeeProfile {
  _id: string;
  username: string;
  employeeId: string;
  photoDataUrl?: string;
  email?: string;
  contactNumber?: string;
  hireDate?: string;
  lateCount: number;
  approvedLeaves: number;
  rejectedLeaves: number;
  adminRemarks?: string;
}

interface Employee {
  _id: string;
  username: string;
  role: string;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
  profile: EmployeeProfile | null;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
function fmtTime(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtPHP(v: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
}

function ProfileModal({ username, onClose }: { username: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [analyticsRange, setAnalyticsRange] = useState<"1d" | "3d" | "7d" | "1m">("7d");
  const [tab, setTab] = useState("overview");
  const [orderPage, setOrderPage] = useState(1);
  const [resPage, setResPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const PER_PAGE = 5;

  const { data: summary, isLoading } = useQuery<{ success: boolean; data: any }>({
    queryKey: [`/api/employee-profile/${username}/summary`],
    enabled: !!username,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/messages", {
        toUsername: username,
        subject: messageSubject,
        body: messageBody,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Message sent" });
      setMessageOpen(false);
      setMessageBody("");
      setMessageSubject("");
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updatePhotoMutation = useMutation({
    mutationFn: async (photoDataUrl: string | null) => {
      const res = await apiRequest("PATCH", `/api/employee-profile/${username}`, { photoDataUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employee-profile/${username}/summary`] });
      toast({ title: "Photo updated" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  if (!username) return null;

  const profile = summary?.data?.profile;
  const user = summary?.data?.user;
  const kpi = summary?.data?.kpi || {};
  const orders = summary?.data?.recentOrders || [];
  const reservations = summary?.data?.recentReservations || [];
  const logs = summary?.data?.recentLogs || [];
  const productivity = summary?.data?.productivityChart || [];

  const ordersTotal = Math.ceil(orders.length / PER_PAGE);
  const orderSlice = orders.slice((orderPage - 1) * PER_PAGE, orderPage * PER_PAGE);
  const resTotal = Math.ceil(reservations.length / PER_PAGE);
  const resSlice = reservations.slice((resPage - 1) * PER_PAGE, resPage * PER_PAGE);
  const logsTotal = Math.ceil(logs.length / PER_PAGE);
  const logSlice = logs.slice((logPage - 1) * PER_PAGE, logPage * PER_PAGE);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => updatePhotoMutation.mutate(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const exportPDF = async () => {
    const jsPDF = (await import("jspdf")).default;
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Employee Profile Report", 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, 14, 25);
    doc.setFontSize(12);
    doc.text(`Name: ${user?.username}`, 14, 35);
    doc.text(`Employee ID: ${profile?.employeeId || "—"}`, 14, 41);
    doc.text(`Email: ${profile?.email || "—"}`, 14, 47);
    doc.text(`Contact: ${profile?.contactNumber || "—"}`, 14, 53);
    doc.text(`Hire Date: ${fmtDate(profile?.hireDate)}`, 14, 59);

    doc.setFontSize(14);
    doc.text("Performance Summary", 14, 72);
    autoTable(doc, {
      startY: 76,
      head: [["Metric", "Value"]],
      body: [
        ["Completed Orders", String(kpi.completedOrders || 0)],
        ["Reservations (30d)", String(kpi.reservationsCreated30d || 0)],
        ["Pending Leaves", String(kpi.pendingLeaves || 0)],
        ["Late Count", String(profile?.lateCount || 0)],
        ["Approved Leaves", String(profile?.approvedLeaves || 0)],
        ["Rejected Leaves", String(profile?.rejectedLeaves || 0)],
      ],
    });

    if (orders.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text("Recent Orders", 14, 18);
      autoTable(doc, {
        startY: 22,
        head: [["Tracking #", "Customer", "Type", "Status", "Date"]],
        body: orders.slice(0, 30).map((o: any) => [
          o.trackingNumber, o.customerName, o.orderType, o.fulfillmentStatus, fmtDate(o.createdAt),
        ]),
      });
    }

    doc.save(`employee-${user?.username}-${Date.now()}.pdf`);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        {/* ─── Gradient hero header ────────────────────────────── */}
        <div
          className="relative px-6 pt-7 pb-5 text-white"
          style={{
            background:
              "linear-gradient(135deg, hsl(28 65% 22%) 0%, hsl(38 75% 38%) 50%, hsl(38 92% 50%) 100%)",
          }}
        >
          {/* Decorative pattern overlay */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 80%, rgba(255,255,255,.6) 0%, transparent 30%), radial-gradient(circle at 80% 20%, rgba(255,255,255,.5) 0%, transparent 25%)",
            }}
          />
          <DialogHeader className="relative">
            <DialogTitle className="flex items-center gap-2 text-white">
              <UserCircle className="h-5 w-5" /> Employee Profile
            </DialogTitle>
            <DialogDescription className="text-white/80">
              Complete employee record · performance analytics · recent activity
            </DialogDescription>
          </DialogHeader>

          {!isLoading && (
            <div className="relative mt-5 flex items-end gap-5 flex-wrap">
              <div className="relative">
                {profile?.photoDataUrl ? (
                  <img
                    src={profile.photoDataUrl}
                    alt={user?.username}
                    className="w-24 h-24 rounded-2xl object-cover ring-4 ring-white/30 shadow-lg"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-white/15 ring-4 ring-white/20 backdrop-blur flex items-center justify-center shadow-lg">
                    <UserCircle className="h-12 w-12 text-white/70" />
                  </div>
                )}
                {/* Online dot */}
                <span
                  className={`absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full ring-2 ring-white ${user?.isActive ? "bg-emerald-400" : "bg-gray-300"}`}
                />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <h2 className="text-2xl font-bold tracking-tight leading-tight">
                  {user?.username}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono uppercase tracking-wider bg-white/15 px-2 py-0.5 rounded-full">
                    {profile?.employeeId || "—"}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-white text-amber-900 px-2 py-0.5 rounded-full">
                    {user?.role}
                  </span>
                  {user?.isActive ? (
                    <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold uppercase tracking-wider bg-gray-400 text-white px-2 py-0.5 rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-white/80">
                  Since {fmtDate(profile?.hireDate)} · Last seen {fmtTime(user?.lastLogin)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5 cursor-pointer shadow" asChild>
                    <span>
                      <Camera className="h-3.5 w-3.5" />
                      {profile?.photoDataUrl ? "Replace" : "Upload"}
                    </span>
                  </Button>
                </label>
                {profile?.photoDataUrl && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs gap-1.5 text-red-700 shadow"
                    onClick={() => updatePhotoMutation.mutate(null)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />Remove
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs gap-1.5 shadow"
                  onClick={() => setMessageOpen(true)}
                  data-testid="button-message-employee"
                >
                  <MessageSquare className="h-3.5 w-3.5" />Message
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs gap-1.5 shadow"
                  onClick={exportPDF}
                  data-testid="button-export-employee-pdf"
                >
                  <Download className="h-3.5 w-3.5" />Export
                </Button>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="p-6">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="space-y-5 p-6">
            {/* Account info as inline grid */}
            <div className="grid grid-cols-2 gap-3 text-[13px] bg-muted/30 rounded-lg p-4 border">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">Email</span>
                <span className="ml-auto font-medium truncate">{profile?.email || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">Phone</span>
                <span className="ml-auto font-medium truncate font-mono">{profile?.contactNumber || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto font-medium">{fmtDate(user?.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">Last login</span>
                <span className="ml-auto font-medium">{fmtTime(user?.lastLogin)}</span>
              </div>
            </div>

            {/* KPI tiles — colored, with icons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiTile
                label="Completed orders"
                value={kpi.completedOrders || 0}
                Icon={ShoppingCart}
                color="emerald"
              />
              <KpiTile
                label="Reservations (30d)"
                value={kpi.reservationsCreated30d || 0}
                Icon={CalendarCheck}
                color="blue"
              />
              <KpiTile
                label="Approved leaves"
                value={profile?.approvedLeaves || 0}
                Icon={Award}
                color="amber"
              />
              <KpiTile
                label="Pending leaves"
                value={kpi.pendingLeaves || 0}
                Icon={Briefcase}
                color="rose"
              />
            </div>

            {/* Productivity chart — gradient bars with subtle grid */}
            {productivity.length > 0 && (
              <Card className="overflow-hidden">
                <CardHeader className="pb-2 bg-gradient-to-r from-primary/5 to-transparent">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Orders per day · last 7 days
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={productivity} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="empBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(38 92% 60%)" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="_id" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <ChartTooltip
                        cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" fill="url(#empBarGrad)" name="Orders" radius={[6, 6, 0, 0]} maxBarSize={42} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Tabbed history */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="overview"><ShoppingCart className="h-3.5 w-3.5 mr-1" />Orders</TabsTrigger>
                <TabsTrigger value="reservations"><CalendarCheck className="h-3.5 w-3.5 mr-1" />Reservations</TabsTrigger>
                <TabsTrigger value="timeline"><Activity className="h-3.5 w-3.5 mr-1" />Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-3 space-y-2">
                {orderSlice.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No orders yet</p>
                ) : (
                  <Card><CardContent className="p-0">
                    <Table>
                      <TableHeader><TableRow><TableHead>Tracking #</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {orderSlice.map((o: any) => (
                          <TableRow key={o._id}>
                            <TableCell className="font-mono text-xs">{o.trackingNumber}</TableCell>
                            <TableCell>{o.customerName}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{o.fulfillmentStatus}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDate(o.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent></Card>
                )}
                {ordersTotal > 1 && (
                  <Pagination page={orderPage} setPage={setOrderPage} total={ordersTotal} />
                )}
              </TabsContent>

              <TabsContent value="reservations" className="mt-3 space-y-2">
                {resSlice.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No reservations</p>
                ) : (
                  <Card><CardContent className="p-0">
                    <Table>
                      <TableHeader><TableRow><TableHead>Reservation #</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {resSlice.map((r: any) => (
                          <TableRow key={r._id}>
                            <TableCell className="font-mono text-xs">{r.trackingNumber}</TableCell>
                            <TableCell>{r.customerName}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{r.fulfillmentStatus}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDate(r.scheduledDate || r.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent></Card>
                )}
                {resTotal > 1 && <Pagination page={resPage} setPage={setResPage} total={resTotal} />}
              </TabsContent>

              <TabsContent value="timeline" className="mt-3 space-y-2">
                {logSlice.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {logSlice.map((l: any) => (
                      <div key={l._id} className="text-xs flex items-center gap-2 p-2 rounded bg-muted/40">
                        <Activity className="h-3 w-3 text-primary flex-shrink-0" />
                        <span className="font-medium text-foreground">{l.action}</span>
                        <span className="text-muted-foreground">{l.target ? `· ${l.target}` : ""}</span>
                        <span className="ml-auto text-muted-foreground">{fmtTime(l.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {logsTotal > 1 && <Pagination page={logPage} setPage={setLogPage} total={logsTotal} />}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Message dialog */}
        <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Message {username}</DialogTitle>
              <DialogDescription>Send an internal message visible in the employee's Help page.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input placeholder="Subject (optional)" value={messageSubject} onChange={(e) => setMessageSubject(e.target.value)} />
              <Textarea rows={4} placeholder="Message body..." value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMessageOpen(false)}>Cancel</Button>
              <Button disabled={!messageBody.trim() || sendMessageMutation.isPending} onClick={() => sendMessageMutation.mutate()}>
                {sendMessageMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Send
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/** SaaS-style KPI tile with icon + colored ring */
function KpiTile({ label, value, Icon, color }: {
  label: string;
  value: number;
  Icon: any;
  color: "emerald" | "blue" | "amber" | "rose";
}) {
  const colorMap = {
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
    blue: { bg: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-600 dark:text-blue-400", ring: "ring-blue-500/20" },
    amber: { bg: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/20" },
    rose: { bg: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-600 dark:text-rose-400", ring: "ring-rose-500/20" },
  }[color];
  return (
    <div className={`rounded-xl border ring-1 ${colorMap.ring} bg-card p-3 hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
        <div className={`w-7 h-7 rounded-lg ${colorMap.bg} flex items-center justify-center`}>
          <Icon className={`h-3.5 w-3.5 ${colorMap.text}`} />
        </div>
      </div>
      <div className="font-mono tabular-nums text-2xl font-bold leading-none mt-2">{value}</div>
    </div>
  );
}

function Pagination({ page, setPage, total }: { page: number; setPage: (p: number) => void; total: number }) {
  return (
    <div className="flex justify-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <Button
          key={i}
          size="sm"
          variant={page === i + 1 ? "default" : "outline"}
          className="h-7 w-7 p-0 text-xs"
          onClick={() => setPage(i + 1)}
        >
          {i + 1}
        </Button>
      ))}
    </div>
  );
}

export default function EmployeesPage() {
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; data: Employee[] }>({
    queryKey: ["/api/employees"],
    enabled: isAdmin,
  });

  const employees = data?.data || [];
  const filtered = useMemo(() => {
    return employees.filter((e) =>
      !search ||
      e.username.toLowerCase().includes(search.toLowerCase()) ||
      (e.profile?.employeeId || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.profile?.email || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [employees, search]);

  if (!isAdmin) {
    return (
      <div className="p-3 sm:p-6 flex items-center justify-center h-full">
        <p className="text-muted-foreground">Access denied. Admin only.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 pb-10">
        <h1 className="text-xl sm:text-2xl font-bold">Employees</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-employees-title">Employees</h1>
          <p className="text-sm text-muted-foreground">{employees.length} total employees</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search employees..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-employees" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((emp) => (
          <Card
            key={emp._id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => setSelected(emp.username)}
            data-testid={`card-employee-${emp.username}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {emp.profile?.photoDataUrl ? (
                  <img src={emp.profile.photoDataUrl} className="w-12 h-12 rounded-xl object-cover" alt={emp.username} />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <UserCircle className="h-6 w-6 text-primary/60" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold truncate">{emp.username}</p>
                    {emp.isActive
                      ? <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                      : <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{emp.profile?.employeeId || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{emp.profile?.email || "No email"}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No employees match your search.</CardContent></Card>
      )}

      {selected && <ProfileModal username={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
