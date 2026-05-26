import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Inbox, Check, X, Package, ArrowRightLeft, CalendarOff,
  Clock, User as UserIcon, Loader2, FileText, ChevronRight,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface RequestDoc {
  _id: string;
  requestType: "ADD_ITEM" | "TRANSFER_ORDER" | "LEAVE";
  requester: string;
  requesterDisplay?: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  reason?: string;
  itemPayload?: any;
  transferPayload?: any;
  leavePayload?: any;
  approver?: string;
  approverNote?: string;
  decidedAt?: string;
  history: Array<{ status: string; actor: string; timestamp: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

function fmtTime(d: string) {
  return new Date(d).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500 text-white border-transparent",
    accepted: "bg-green-600 text-white border-transparent",
    declined: "bg-red-500 text-white border-transparent",
    cancelled: "bg-gray-400 text-white border-transparent",
  };
  return <Badge className={`text-xs ${map[status] || ""}`}>{status.toUpperCase()}</Badge>;
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    ADD_ITEM: { label: "Add Item", cls: "bg-blue-500 text-white border-transparent", Icon: Package },
    TRANSFER_ORDER: { label: "Transfer Order", cls: "bg-purple-500 text-white border-transparent", Icon: ArrowRightLeft },
    LEAVE: { label: "Leave Request", cls: "bg-orange-500 text-white border-transparent", Icon: CalendarOff },
  };
  const { label, cls, Icon } = map[type] || { label: type, cls: "", Icon: FileText };
  return <Badge className={`text-xs gap-1 ${cls}`}><Icon className="h-3 w-3" />{label}</Badge>;
}

export default function RequestsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"all" | "ADD_ITEM" | "TRANSFER_ORDER" | "LEAVE">("all");
  const [selected, setSelected] = useState<RequestDoc | null>(null);
  const [actionNote, setActionNote] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: RequestDoc[] }>({
    queryKey: ["/api/requests"],
  });

  const requests = data?.data || [];
  const filtered = tab === "all" ? requests : requests.filter((r) => r.requestType === tab);
  const pending = filtered.filter((r) => r.status === "pending");
  const decided = filtered.filter((r) => r.status !== "pending");

  const acceptMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await apiRequest("POST", `/api/requests/${id}/accept`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Request accepted" });
      setSelected(null);
      setActionNote("");
    },
    onError: (err: Error) => toast({ title: "Failed to accept", description: err.message, variant: "destructive" }),
  });

  const declineMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await apiRequest("POST", `/api/requests/${id}/decline`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Request declined" });
      setSelected(null);
      setActionNote("");
    },
    onError: (err: Error) => toast({ title: "Failed to decline", description: err.message, variant: "destructive" }),
  });

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
        <h1 className="text-xl sm:text-2xl font-bold">Requests</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 pb-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Inbox className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-requests-title">Requests</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length} pending · {decided.length} decided
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            All
            <Badge variant="secondary" className="text-[10px] h-4 px-1">{requests.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ADD_ITEM" className="gap-1.5">
            <Package className="h-3.5 w-3.5" />Add Item
            {requests.filter((r) => r.requestType === "ADD_ITEM" && r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{requests.filter((r) => r.requestType === "ADD_ITEM" && r.status === "pending").length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="TRANSFER_ORDER" className="gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" />Transfer
            {requests.filter((r) => r.requestType === "TRANSFER_ORDER" && r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{requests.filter((r) => r.requestType === "TRANSFER_ORDER" && r.status === "pending").length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="LEAVE" className="gap-1.5">
            <CalendarOff className="h-3.5 w-3.5" />Leave
            {requests.filter((r) => r.requestType === "LEAVE" && r.status === "pending").length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1">{requests.filter((r) => r.requestType === "LEAVE" && r.status === "pending").length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-4 mt-4">
          {/* Pending */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />Pending ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    icon={Inbox}
                    title="Inbox zero"
                    description="No pending employee requests. New Add Item, Transfer Order, or Leave requests will appear here for your approval."
                    tone="success"
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {pending.map((r) => (
                  <Card key={r._id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => setSelected(r)}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-1.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <TypeBadge type={r.requestType} />
                            <StatusBadge status={r.status} />
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <UserIcon className="h-3 w-3" />{r.requester}
                            </span>
                          </div>
                          <p className="text-sm">
                            {r.requestType === "ADD_ITEM" && (
                              <span><strong>{r.itemPayload?.itemName}</strong> · {r.itemPayload?.category} · ₱{r.itemPayload?.unitPrice} × {r.itemPayload?.currentQuantity}</span>
                            )}
                            {r.requestType === "TRANSFER_ORDER" && (
                              <span>Transfer <strong>{r.transferPayload?.trackingNumber}</strong> → <strong>{r.transferPayload?.targetUsername}</strong></span>
                            )}
                            {r.requestType === "LEAVE" && (
                              <span>{r.leavePayload?.type || "Leave"}: {r.leavePayload?.startDate?.slice(0, 10)} — {r.leavePayload?.endDate?.slice(0, 10)}</span>
                            )}
                          </p>
                          {r.reason && <p className="text-xs text-muted-foreground italic">"{r.reason}"</p>}
                          <p className="text-xs text-muted-foreground">Submitted {fmtTime(r.createdAt)}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Decided */}
          {decided.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Decided ({decided.length})</h2>
              <div className="space-y-1.5">
                {decided.slice(0, 20).map((r) => (
                  <Card key={r._id} className="opacity-75 hover:opacity-100 cursor-pointer transition-opacity" onClick={() => setSelected(r)}>
                    <CardContent className="p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <TypeBadge type={r.requestType} />
                          <StatusBadge status={r.status} />
                          <span className="text-xs text-muted-foreground truncate">{r.requester}</span>
                          <span className="text-xs text-muted-foreground">· decided {fmtTime(r.decidedAt || r.updatedAt)} by {r.approver || "—"}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setActionNote(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && <TypeBadge type={selected.requestType} />}
              Request Details
            </DialogTitle>
            <DialogDescription>Submitted by <strong>{selected?.requester}</strong> on {selected && fmtTime(selected.createdAt)}</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={selected.status} />
                </div>
                <div>
                  <p className="text-muted-foreground">Requester</p>
                  <p className="font-medium">{selected.requester}</p>
                </div>
                {selected.approver && (
                  <div>
                    <p className="text-muted-foreground">Decided by</p>
                    <p className="font-medium">{selected.approver}</p>
                  </div>
                )}
                {selected.decidedAt && (
                  <div>
                    <p className="text-muted-foreground">Decided at</p>
                    <p className="font-medium">{fmtTime(selected.decidedAt)}</p>
                  </div>
                )}
              </div>

              {/* Type-specific payload */}
              {selected.requestType === "ADD_ITEM" && selected.itemPayload && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Item Details</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-1.5">
                    <p><strong>Name:</strong> {selected.itemPayload.itemName}</p>
                    <p><strong>SKU:</strong> {selected.itemPayload.sku || "—"}</p>
                    <p><strong>Category:</strong> {selected.itemPayload.category || "—"}</p>
                    <p><strong>Unit Price:</strong> ₱{selected.itemPayload.unitPrice}</p>
                    <p><strong>Initial Stock:</strong> {selected.itemPayload.currentQuantity} {selected.itemPayload.unit || "pcs"}</p>
                    {selected.itemPayload.supplier && <p><strong>Supplier:</strong> {selected.itemPayload.supplier}</p>}
                    {selected.itemPayload.description && <p className="text-muted-foreground italic">{selected.itemPayload.description}</p>}
                  </CardContent>
                </Card>
              )}

              {selected.requestType === "TRANSFER_ORDER" && selected.transferPayload && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Transfer Details</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-1.5">
                    <p><strong>Order:</strong> {selected.transferPayload.trackingNumber}</p>
                    <p><strong>From:</strong> {selected.requester}</p>
                    <p><strong>To:</strong> {selected.transferPayload.targetUsername}</p>
                  </CardContent>
                </Card>
              )}

              {selected.requestType === "LEAVE" && selected.leavePayload && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Leave Details</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-1.5">
                    <p><strong>Type:</strong> {selected.leavePayload.type || "Personal"}</p>
                    <p><strong>From:</strong> {selected.leavePayload.startDate?.slice(0, 10)}</p>
                    <p><strong>To:</strong> {selected.leavePayload.endDate?.slice(0, 10)}</p>
                  </CardContent>
                </Card>
              )}

              {selected.reason && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reason</p>
                  <p className="text-sm italic">"{selected.reason}"</p>
                </div>
              )}

              {/* History */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">History</p>
                <div className="space-y-1">
                  {selected.history.map((h, i) => (
                    <div key={i} className="text-xs flex items-center gap-2 p-1.5 rounded bg-muted/40">
                      <StatusBadge status={h.status} />
                      <span className="font-medium">{h.actor}</span>
                      <span className="text-muted-foreground">· {fmtTime(h.timestamp)}</span>
                      {h.note && <span className="text-muted-foreground italic">· {h.note}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {selected.status === "pending" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Note to requester (optional)</p>
                  <Textarea
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    rows={2}
                    placeholder="Reason or note..."
                    data-testid="textarea-request-note"
                  />
                </div>
              )}
            </div>
          )}

          {selected?.status === "pending" && (
            <DialogFooter>
              <Button
                variant="outline"
                className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                disabled={declineMutation.isPending}
                onClick={() => declineMutation.mutate({ id: selected._id, note: actionNote })}
                data-testid="button-decline-request"
              >
                {declineMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                <X className="h-3.5 w-3.5 mr-1" />Decline
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate({ id: selected._id, note: actionNote })}
                data-testid="button-accept-request"
              >
                {acceptMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                <Check className="h-3.5 w-3.5 mr-1" />Accept
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
