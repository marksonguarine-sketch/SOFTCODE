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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-primary" />Employee Profile
          </DialogTitle>
          <DialogDescription>Complete employee record and performance analytics</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            {/* Header card */}
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-start gap-5">
                  <div className="relative flex-shrink-0">
                    {profile?.photoDataUrl ? (
                      <img src={profile.photoDataUrl} alt={user?.username} className="w-24 h-24 rounded-2xl object-cover border-2 border-primary/20" />
                    ) : (
                      <div className="w-24 h-24 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                        <UserCircle className="h-12 w-12 text-primary/50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold">{user?.username}</h2>
                      <Badge variant={user?.role === "ADMIN" ? "default" : "secondary"}>{user?.role}</Badge>
                      <Badge className={user?.isActive ? "bg-green-600 text-white border-transparent" : "bg-gray-400 text-white border-transparent"}>
                        {user?.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground font-mono">{profile?.employeeId}</p>
                    <p className="text-xs text-muted-foreground">Employee since {fmtDate(profile?.hireDate)}</p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <label className="cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 cursor-pointer" asChild>
                          <span><Camera className="h-3 w-3" />{profile?.photoDataUrl ? "Replace" : "Upload"} Photo</span>
                        </Button>
                      </label>
                      {profile?.photoDataUrl && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => updatePhotoMutation.mutate(null)}>
                          <Trash2 className="h-3 w-3" />Delete Photo
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setMessageOpen(true)}>
                        <MessageSquare className="h-3 w-3" />Message
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportPDF}>
                        <Download className="h-3 w-3" />Export PDF
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Account info */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Account Information</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span>{profile?.email || "—"}</span></div>
                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><span>{profile?.contactNumber || "—"}</span></div>
                <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-muted-foreground" />Created: {fmtDate(user?.createdAt)}</div>
                <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" />Last login: {fmtTime(user?.lastLogin)}</div>
              </CardContent>
            </Card>

            {/* KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{kpi.completedOrders || 0}</div><p className="text-xs text-muted-foreground mt-0.5">Completed Orders</p></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{kpi.reservationsCreated30d || 0}</div><p className="text-xs text-muted-foreground mt-0.5">Reservations (30d)</p></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{profile?.approvedLeaves || 0}</div><p className="text-xs text-muted-foreground mt-0.5">Approved Leaves</p></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{kpi.pendingLeaves || 0}</div><p className="text-xs text-muted-foreground mt-0.5">Pending Leaves</p></CardContent></Card>
            </div>

            {/* Productivity chart */}
            {productivity.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Orders Per Day (Last 7 Days)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={productivity}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="_id" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" name="Orders" radius={[4, 4, 0, 0]} />
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
      <div className="p-3 sm:p-6 space-y-4 overflow-auto h-full">
        <h1 className="text-xl sm:text-2xl font-bold">Employees</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 overflow-auto h-full">
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
