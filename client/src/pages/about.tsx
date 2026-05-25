import { Code2, Shield, Github, Cpu, Database, Globe, Layers, Star, Users2 } from "lucide-react";
import { JoapLogo } from "@/components/joap-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const DEVELOPERS = [
  {
    name: "Cabilao Keane Andre B.",
    role: "Full-Stack Developer",
    initials: "KC",
    color: "bg-blue-500",
    focus: "UI/UX, Frontend Architecture",
  },
  {
    name: "Ebona John Marwin R.",
    role: "Backend Developer & DB Architect",
    initials: "JE",
    color: "bg-emerald-500",
    focus: "API, MongoDB, Server Logic",
  },
  {
    name: "Mirasol Prince Marl Lizandrelle D.",
    role: "Systems Developer",
    initials: "PM",
    color: "bg-purple-500",
    focus: "Order System, Reporting, QA",
  },
];

const TECH_STACK = [
  { label: "React 18 + TypeScript", icon: Layers, color: "text-blue-500" },
  { label: "shadcn/ui + Tailwind CSS", icon: Globe, color: "text-sky-500" },
  { label: "Node.js + Express", icon: Cpu, color: "text-green-500" },
  { label: "MongoDB + Mongoose", icon: Database, color: "text-emerald-500" },
  { label: "Socket.io (Real-time)", icon: Globe, color: "text-orange-500" },
  { label: "TanStack Query v5", icon: Code2, color: "text-red-500" },
];

const FEATURES = [
  "Inventory Management",
  "Order Processing & Assignment",
  "Billing & Payments",
  "Accounting & Reporting",
  "Reservation System",
  "Role-Based Access Control",
  "Real-time Notifications",
  "Text-to-Speech (TTS)",
  "PDF Export & Reports",
  "Auto Offer Application",
];

export default function AboutPage() {
  return (
    <div className="p-3 sm:p-6 overflow-auto h-full">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Hero */}
        <div className="text-center space-y-4 py-6">
          <div className="flex justify-center">
            <div className="relative">
              <JoapLogo size={80} className="rounded-2xl shadow-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-background flex items-center justify-center">
                <Star className="h-3 w-3 text-white fill-white" />
              </div>
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-app-name">JOAP Hardware Trading</h1>
            <p className="text-muted-foreground mt-1">Enterprise Resource Planning System</p>
          </div>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Badge variant="outline" className="gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Version 1.0.0</Badge>
            <Badge variant="outline">Production Build</Badge>
            <Badge variant="outline">2026</Badge>
          </div>
        </div>

        {/* About */}
        <Card className="border-none bg-muted/40">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold mb-1">About This System</p>
                <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-about-description">
                  A comprehensive ERP system purpose-built for JOAP Hardware Trading. It handles the full
                  business workflow — from inventory tracking and order management to billing, accounting,
                  and employee coordination — with real-time updates, voice notifications, and role-based
                  access control for admins and staff.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Features */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">System Features</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Developers */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Users2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Development Team</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {DEVELOPERS.map((dev) => (
              <Card key={dev.name} className="overflow-hidden hover:border-primary/50 transition-colors">
                <CardContent className="pt-6 text-center space-y-3">
                  <div className="flex justify-center">
                    <div className={`w-14 h-14 rounded-2xl ${dev.color} flex items-center justify-center text-white font-bold text-lg shadow-md`}>
                      {dev.initials}
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-sm leading-tight" data-testid={`text-developer-${dev.initials.toLowerCase()}`}>{dev.name}</p>
                    <p className="text-xs text-primary mt-0.5 font-medium">{dev.role}</p>
                    <p className="text-xs text-muted-foreground mt-1">{dev.focus}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Separator />

        {/* Tech Stack */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Technology Stack</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TECH_STACK.map((tech) => (
              <div key={tech.label} className="flex items-center gap-2.5 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                <tech.icon className={`h-4 w-4 flex-shrink-0 ${tech.color}`} />
                <span className="text-sm font-medium">{tech.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-4 space-y-1">
          <p className="text-xs text-muted-foreground" data-testid="text-copyright">
            © 2026 JOAP Hardware Trading. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Built with ❤️ by the JOAP Dev Team
          </p>
        </div>

      </div>
    </div>
  );
}
