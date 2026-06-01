/**
 * Terms of Service — one-shot per-USER (server-tracked) dialog shown right
 * after login.
 *
 * Folder is deliberately self-contained: delete `client/src/TOS/` and the
 * single import in `App.tsx` (`<TOSDialog username={user.username} />`)
 * and the feature is gone with no other code changes required.
 *
 * Behavior (R13 update):
 *  - Shown only when the server reports the current user has NOT yet
 *    accepted the agreement (`GET /api/auth/tos-status` → `{accepted}`).
 *    Tracking moved off localStorage so a fresh device still respects an
 *    earlier acceptance.
 *  - "I Agree & Continue" is DISABLED until the user has scrolled to the
 *    bottom of the agreement body.
 *  - "Print TOS" downloads the static `/termsofservice/TOS.pdf` next to
 *    the End-of-document message.
 *  - Headers are visually separated with horizontal rules.
 *
 * Drafted for: Cabilao Keane Andre B., Ebona John Marwin R.,
 *              Mirasol Prince Marl Lizandrelle D. (SOFTENG 2, 2025-26).
 */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Lock, Check, Printer } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const TOS_VERSION = "1.0";
const TOS_PDF_PATH = "/termsofservice/TOS.pdf";

export function TOSDialog({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // On mount (and whenever the username changes), ask the server whether
  // this account has already accepted. Only open the dialog when accepted=false.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/tos-status");
        const j = await res.json();
        if (cancelled) return;
        if (j?.success && j?.data?.accepted) {
          setOpen(false);
        } else {
          setOpen(true);
        }
      } catch {
        // If the status check fails (e.g. offline), default to showing the
        // dialog — safer to over-prompt than skip the agreement entirely.
        if (!cancelled) setOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (open) setScrolledEnd(false);
  }, [open]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setScrolledEnd(true);
    }
  }

  async function accept() {
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/accept-tos", { version: TOS_VERSION });
    } catch {
      /* even if the network call fails, close the dialog locally so the user
         can keep working — they will just be re-prompted on their next session */
    } finally {
      setSubmitting(false);
      setOpen(false);
    }
  }

  function printTOS() {
    // Static PDF served from /termsofservice/TOS.pdf — opening it triggers
    // the browser's "save / print" affordance.
    const a = document.createElement("a");
    a.href = TOS_PDF_PATH;
    a.download = "TOS.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!username) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* not dismissible by overlay click */ }}>
      <DialogContent
        className="max-w-2xl p-0 overflow-hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-5 pb-3 border-b bg-gradient-to-br from-primary/10 via-transparent to-transparent">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-4 w-4 text-primary" />
            Terms of Service &amp; End-User Agreement
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            JOAP Hardware Trading ERP · v{TOS_VERSION} · Issued for SOFTENG 2 fulfilment
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
              ("<strong>the System</strong>"), developed by
              {" "}<strong>Cabilao Keane Andre B.</strong>,
              {" "}<strong>Ebona John Marwin R.</strong>, and
              {" "}<strong>Mirasol Prince Marl Lizandrelle D.</strong>
              {" "}("<strong>the Developers</strong>") as part of the fulfilment of
              {" "}<em>Software Engineering 2</em> coursework, and delivered to
              JOAP Hardware Trading ("<strong>the Client</strong>") pursuant to feedback
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
              By clicking <strong>"I Agree &amp; Continue"</strong>, the Client acknowledges
              and accepts that the System is academic coursework provided in good faith
              and that the Developers shall not be liable for any direct, indirect,
              incidental, consequential, or punitive losses (including but not limited
              to lost revenue, lost inventory, missed sales opportunities, regulatory
              fines, customer disputes, or data corruption) arising from the use,
              misuse, or unavailability of the System beyond the documented scope above.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">3. Data &amp; Privacy</h3>
            <p>
              All transactional data is stored in a MongoDB cluster operated by the
              Client. Daily JSON backups are emailed to the address configured in
              <em> Maintenance → Backup Email</em>. The Developers do not access live
              Client data except when explicitly granted credentials by the Client for
              the purpose of bug-fixing or migration support.
            </p>

            <hr className="border-border" />
            <h3 className="text-base font-semibold pt-1">4. Support &amp; Maintenance</h3>
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
              <strong> "I Agree &amp; Continue"</strong>, the Client confirms that they have
              read, understood, and accept every clause above on behalf of JOAP
              Hardware Trading.
            </p>

            <p className="text-[11px] text-muted-foreground pt-3 border-t">
              Cabilao Keane Andre B., Ebona John Marwin R., Mirasol Prince Marl Lizandrelle D. <br/>
              JOAP Hardware Trading ERP — issued under the Software Engineering 2 deliverables programme.
            </p>
          </div>
        </ScrollArea>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-3 bg-muted/30 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn("text-xs", scrolledEnd ? "text-emerald-600 font-medium" : "text-muted-foreground")}>
              {scrolledEnd ? "✓ End of document reached" : "Scroll to the end to enable the Continue button."}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={printTOS}
              data-testid="tos-print"
              className="h-7 text-xs"
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Print TOS
            </Button>
          </div>
          <Button
            onClick={accept}
            disabled={!scrolledEnd || submitting}
            data-testid="tos-continue"
            className="min-w-[180px]"
          >
            <Check className="mr-2 h-4 w-4" />
            {submitting ? "Saving…" : "I Agree & Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
