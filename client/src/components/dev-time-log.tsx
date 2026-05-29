import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitCommit, Clock, User, Hammer, Loader2, GitBranch } from "lucide-react";
import bundled from "@/changelog.generated.json";

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

// Public repo — the Time Log pulls the live commit history from GitHub so it is
// always current, and falls back to the changelog baked at build time.
const REPO = "marksonguarine-sketch/SOFTCODE";

function labelFor(subject: string): { text: string; cls: string } {
  const s = subject.toLowerCase();
  if (/(fix|bug|patch|hotfix)/.test(s)) return { text: "FIX", cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30" };
  if (/(add|new|implement|introduce|create|feat)/.test(s)) return { text: "FEATURE", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" };
  if (/(refactor|clean|rename|move|reorganize)/.test(s)) return { text: "REFACTOR", cls: "bg-violet-500/10 text-violet-300 ring-violet-500/30" };
  if (/(update|change|tweak|improve|polish|enhance|adjust)/.test(s)) return { text: "UPDATE", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" };
  if (/(build|deploy|ci|release|bump|pin|config)/.test(s)) return { text: "BUILD", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30" };
  if (/(doc|readme|comment|session)/.test(s)) return { text: "DOCS", cls: "bg-slate-400/10 text-slate-300 ring-slate-400/25" };
  return { text: "CHORE", cls: "bg-slate-400/10 text-slate-300 ring-slate-400/25" };
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

async function fetchGitHubCommits(): Promise<Commit[]> {
  const out: Commit[] = [];
  // Up to 3 pages × 100 = 300 commits, plenty for this project.
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const c of data) {
      const msg: string = c.commit?.message || "";
      const nl = msg.indexOf("\n");
      out.push({
        hash: c.sha,
        shortHash: (c.sha || "").slice(0, 7),
        author: c.commit?.author?.name || c.author?.login || "Unknown",
        date: c.commit?.author?.date || "",
        subject: (nl === -1 ? msg : msg.slice(0, nl)).trim(),
        body: (nl === -1 ? "" : msg.slice(nl + 1)).trim(),
      });
    }
    if (data.length < 100) break;
  }
  return out;
}

export function DevTimeLog({ onProceed }: { onProceed: () => void }) {
  const [commits, setCommits] = useState<Commit[]>(() => (bundled.commits as Commit[]) || []);
  const [source, setSource] = useState<"bundled" | "live" | "loading">("loading");

  useEffect(() => {
    let alive = true;
    fetchGitHubCommits()
      .then((live) => {
        if (!alive || live.length === 0) { setSource("bundled"); return; }
        setCommits(live);
        setSource("live");
      })
      .catch(() => { if (alive) setSource("bundled"); });
    return () => { alive = false; };
  }, []);

  const total = commits.length;

  const groups = useMemo(() => {
    const map = new Map<string, Commit[]>();
    for (const c of commits) {
      const day = c.date
        ? new Date(c.date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
        : "Undated";
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(c);
    }
    return Array.from(map.entries());
  }, [commits]);

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#0a0e1a] text-slate-100">
      {/* Subtle grid + glow backdrop */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(50rem 34rem at 75% -8%, rgba(56,189,248,0.16), transparent), radial-gradient(44rem 30rem at -10% 10%, rgba(99,102,241,0.16), transparent)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative mx-auto max-w-3xl px-5 py-14 sm:px-8">
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 ring-1 ring-white/10 shadow-2xl shadow-sky-500/10">
            <Hammer className="h-7 w-7 text-sky-300" />
          </div>
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400 ring-1 ring-white/10">
            <GitBranch className="h-3 w-3" /> JOAP Hardware Trading
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-[2.6rem] sm:leading-tight">
            Developers Time Log
          </h1>
          <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-slate-400">
            A complete, timestamped record of everything engineered for the system — sourced directly from the
            project's version control history.
          </p>
          <p className="mt-2 text-[12.5px] text-slate-500">
            {source === "loading" ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading commit history…</span>
            ) : (
              <>{total} commits · {source === "live" ? "live from GitHub" : "bundled with this build"}</>
            )}
          </p>

          <button
            onClick={onProceed}
            data-testid="button-proceed-system"
            className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-semibold text-slate-900 shadow-lg transition-all hover:bg-slate-100 active:scale-[0.98]"
          >
            Proceed to the System
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        {/* Timeline */}
        <div className="mt-14">
          <div className="mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            <span className="h-px flex-1 bg-white/10" />
            Changelog
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {total === 0 && source !== "loading" && (
            <p className="text-center text-sm text-slate-500">No commit history is available.</p>
          )}

          <div className="space-y-9">
            {groups.map(([day, dayCommits]) => (
              <div key={day}>
                <div className="sticky top-0 z-10 -mx-1 mb-4 bg-[#0a0e1a]/85 px-1 py-1.5 backdrop-blur">
                  <span className="text-[12px] font-semibold tracking-wide text-sky-300/90">{day}</span>
                  <span className="ml-2 text-[11px] text-slate-600">{dayCommits.length} commit{dayCommits.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="relative space-y-3 border-l border-white/10 pl-6">
                  {dayCommits.map((c) => {
                    const label = labelFor(c.subject);
                    return (
                      <div key={c.hash} className="relative" data-testid={`commit-${c.shortHash}`}>
                        <span className="absolute -left-[1.65rem] top-2 h-2.5 w-2.5 rounded-full bg-sky-400 ring-4 ring-[#0a0e1a]" />
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-sky-400/30 hover:bg-white/[0.06]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${label.cls}`}>
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
                          <p className="mt-2 text-[14px] font-semibold leading-snug text-slate-100">{c.subject}</p>
                          {c.body && (
                            <pre className="mt-2 max-h-64 overflow-hidden whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-slate-400">{c.body}</pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center gap-4">
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-700">End of log</p>
            <button
              onClick={onProceed}
              data-testid="button-proceed-system-bottom"
              className="group inline-flex items-center gap-2 rounded-lg border border-white/15 px-6 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:border-white/40 hover:text-white"
            >
              Proceed to the System
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
