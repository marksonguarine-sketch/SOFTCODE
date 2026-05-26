import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  UserCircle, Camera, Trash2, Mail, Phone, Calendar, CalendarOff,
  Loader2, Save, Send,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface ProfileData {
  username: string;
  employeeId: string;
  photoDataUrl?: string;
  email?: string;
  contactNumber?: string;
  hireDate?: string;
  approvedLeaves: number;
  rejectedLeaves: number;
}

export default function ProfilePage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveType, setLeaveType] = useState("personal");
  const [leaveReason, setLeaveReason] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; data: ProfileData }>({
    queryKey: ["/api/employee-profile/me"],
  });

  const profile = data?.data;

  useEffect(() => {
    if (profile) {
      setEmail(profile.email || "");
      setContactNumber(profile.contactNumber || "");
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await apiRequest("PATCH", `/api/employee-profile/${user?.username}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-profile/me"] });
      toast({ title: "Profile updated" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/requests", {
        requestType: "LEAVE",
        leavePayload: { startDate: leaveStart, endDate: leaveEnd, type: leaveType },
        reason: leaveReason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({ title: "Leave request submitted", description: "Waiting for admin approval" });
      setLeaveOpen(false);
      setLeaveStart(""); setLeaveEnd(""); setLeaveReason(""); setLeaveType("personal");
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Max 2MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => updateMutation.mutate({ photoDataUrl: ev.target?.result as string });
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 pb-10">
        <h1 className="text-xl sm:text-2xl font-bold">Profile</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 pb-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <UserCircle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-profile-title">My Profile</h1>
            <p className="text-sm text-muted-foreground">Manage your personal information</p>
          </div>
        </div>

        {/* Photo + identity */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-4">
              <div className="relative">
                {profile?.photoDataUrl ? (
                  <img src={profile.photoDataUrl} className="w-24 h-24 rounded-2xl object-cover border-2 border-primary/20" alt="Profile" />
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                    <UserCircle className="h-12 w-12 text-primary/50" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold">{user?.username}</h2>
                <p className="text-sm text-muted-foreground font-mono">{profile?.employeeId}</p>
                <Badge variant="secondary" className="mt-1">{user?.role}</Badge>
                <p className="text-xs text-muted-foreground mt-2">Employee since {profile?.hireDate ? new Date(profile.hireDate).toLocaleDateString("en-PH") : "—"}</p>
                <div className="flex gap-2 mt-3">
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1 cursor-pointer" asChild>
                      <span><Camera className="h-3 w-3" />{profile?.photoDataUrl ? "Replace" : "Upload"} Photo</span>
                    </Button>
                  </label>
                  {profile?.photoDataUrl && (
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-red-600" onClick={() => updateMutation.mutate({ photoDataUrl: null })}>
                      <Trash2 className="h-3 w-3" />Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-1.5 text-xs"><Mail className="h-3 w-3" />Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-profile-email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact" className="flex items-center gap-1.5 text-xs"><Phone className="h-3 w-3" />Contact Number</Label>
              <Input id="contact" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="+63 9XX XXX XXXX" data-testid="input-profile-contact" />
            </div>
            <Button
              className="w-full sm:w-auto"
              size="sm"
              disabled={(email === (profile?.email || "") && contactNumber === (profile?.contactNumber || "")) || updateMutation.isPending}
              onClick={() => updateMutation.mutate({ email, contactNumber })}
              data-testid="button-save-profile"
            >
              {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              <Save className="h-3.5 w-3.5 mr-1" />Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Leave summary + request */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarOff className="h-4 w-4" />Leave Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-2xl font-bold text-green-600">{profile?.approvedLeaves || 0}</p>
                <p className="text-xs text-muted-foreground">Approved Leaves</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-2xl font-bold text-red-500">{profile?.rejectedLeaves || 0}</p>
                <p className="text-xs text-muted-foreground">Rejected Leaves</p>
              </div>
            </div>
            <Button onClick={() => setLeaveOpen(true)} className="w-full sm:w-auto" data-testid="button-request-leave">
              <Send className="h-3.5 w-3.5 mr-1.5" />Request Leave
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Leave request dialog */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Leave</DialogTitle>
            <DialogDescription>Submit a leave request for admin approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={leaveType} onValueChange={setLeaveType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="sick">Sick</SelectItem>
                  <SelectItem value="vacation">Vacation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>Cancel</Button>
            <Button
              disabled={!leaveStart || !leaveEnd || leaveMutation.isPending}
              onClick={() => leaveMutation.mutate()}
              data-testid="button-submit-leave"
            >
              {leaveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
