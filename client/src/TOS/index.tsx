/**
 * Terms of Service — one-shot per-user dialog shown right after login.
 *
 * Folder is deliberately self-contained: delete `client/src/TOS/` and the
 * single import in `App.tsx` (`<TOSDialog username={user.username} />`)
 * and the feature is gone with no other code changes required.
 *
 * Behavior (per REQUEST.pdf round 11):
 *  - Shown once per logged-in username via localStorage flag.
 *  - The "I Agree & Continue" button is DISABLED until the user has
 *    scrolled to the bottom of the agreement body.
 *  - Headers are visually separated with horizontal rules.
 *
 * Authored by Marwin Maxino & Mark Songuarine (SOFTENG 2, 2025-26).
 */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Lock, Check } from "lucide-react";

const TOS_STORAGE_PREFIX = "joap_tos_agreed_";

export function TOSDialog({ username }: { username: string }) {
  const storageKey = `${TOS_STORAGE_PREFIX}${(username || "").toLowerCase()}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (!username) return false;
    try { return localStorage.getItem(storageKey) !== "true"; } catch { return true; }
  });
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset scroll guard when the dialog (re-)opens
  useEffect(() => {
    if (open) setScrolledEnd(false);
  }, [open]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    // 24px slack so a small mouse-wheel under-scroll still counts
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setScrolledEnd(true);
    }
  }

  function accept() {
    try { localStorage.setItem(storageKey, "true"); } catch {}
    setOpen(false);
  }

  if (!username) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* not dismissible by overlay click */ }}>
      <DialogContent
        className="max-w-2xl p-0 overflow-hidden"
        // Block ESC and outside-click dismissal — user MUST agree first
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b bg-gradient-to-br from-primary/10 via-transparent to-transparent">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-4 w-4 text-primary" />
            Terms of Service & End-User Agreement
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            JOAP Hardware Trading ERP · v1.0 · Issued for SOFTENG 2 fulfilment
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="px-6 py-5 text-sm leading-relaxed text-foreground/90 space-y-4"
            style={{ maxHeight: "60vh", overflowY: "auto" }}
          >
            <p>
              This Terms of Service ("<strong>Agreement</strong>") governs the use of the
              JOAP Hardware Trading point-of-sale and inventory management system
              ("<strong>the System</strong>"), developed by <strong>Marwin Maxino</strong> and
              <strong> Mark Songuarine </strong> ("<strong>the Developers</strong>") as part
              of the fulfilment of <em>Software Engineering 2</em> coursework, and delivered
              to JOAP Hardware Trading ("<strong>the Client</strong>") pursuant to feedback
              and interviews collected from the Client's staff and ownership.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">1. Scope of the System</h3>
            <p>
              The System is a custom-built ERP covering inventory management, point-of-sale
              transactions, reservations, accounting ledger entries, demand forecasting,
              and basic reporting. The System is delivered <strong>AS IS</strong>, configured
              to the workflows documented during the requirements-gathering phase.
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Inventory tracking with starting-stock based low/critical bands and ROP alerts.</li>
              <li>Walk-in, online, reservation, and pickup order types with partial release.</li>
              <li>Double-entry accounting with auto-posted ledger pairs on payment.</li>
              <li>Role-based access (Admin, Inventory Manager, Employee, Super Admin).</li>
            </ul>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">2. Acceptance of Risk</h3>
            <p>
              By clicking <strong>"I Agree & Continue"</strong>, the Client acknowledges
              and accepts that the System is academic coursework provided in good faith
              and that the Developers shall not be liable for any direct, indirect,
              incidental, consequential, or punitive losses (including but not limited
              to lost revenue, lost inventory, missed sales opportunities, regulatory
              fines, customer disputes, or data corruption) arising from the use,
              misuse, or unavailability of the System beyond the documented scope above.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">3. Data & Privacy</h3>
            <p>
              All transactional data is stored in a MongoDB cluster operated by the
              Client. Daily JSON backups are emailed to the address configured in
              <em> Maintenance → Backup Email</em>. The Developers do not access live
              Client data except when explicitly granted credentials by the Client for
              the purpose of bug-fixing or migration support.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">4. Support & Maintenance</h3>
            <p>
              Bug-fix support is provided on a best-effort basis through the academic
              term. After turnover, ongoing maintenance is the Client's responsibility
              unless a separate engagement is agreed in writing.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">5. Intellectual Property</h3>
            <p>
              Source code, design assets, and documentation are jointly owned by the
              Developers and licensed in perpetuity to the Client for the operation of
              JOAP Hardware Trading. Sub-licensing, resale, or redistribution to third
              parties is not permitted without written consent from the Developers.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">6. Limitation of Liability</h3>
            <p>
              In no event shall the aggregate liability of the Developers exceed
              <strong> zero (₱0)</strong>, as the System is delivered without monetary
              consideration. The Client agrees to indemnify the Developers against any
              third-party claims arising from the Client's operation of the System.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">7. Governing Law</h3>
            <p>
              This Agreement is governed by the laws of the Republic of the Philippines.
              Any dispute shall be resolved in the courts of Rizal Province.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">8. Acknowledgement</h3>
            <p>
              By scrolling to the end of this Agreement and clicking
              <strong> "I Agree & Continue"</strong>, the Client confirms that they have
              read, understood, and accept every clause above on behalf of JOAP
              Hardware Trading.
            </p>

            <p className="text-[11px] text-muted-foreground pt-3 border-t">
              © {new Date().getFullYear()} Marwin Maxino & Mark Songuarine. All rights reserved. <br/>
              JOAP Hardware Trading ERP — issued under the Software Engineering 2 deliverables programme.
            </p>
          </div>
        </ScrollArea>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-3 bg-muted/30">
          <span className={cn("text-xs", scrolledEnd ? "text-emerald-600 font-medium" : "text-muted-foreground")}>
            {scrolledEnd ? "✓ End of document reached" : "Scroll to the end to enable the Continue button."}
          </span>
          <Button
            onClick={accept}
            disabled={!scrolledEnd}
            data-testid="tos-continue"
            className="min-w-[180px]"
          >
            <Check className="mr-2 h-4 w-4" />
            I Agree & Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
