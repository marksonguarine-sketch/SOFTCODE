import { useMemo } from "react";
import { ArrowRight, GitCommit, Clock, User, Hammer } from "lucide-react";
import changelog from "@/changelog.generated.json";

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

// Categorize a commit by its subject so each entry gets a colored label chip,
// mimicking a "sassy" release-notes look.
function labelFor(subject: string): { text: string; cls: string } {
  const s = subject.toLowerCase();
  if (/(fix|bug|patch|hotfix)/.test(s)) return { text: "FIX", cls: "bg-red-500/15 text-red-300 ring-red-500/30" };
  if (/(add|new|implement|introduce|create)/.test(s)) return { text: "FEATURE", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" };
  if (/(refactor|clean|rename|move|reorganize)/.test(s)) return { text: "REFACTOR", cls: "bg-purple-500/15 text-purple-300 ring-purple-500/30" };
  if (/(update|change|tweak|improve|polish|enhance|adjust)/.test(s)) return { text: "UPDATE", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" };
  if (/(build|deploy|ci|release|bump|pin|config)/.test(s)) return { text: "BUILD", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" };
  if (/(doc|readme|comment|session)/.test(s)) return { text: "DOCS", cls: "bg-slate-500/20 text-slate-300 ring-slate-500/30" };
  return { text: "CHORE", cls: "bg-slate-500/20 text-slate-300 ring-slate-500/30" };
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

export function DevTimeLog({ onProceed }: { onProceed: () => void }) {
  const commits = (changelog.commits as Commit[]) || [];
  const total = changelog.total ?? commits.length;

  // Group commits by calendar day for a timeline feel.
  const groups = useMemo(() => {
    const map = new Map<string, Commit[]>();
    for (const c of commits) {
      const day = new Date(c.date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(c);
    }
    return Array.from(map.entries());
  }, [commits]);

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100">
      {/* Decorative glow */}
      <div className="pointer-events-none fixed inset-0 opacity-40 [background:radial-gradient(60rem_40rem_at_70%_-10%,rgba(99,102,241,0.25),transparent),radial-gradient(50rem_30rem_at_-10%_20%,rgba(16,185,129,0.18),transparent)]" />

      <div className="relative mx-auto max-w-3xl px-5 py-12 sm:px-8">
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 shadow-lg shadow-indigo-500/30">
            <Hammer className="h-8 w-8 text-white" />
          </div>
          <h1 className="bg-gradient-to-r from-indigo-300 via-sky-200 to-emerald-300 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
            DEVELOPERS TIME LOG
          </h1>
          <p className="mt-3 max-w-xl text-sm text-slate-400">
            Every line of sweat, shipped. A complete, timestamped chronicle of what we
            built for <span className="font-semibold text-slate-200">JOAP Hardware Trading</span> — straight from the git history.
            <span className="block mt-1 text-slate-500">{total} commits and counting. Scroll the whole story. 🔨</span>
          </p>

          <button
            onClick={onProceed}
            data-testid="button-proceed-system"
            className="group mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 px-7 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.03] hover:shadow-indigo-500/50 active:scale-95"
          >
            Proceed to the System
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* Timeline */}
        <div className="mt-12">
          <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            <span className="h-px flex-1 bg-slate-700/60" />
            Logs
            <span className="h-px flex-1 bg-slate-700/60" />
          </div>

          {commits.length === 0 && (
            <p className="text-center text-sm text-slate-500">No commit history was bundled with this build.</p>
          )}

          <div className="space-y-8">
            {groups.map(([day, dayCommits]) => (
              <div key={day}>
                <div className="sticky top-0 z-10 -mx-1 mb-3 bg-slate-950/70 px-1 py-1 backdrop-blur">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80">{day}</span>
                </div>
                <div className="relative space-y-3 border-l border-slate-700/60 pl-5">
                  {dayCommits.map((c) => {
                    const label = labelFor(c.subject);
                    return (
                      <div key={c.hash} className="relative" data-testid={`commit-${c.shortHash}`}>
                        {/* Node dot */}
                        <span className="absolute -left-[1.45rem] top-1.5 flex h-3 w-3 items-center justify-center">
                          <span className="h-3 w-3 rounded-full bg-gradient-to-br from-indigo-400 to-emerald-400 ring-4 ring-slate-950" />
                        </span>
                        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 transition-colors hover:border-indigo-500/40 hover:bg-slate-800/70">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${label.cls}`}>
                              {label.text}
                            </span>
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                              <GitCommit className="h-3 w-3" />{c.shortHash}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <Clock className="h-3 w-3" />{fmtDateTime(c.date)}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <User className="h-3 w-3" />{c.author}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-snug text-slate-100">{c.subject}</p>
                          {c.body && (
                            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-slate-400">{c.body}</pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4">
            <p className="text-xs text-slate-600">— end of log —</p>
            <button
              onClick={onProceed}
              data-testid="button-proceed-system-bottom"
              className="group inline-flex items-center gap-2 rounded-full border border-slate-600 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-200 transition-all hover:border-indigo-400 hover:text-white"
            >
              Proceed to the System
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
