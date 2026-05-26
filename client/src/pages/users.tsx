import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Users, Plus, Search, Loader2, Shield, ShieldOff, RotateCcw,
  UserCheck, UserX, Eye, UserMinus, UserPlus, KeyRound,
} from "lucide-react";
import { createUserSchema, type CreateUserInput, type IUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

function isOnline(lastLogin: string | null | undefined): boolean {
  if (!lastLogin) return false;
  return new Date(lastLogin).getTime() > Date.now() - 5 * 60 * 1000;
}

// ─── Reactivation Dialog: password confirmation chain ────────────────────────
function ReactivateDialog({ user, onClose, onConfirm }: {
  user: IUser | null;
  onClose: () => void;
  onConfirm: (userId: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { toast } = useToast();

  const { mutate, isPending } = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/verify-password", { password });
      if (!res.ok) throw new Error("Incorrect password");
      return userId;
    },
    onSuccess: (userId: string) => {
      onConfirm(userId);
      onClose();
      setPassword("");
      setError("");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (!user) return null;

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) { onClose(); setPassword(""); setError(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" />Reactivate Account</DialogTitle>
          <DialogDescription>Enter your admin password to reactivate <strong>{user.username}</strong>.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="Your admin password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && password && mutate({ userId: user._id, password })}
            data-testid="input-reactivate-password"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setPassword(""); setError(""); }}>Cancel</Button>
          <Button
            disabled={!password || isPending}
            onClick={() => mutate({ userId: user._id, password })}
            data-testid="button-confirm-reactivate"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Reactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 10;

  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordDialogOpen, setTempPasswordDialogOpen] = useState(false);
  const [tempPasswordLabel, setTempPasswordLabel] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmCountdown, setConfirmCountdown] = useState(3);
  const [confirmReady, setConfirmReady] = useState(false);

  const [reactivateUser, setReactivateUser] = useState<IUser | null>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    setConfirmCountdown(3);
    setConfirmReady(false);
    const interval = setInterval(() => {
      setConfirmCountdown((prev) => {
        if (prev <= 1) { clearInterval(interval); setConfirmReady(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [confirmOpen]);

  const openConfirm = useCallback((message: string, action: () => void) => {
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  }, []);

  const { data: usersData, isLoading } = useQuery<{ success: boolean; data: { users: IUser[]; total: number; page: number; pageSize: number } }>({
    queryKey: ["/api/admin/users"],
  });

  const users = usersData?.data?.users || [];
  const activeUsers = users.filter((u) => u.isActive);
  const deactivatedUsers = users.filter((u) => !u.isActive);

  const filtered = activeUsers.filter((u) => {
    const matchSearch = u.username.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);
  const adminCount = activeUsers.filter((u) => u.role === "ADMIN").length;

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: "", password: "", role: "EMPLOYEE" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateUserInput) => {
      const res = await apiRequest("POST", "/api/admin/users", data);
      if (!res.ok) { const e = await res.json(); throw new Error(e?.message || "Failed"); }
      return { response: await res.json(), plainPassword: data.password };
    },
    onSuccess: ({ plainPassword }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreateOpen(false);
      form.reset();
      setTempPasswordLabel("New User Password");
      setTempPassword(plainPassword);
      setTempPasswordDialogOpen(true);
      toast({ title: "User created successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to create user", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/status`, { isActive });
      if (!res.ok) { const e = await res.json(); throw new Error(e?.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User status updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update user", description: err.message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role });
      if (!res.ok) { const e = await res.json(); throw new Error(e?.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update role", description: err.message, variant: "destructive" }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-password`);
      if (!res.ok) { const e = await res.json(); throw new Error(e?.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data: any) => {
      const tempPw = data.data?.temporaryPassword;
      if (tempPw) {
        setTempPasswordLabel("Temporary Password");
        setTempPassword(tempPw);
        setTempPasswordDialogOpen(true);
      }
      toast({ title: "Password reset successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to reset password", description: err.message, variant: "destructive" }),
  });

  const handleDeactivate = (u: IUser) => {
    if (u.role === "ADMIN" && adminCount <= 1) {
      toast({ title: "Cannot deactivate", description: "This is the last active admin.", variant: "destructive" });
      return;
    }
    openConfirm(`Deactivate "${u.username}"? They will no longer be able to log in.`, () => {
      toggleMutation.mutate({ id: u._id, isActive: false });
    });
  };

  const handleRoleToggle = (u: IUser) => {
    if (u.role === "ADMIN") {
      if (adminCount <= 1) {
        toast({ title: "Cannot change role", description: "This is the last admin. Promote another user first.", variant: "destructive" });
        return;
      }
      openConfirm(`Revoke admin from "${u.username}"?`, () => {
        roleMutation.mutate({ id: u._id, role: "EMPLOYEE" });
      });
    } else {
      roleMutation.mutate({ id: u._id, role: "ADMIN" });
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-3 sm:p-6 flex items-center justify-center h-full">
        <p className="text-muted-foreground">Access denied. Admin only.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 pb-10">
        <h1 className="text-2xl font-bold">Users</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 pb-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-users-title">User Management</h1>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-user">
          <Plus className="mr-1 h-4 w-4" /> Create User
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{activeUsers.length}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Active Users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{adminCount}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Admins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{deactivatedUsers.length}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Deactivated</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Users */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Active Users</h2>
          <Badge variant="secondary">{activeUsers.length}</Badge>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              data-testid="input-search-users"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px]" data-testid="select-role-filter">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
              <SelectItem value="EMPLOYEE">Employee</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
                ) : paginated.map((u) => (
                  <TableRow key={u._id} data-testid={`row-user-${u._id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${isOnline(u.lastLogin) ? "bg-green-500" : "bg-gray-300"}`} title={isOnline(u.lastLogin) ? "Online" : "Offline"} data-testid={`status-online-${u._id}`} />
                        <span data-testid={`text-username-${u._id}`}>{u.username}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(u.createdAt).toLocaleDateString("en-PH")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Button variant="ghost" size="icon" onClick={() => handleDeactivate(u)} title="Deactivate" data-testid={`button-deactivate-${u._id}`}>
                          <UserMinus className="h-4 w-4 text-orange-500" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleRoleToggle(u)} title={u.role === "ADMIN" ? "Revoke admin" : "Promote to admin"} data-testid={`button-role-${u._id}`}>
                          {u.role === "ADMIN" ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openConfirm(`Reset password for "${u.username}"?`, () => resetPasswordMutation.mutate(u._id))} title="Reset password" data-testid={`button-reset-${u._id}`}>
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)} data-testid="button-prev-page">Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)} data-testid="button-next-page">Next</Button>
          </div>
        )}
      </div>

      {/* Deactivated Accounts Section */}
      {deactivatedUsers.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-base font-semibold text-muted-foreground">Deactivated Accounts</h2>
              <Badge variant="outline">{deactivatedUsers.length}</Badge>
            </div>
            <Card className="border-dashed">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Reactivate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deactivatedUsers.map((u) => (
                      <TableRow key={u._id} className="opacity-70" data-testid={`row-deactivated-${u._id}`}>
                        <TableCell className="font-medium text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300 flex-shrink-0" />
                            {u.username}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-muted-foreground">{u.role}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("en-PH") : "Never"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950"
                            onClick={() => setReactivateUser(u)}
                            data-testid={`button-reactivate-${u._id}`}
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Reactivate
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>Add a new user to the system.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem><FormLabel>Username</FormLabel><FormControl><Input {...field} data-testid="input-new-username" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" {...field} data-testid="input-new-password" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger data-testid="select-new-role"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-user">
                {createMutation.isPending && <Loader2 className="animate-spin mr-1 h-4 w-4" />}
                Create User
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Temp Password Dialog */}
      <AlertDialog open={tempPasswordDialogOpen} onOpenChange={setTempPasswordDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tempPasswordLabel}</AlertDialogTitle>
            <AlertDialogDescription>Please copy this password now. It will not be shown again.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
            <Eye className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <code className="text-sm font-mono select-all" data-testid="text-temp-password">{tempPassword}</code>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-close-password">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!confirmReady}
              onClick={() => { confirmAction?.(); setConfirmOpen(false); }}
              data-testid="button-confirm-action"
            >
              {confirmReady ? "Confirm" : `Wait ${confirmCountdown}s...`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivation Dialog with password confirmation */}
      <ReactivateDialog
        user={reactivateUser}
        onClose={() => setReactivateUser(null)}
        onConfirm={(userId) => {
          toggleMutation.mutate({ id: userId, isActive: true });
          setReactivateUser(null);
        }}
      />
    </div>
  );
}
