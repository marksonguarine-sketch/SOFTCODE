import { useState, useEffect, lazy, Suspense } from "react";
import {
  Wrench,
  Download,
  Upload,
  Loader2,
  Database,
  HardDrive,
  Clock,
  Settings,
  ChevronDown,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Mail,
  Send,
  Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

const DevWipeButton = lazy(() => import("@/components/dev_button"));

export default function MaintenancePage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [uploadCountdown, setUploadCountdown] = useState(5);
  const [isUploading, setIsUploading] = useState(false);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreAccept, setRestoreAccept] = useState("");

  const [historyPage, setHistoryPage] = useState(1);

  // ── Backup email (Resend recipient) ──────────────────────────────────────
  const { data: backupEmailData } = useQuery<{ success: boolean; data: { email: string } }>({
    queryKey: ["/api/maintenance/backup-email"],
    enabled: isAdmin,
  });
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  useEffect(() => {
    if (backupEmailData?.data?.email) setEmailDraft(backupEmailData.data.email);
  }, [backupEmailData]);

  const saveEmailMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await apiRequest("PATCH", "/api/maintenance/backup-email", data);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/backup-email"] });
      setEditingEmail(false);
      setEmailPassword("");
      toast({ title: "Backup email updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update email", description: err.message, variant: "destructive" }),
  });

  const emailBackupNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/maintenance/backup/email");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed");
      return json;
    },
    onSuccess: (json: any) => toast({ title: "Backup emailed", description: json?.data?.message }),
    onError: (err: Error) => toast({ title: "Email failed", description: err.message, variant: "destructive" }),
  });

  const { data: backupSettings } = useQuery<{ success: boolean; data: { enabled: boolean; intervalValue: number; intervalUnit: string } }>({
    queryKey: ["/api/maintenance/auto-backup/settings"],
    enabled: isAdmin,
  });

  const { data: historyData } = useQuery<{ success: boolean; data: { history: Array<{ _id: string; filename: string; size: number; source: string; createdBy: string; createdAt: string }>; total: number } }>({
    queryKey: [`/api/maintenance/backup/history?page=${historyPage}&pageSize=5`],
    enabled: isAdmin,
  });

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [intervalValue, setIntervalValue] = useState(24);
  const [intervalUnit, setIntervalUnit] = useState("hours");

  useEffect(() => {
    if (backupSettings?.data) {
      setAutoEnabled(backupSettings.data.enabled);
      setIntervalValue(backupSettings.data.intervalValue);
      setIntervalUnit(backupSettings.data.intervalUnit);
    }
  }, [backupSettings]);

  const saveAutoBackupMutation = useMutation({
    mutationFn: async (data: { enabled: boolean; intervalValue: number; intervalUnit: string }) => {
      const res = await apiRequest("PATCH", "/api/maintenance/auto-backup/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/auto-backup/settings"] });
      toast({ title: "Auto backup settings saved" });
    },
    onError: (err: Error) => toast({ title: "Failed to save settings", description: err.message, variant: "destructive" }),
  });

  const triggerBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/maintenance/auto-backup/trigger");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/backup/history"] });
      toast({ title: "Backup created successfully" });
    },
    onError: (err: Error) => toast({ title: "Backup failed", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!uploadOpen) {
      setUploadConfirmed(false);
      setUploadCountdown(5);
      setUploadFile(null);
      setRestorePassword("");
      setRestoreAccept("");
      return;
    }
    if (!uploadConfirmed) {
      setUploadCountdown(5);
      return;
    }
    if (uploadCountdown <= 0) return;
    const timer = setTimeout(() => setUploadCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [uploadOpen, uploadConfirmed, uploadCountdown]);

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await apiRequest("GET", "/api/maintenance/backup");
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `joap-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Backup exported successfully" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleUploadRestore = async () => {
    if (!uploadFile) return;
    if (restoreAccept.trim().toUpperCase() !== "ACCEPT") {
      toast({ title: "Type ACCEPT to confirm", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      // Verify the admin password before overwriting the database.
      const verify = await apiRequest("POST", "/api/auth/verify-password", { password: restorePassword });
      const verifyJson = await verify.json();
      if (!verifyJson.success) throw new Error("Incorrect admin password");

      const text = await uploadFile.text();
      const backupData = JSON.parse(text);
      const res = await apiRequest("POST", "/api/maintenance/backup/upload", backupData);
      const result = await res.json();
      if (result.success) {
        toast({ title: "Backup restored successfully" });
        queryClient.invalidateQueries();
        setUploadOpen(false);
      } else {
        throw new Error(result.error);
      }
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadHistory = async (id: string, filename: string) => {
    try {
      const res = await apiRequest("GET", `/api/maintenance/backup/download/${id}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-3 sm:p-6 flex items-center justify-center h-full">
        <p className="text-muted-foreground">Access denied. Admin only.</p>
      </div>
    );
  }

  const history = historyData?.data?.history || [];
  const totalHistory = historyData?.data?.total || 0;
  const hasMore = historyPage * 5 < totalHistory;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">
      <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-maintenance-title">Maintenance</h1>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" /> Data Backup
            </CardTitle>
            <CardDescription>
              Export or restore a complete backup of all system data as a JSON file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              <Button
                onClick={handleExportBackup}
                disabled={isExporting}
                data-testid="button-export-backup"
              >
                {isExporting ? (
                  <Loader2 className="animate-spin mr-1" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                {isExporting ? "Exporting..." : "Download Backup"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setUploadOpen(true)}
                data-testid="button-upload-backup"
              >
                <Upload className="mr-1 h-4 w-4" /> Upload Backup
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" /> Backup Email
            </CardTitle>
            <CardDescription>
              Auto backups are emailed here as a JSON attachment (via Resend). Editing requires your admin password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!editingEmail ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-medium text-sm break-all" data-testid="text-backup-email">
                  {backupEmailData?.data?.email || "marksonguarine@gmail.com"}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingEmail(true)} data-testid="button-edit-backup-email">
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => emailBackupNowMutation.mutate()}
                    disabled={emailBackupNowMutation.isPending}
                    data-testid="button-email-backup-now"
                  >
                    {emailBackupNowMutation.isPending ? <Loader2 className="animate-spin mr-1 h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    Email Backup Now
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="recipient@email.com"
                  data-testid="input-backup-email"
                />
                <Input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Confirm with your admin password"
                  data-testid="input-backup-email-password"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveEmailMutation.mutate({ email: emailDraft, password: emailPassword })}
                    disabled={saveEmailMutation.isPending || !emailDraft || !emailPassword}
                    data-testid="button-save-backup-email"
                  >
                    {saveEmailMutation.isPending && <Loader2 className="animate-spin mr-1 h-3.5 w-3.5" />}
                    Save Email
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingEmail(false); setEmailPassword(""); setEmailDraft(backupEmailData?.data?.email || ""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Auto Backup
            </CardTitle>
            <CardDescription>
              Configure automatic backups at regular intervals. Backups are saved to the system and can be downloaded from the history below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Enable Auto Backup</span>
              <Switch
                checked={autoEnabled}
                onCheckedChange={setAutoEnabled}
                data-testid="switch-auto-backup"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input
                type="number"
                min={1}
                className="w-20"
                value={intervalValue}
                onChange={(e) => setIntervalValue(parseInt(e.target.value) || 1)}
                data-testid="input-backup-interval"
              />
              <Select value={intervalUnit} onValueChange={setIntervalUnit}>
                <SelectTrigger className="w-[120px]" data-testid="select-backup-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                  <SelectItem value="weeks">Weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button
                size="sm"
                onClick={() => saveAutoBackupMutation.mutate({ enabled: autoEnabled, intervalValue, intervalUnit })}
                disabled={saveAutoBackupMutation.isPending}
                data-testid="button-save-auto-backup"
              >
                {saveAutoBackupMutation.isPending && <Loader2 className="animate-spin mr-1 h-3 w-3" />}
                Save Settings
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => triggerBackupMutation.mutate()}
                disabled={triggerBackupMutation.isPending}
                data-testid="button-trigger-backup"
              >
                {triggerBackupMutation.isPending && <Loader2 className="animate-spin mr-1 h-3 w-3" />}
                Create Backup Now
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" /> Auto Backup History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h._id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md text-sm" data-testid={`backup-history-${h._id}`}>
                    <div>
                      <div className="font-medium">
                        {new Date(h.createdAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {h.source === "auto" ? "Automatic" : "Manual"} | {(h.size / 1024).toFixed(1)} KB | by {h.createdBy}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownloadHistory(h._id, h.filename)}
                      data-testid={`button-download-${h._id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setHistoryPage((p) => p + 1)}
                    data-testid="button-show-more-history"
                  >
                    <ChevronDown className="mr-1 h-3 w-3" /> Show More
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-blue-600" /> Database Migration Guide
            </CardTitle>
            <CardDescription>
              How to move all your data to a new MongoDB database (e.g. switching from one Atlas cluster to another).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-bold text-xs">1</span>
                <div>
                  <p className="font-medium">Download a backup from your current database</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Click <strong>Download Backup</strong> above. Save the <code>.json</code> file — it contains all your items, orders, customers, users, and settings.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-bold text-xs">2</span>
                <div>
                  <p className="font-medium">Update <code>MONGODB_URI</code> to the new database URL</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Go to your environment secrets and change <code>MONGODB_URI</code> to your new MongoDB connection string, then restart the app.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-bold text-xs">3</span>
                <div>
                  <p className="font-medium">Log in with the default admin credentials</p>
                  <p className="text-muted-foreground text-xs mt-0.5">The new empty database is automatically seeded with a default admin account: <strong>username: admin</strong> / <strong>password: admin123</strong>.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-bold text-xs">4</span>
                <div>
                  <p className="font-medium">Upload the backup file to restore all data</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Click <strong>Upload Backup</strong> above, select the <code>.json</code> file you saved in Step 1, confirm, and all your data — including your original users, items, orders, and settings — will be fully restored.</p>
                </div>
              </li>
            </ol>
            <div className="mt-4 flex items-start gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>Your original passwords and all user accounts are preserved in the backup and restored automatically.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> System Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Application</span>
                <span className="font-medium">JOAP Hardware Trading SMS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Environment</span>
                <span className="font-medium">Production</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Danger Zone
            </CardTitle>
            <CardDescription>
              Developer tools for testing purposes only. These actions cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={null}>
              <DevWipeButton />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Restore from Backup
            </DialogTitle>
            <DialogDescription>
              Upload a JSON backup file to restore the system. This will overwrite all existing data with the backup data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-destructive/10 rounded-md text-sm text-destructive font-medium">
              WARNING: This will replace ALL existing data with the uploaded backup. Make sure you have a current backup before proceeding.
            </div>
            <Input
              type="file"
              accept=".json"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              data-testid="input-upload-backup-file"
            />
            {uploadFile && (
              <p className="text-sm text-muted-foreground">
                Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="confirm-restore"
                checked={uploadConfirmed}
                onCheckedChange={(v) => setUploadConfirmed(!!v)}
                data-testid="checkbox-confirm-restore"
              />
              <label htmlFor="confirm-restore" className="text-sm font-medium cursor-pointer">
                I understand this will overwrite all existing data
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Admin password</label>
              <Input
                type="password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                placeholder="Enter your admin password"
                data-testid="input-restore-password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type <span className="font-mono text-destructive">ACCEPT</span> to confirm</label>
              <Input
                value={restoreAccept}
                onChange={(e) => setRestoreAccept(e.target.value)}
                placeholder="ACCEPT"
                data-testid="input-restore-accept"
              />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={!uploadFile || !uploadConfirmed || uploadCountdown > 0 || isUploading || !restorePassword || restoreAccept.trim().toUpperCase() !== "ACCEPT"}
              onClick={handleUploadRestore}
              data-testid="button-confirm-restore"
            >
              {isUploading ? (
                <><Loader2 className="animate-spin mr-1 h-4 w-4" /> Restoring...</>
              ) : uploadCountdown > 0 && uploadConfirmed ? (
                `Confirm Restore (${uploadCountdown}s)`
              ) : (
                "Confirm Restore"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
