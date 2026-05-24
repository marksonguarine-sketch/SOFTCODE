import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Settings, Loader2, Save, Type, Palette, Layers, Store, Volume2,
  Calculator, Lock, Sun, Moon,
} from "lucide-react";
import { settingsSchema, type SettingsInput, type ISettings } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GRADIENT_OPTIONS, applySettings } from "@/lib/settings-context";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const FONT_OPTIONS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat",
  "Poppins", "Nunito", "Raleway", "Source Sans 3", "PT Sans",
];

const FONT_SIZE_OPTIONS = [
  { value: "small", label: "Small", px: "13px" },
  { value: "medium", label: "Medium", px: "14px" },
  { value: "large", label: "Large", px: "16px" },
  { value: "xl", label: "Extra Large", px: "18px" },
];

const COLOR_THEME_OPTIONS = [
  { value: "blue",    label: "Blue",    color: "#2563eb" },
  { value: "emerald", label: "Emerald", color: "#059669" },
  { value: "purple",  label: "Purple",  color: "#9333ea" },
  { value: "rose",    label: "Rose",    color: "#e11d48" },
  { value: "orange",  label: "Orange",  color: "#ea580c" },
  { value: "teal",    label: "Teal",    color: "#0d9488" },
  { value: "indigo",  label: "Indigo",  color: "#4f46e5" },
  { value: "amber",   label: "Amber",   color: "#d97706" },
  { value: "cyan",    label: "Cyan",    color: "#06b6d4" },
  { value: "slate",   label: "Slate",   color: "#475569" },
];

const GRADIENT_SWATCHES: Record<string, string> = {
  none: "transparent",
  "blue-purple":   "linear-gradient(135deg, #2563eb, #9333ea)",
  "emerald-teal":  "linear-gradient(135deg, #059669, #0d9488)",
  "rose-orange":   "linear-gradient(135deg, #e11d48, #ea580c)",
  "indigo-blue":   "linear-gradient(135deg, #4f46e5, #2563eb)",
  "purple-pink":   "linear-gradient(135deg, #9333ea, #ec4899)",
  "teal-cyan":     "linear-gradient(135deg, #0d9488, #06b6d4)",
  "orange-amber":  "linear-gradient(135deg, #ea580c, #d97706)",
  "slate-gray":    "linear-gradient(135deg, #475569, #6b7280)",
  "green-emerald": "linear-gradient(135deg, #16a34a, #059669)",
  "red-rose":      "linear-gradient(135deg, #dc2626, #e11d48)",
};

const TTS_VOICES = [
  { value: "en-US-AriaNeural",    label: "Aria (US Female)" },
  { value: "en-US-JennyNeural",   label: "Jenny (US Female)" },
  { value: "en-US-GuyNeural",     label: "Guy (US Male)" },
  { value: "en-US-DavisNeural",   label: "Davis (US Male)" },
  { value: "en-GB-SoniaNeural",   label: "Sonia (UK Female)" },
  { value: "en-GB-RyanNeural",    label: "Ryan (UK Male)" },
  { value: "en-AU-NatashaNeural", label: "Natasha (AU Female)" },
  { value: "en-AU-WilliamNeural", label: "William (AU Male)" },
  { value: "en-PH-RosaNeural",    label: "Rosa (PH Female)" },
  { value: "en-PH-JamesNeural",   label: "James (PH Male)" },
];

function loadGoogleFontPreview(fontName: string) {
  if (fontName === "Inter") return;
  const id = `google-font-preview-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500&display=swap`;
  document.head.appendChild(link);
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { isAdmin, user } = useAuth();

  // Per-user localStorage preferences
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const k = `joap_tts_${user?.username || "guest"}`;
    return localStorage.getItem(k) !== "false";
  });
  const [calculatorEnabled, setCalculatorEnabled] = useState(() => {
    const k = `joap_calc_${user?.username || "guest"}`;
    return localStorage.getItem(k) !== "false";
  });

  const persistTts = (val: boolean) => {
    setTtsEnabled(val);
    localStorage.setItem(`joap_tts_${user?.username || "guest"}`, String(val));
  };
  const persistCalc = (val: boolean) => {
    setCalculatorEnabled(val);
    localStorage.setItem(`joap_calc_${user?.username || "guest"}`, String(val));
    // Dispatch event so calculator component updates
    window.dispatchEvent(new CustomEvent("joap-calc-toggle", { detail: val }));
  };

  const { data: settingsData, isLoading } = useQuery<{ success: boolean; data: ISettings }>({
    queryKey: ["/api/settings"],
  });

  const settings = settingsData?.data as ISettings | undefined;

  const form = useForm<SettingsInput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      companyName: "JOAP Hardware Trading",
      theme: "light",
      font: "Inter",
      fontSize: "medium",
      colorTheme: "blue",
      gradient: "none",
      storeAddress: "",
      storeContactNumber: "",
      storeEmail: "",
      storeName: "",
      autoApplyOffers: true,
      showSavingsSummary: true,
      ttsVoice: "en-US-AriaNeural",
      dailySalesGoal: 100000,
    },
    values: settings ? {
      companyName: settings.companyName,
      theme: (settings.theme as "light" | "dark") || "light",
      font: settings.font || "Inter",
      fontSize: settings.fontSize || "medium",
      colorTheme: settings.colorTheme || "blue",
      gradient: settings.gradient || "none",
      storeAddress: settings.storeAddress || "",
      storeContactNumber: settings.storeContactNumber || "",
      storeEmail: settings.storeEmail || "",
      storeName: settings.storeName || "",
      autoApplyOffers: settings.autoApplyOffers ?? true,
      showSavingsSummary: settings.showSavingsSummary ?? true,
      ttsVoice: settings.ttsVoice || "en-US-AriaNeural",
      dailySalesGoal: settings.dailySalesGoal ?? 100000,
    } : undefined,
  });

  useEffect(() => { FONT_OPTIONS.forEach(loadGoogleFontPreview); }, []);

  const saveMutation = useMutation({
    mutationFn: async (data: SettingsInput) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      // Apply immediately without waiting for re-fetch
      if (result?.data) applySettings(result.data);
      toast({ title: "Settings saved successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const selectedFont = form.watch("font");
  const selectedColorTheme = form.watch("colorTheme");
  const selectedGradient = form.watch("gradient");
  const selectedFontSize = form.watch("fontSize");

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 overflow-auto h-full">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
        {!isAdmin && (
          <Badge variant="outline" className="text-xs">
            <Lock className="h-3 w-3 mr-1" /> Some settings are admin-only
          </Badge>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6 max-w-2xl">

          {/* ── SYSTEM SETTINGS (admin only) ────────────────────────── */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="h-4 w-4" /> System Settings
                </CardTitle>
                <CardDescription>Company information and system behaviour</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl><Input {...field} data-testid="input-company-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dailySalesGoal" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Sales Goal (₱)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1000}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        data-testid="input-daily-sales-goal"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Target revenue per day. Shown on every dashboard (admins + employees) as a progress ring.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="theme" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Theme</FormLabel>
                    <div className="flex gap-3">
                      {[{ value: "light", label: "Light", Icon: Sun }, { value: "dark", label: "Dark", Icon: Moon }].map(({ value, label, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => field.onChange(value)}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors",
                            field.value === value ? "border-primary bg-primary/10 font-medium" : "border-border hover-elevate"
                          )}
                          data-testid={`theme-${value}`}
                        >
                          <Icon className="h-4 w-4" /> {label}
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="autoApplyOffers" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <FormLabel className="cursor-pointer">Auto-apply Offers</FormLabel>
                      <FormDescription className="text-xs">Automatically apply active discounts to new orders</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="showSavingsSummary" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <FormLabel className="cursor-pointer">Show Savings Summary</FormLabel>
                      <FormDescription className="text-xs">Display discount savings on order receipts</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          )}

          {/* ── FONT SELECTION ──────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Type className="h-4 w-4" /> Font Selection
              </CardTitle>
              <CardDescription>Choose a font and size for the entire application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="font" render={({ field }) => (
                <FormItem>
                  <FormLabel>Font Family</FormLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {FONT_OPTIONS.map((font) => (
                      <button
                        key={font}
                        type="button"
                        onClick={() => field.onChange(font)}
                        className={cn(
                          "flex flex-col items-center justify-center p-3 rounded-md border text-sm transition-colors",
                          selectedFont === font ? "border-primary bg-primary/10" : "border-border hover-elevate"
                        )}
                        style={{ fontFamily: `'${font}', sans-serif` }}
                        data-testid={`font-option-${font.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <span className="font-medium text-base">Aa</span>
                        <span className="text-xs text-muted-foreground mt-1">{font}</span>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fontSize" render={({ field }) => (
                <FormItem>
                  <FormLabel>Font Size</FormLabel>
                  <div className="flex gap-2 flex-wrap">
                    {FONT_SIZE_OPTIONS.map(({ value, label, px }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => field.onChange(value)}
                        className={cn(
                          "flex flex-col items-center justify-center px-4 py-2 rounded-md border text-sm transition-colors",
                          selectedFontSize === value ? "border-primary bg-primary/10 font-medium" : "border-border hover-elevate"
                        )}
                        data-testid={`font-size-${value}`}
                      >
                        <span style={{ fontSize: px }}>Aa</span>
                        <span className="text-xs text-muted-foreground mt-1">{label}</span>
                        <span className="text-xs text-muted-foreground">{px}</span>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── COLOR THEME ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4" /> Color Theme
              </CardTitle>
              <CardDescription>Select the primary color for the application</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="colorTheme" render={({ field }) => (
                <FormItem>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {COLOR_THEME_OPTIONS.map((theme) => (
                      <button
                        key={theme.value}
                        type="button"
                        onClick={() => field.onChange(theme.value)}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-md border text-sm transition-colors",
                          selectedColorTheme === theme.value ? "border-primary bg-primary/10" : "border-border hover-elevate"
                        )}
                        data-testid={`color-theme-option-${theme.value}`}
                      >
                        <div className="h-5 w-5 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
                        <span className="text-sm">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── GRADIENT ────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" /> Gradient Background
              </CardTitle>
              <CardDescription>Optional gradient for the sidebar</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="gradient" render={({ field }) => (
                <FormItem>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {Object.entries(GRADIENT_OPTIONS).map(([key, opt]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => field.onChange(key)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-3 rounded-md border text-sm transition-colors",
                          selectedGradient === key ? "border-primary bg-primary/10" : "border-border hover-elevate"
                        )}
                        data-testid={`gradient-option-${key}`}
                      >
                        <div
                          className="h-8 w-full rounded-md"
                          style={{
                            background: key === "none"
                              ? "repeating-conic-gradient(hsl(var(--muted)) 0% 25%, transparent 0% 50%) 0 0 / 12px 12px"
                              : GRADIENT_SWATCHES[key],
                          }}
                        />
                        <span className="text-xs text-muted-foreground">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* ── STORE DETAILS (admin only) ───────────────────────────── */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4" /> Store Details
                </CardTitle>
                <CardDescription>Store information displayed on receipts and reservation PDFs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="storeName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store Name</FormLabel>
                    <FormControl><Input {...field} placeholder="JOAP Hardware Trading" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="storeAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store Address</FormLabel>
                    <FormControl><Textarea {...field} placeholder="Full store address" rows={2} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="storeContactNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Number</FormLabel>
                      <FormControl><Input {...field} placeholder="09XX-XXX-XXXX" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="storeEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl><Input {...field} placeholder="store@email.com" type="email" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── VOICE ANNOUNCEMENTS ──────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="h-4 w-4" /> Voice Announcements (TTS)
              </CardTitle>
              <CardDescription>Voice used to announce orders and assignments. Powered by Microsoft Edge TTS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Enable Voice Announcements</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Play audio when orders are assigned to you</p>
                </div>
                <Switch
                  checked={ttsEnabled}
                  onCheckedChange={persistTts}
                  data-testid="switch-tts-enabled"
                />
              </div>
              {isAdmin && (
                <FormField control={form.control} name="ttsVoice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Announcement Voice</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-tts-voice">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TTS_VOICES.map((v) => (
                          <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">This voice is used system-wide for all announcements</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </CardContent>
          </Card>

          {/* ── CALCULATOR ──────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Calculator
              </CardTitle>
              <CardDescription>Floating calculator accessible from every page</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Show Calculator</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Display a floating calculator button at the bottom of the screen</p>
                </div>
                <Switch
                  checked={calculatorEnabled}
                  onCheckedChange={persistCalc}
                  data-testid="switch-calculator"
                />
              </div>
            </CardContent>
          </Card>

          {/* Save button (only for admin-saveable settings) */}
          {isAdmin && (
            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings" className="w-full sm:w-auto">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
          )}
        </form>
      </Form>
    </div>
  );
}
