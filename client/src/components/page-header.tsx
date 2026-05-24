import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * PageHeader — modern SaaS-style page header used across the app.
 *
 * Layout:  [title (big, bold, tight tracking) + subtitle below]   ............... [actions]
 *
 * Drop in at the top of any page:
 *   <PageHeader title="Orders" subtitle="3 in processing · 1 overdue" actions={<Button>New</Button>} />
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-5", className)}>
      <div className="min-w-0">
        <h1
          className="text-[22px] font-bold tracking-tight leading-tight m-0"
          data-testid="page-header-title"
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-muted-foreground mt-1 m-0">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}
