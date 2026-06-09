#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Dev-log commit listener
//
// This is the "middleware" that listens for git commits and auto-saves them into
// client/src/devlogs/devlogs.json — the same store the Developers Time Log screen
// reads from. It is wired up through the git hooks in `.githooks/` (post-commit
// fires on every commit, post-merge fires after a pull/merge brings new commits
// in). You can also run it by hand to backfill:
//
//     node script/devlog-from-git.mjs --latest      # log HEAD (default)
//     node script/devlog-from-git.mjs --sync 20      # log the last 20 commits
//     node script/devlog-from-git.mjs --range A..B   # log a commit range
//
// It writes new entries in exactly the shape the UI expects:
//   { id, date, label, title, body, commit }
// `commit` is the short hash — it is purely for de-duplication (the UI ignores
// unknown fields) so re-running the script never logs the same commit twice.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEVLOG_PATH = join(REPO_ROOT, "client", "src", "devlogs", "devlogs.json");

// ── tiny git helper ──────────────────────────────────────────────────────────
function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

// ── derive a devlog LABEL from a commit subject ──────────────────────────────
// Mirrors the labels the UI knows how to colour: FEATURE / FIX / UI /
// PERFORMANCE / SETUP / DOCS. Understands conventional-commit prefixes
// (feat:, fix(scope):, …) and falls back to keyword sniffing.
function labelFor(subject) {
  const s = subject.toLowerCase();
  const conv = s.match(/^(\w+)(\([^)]*\))?!?:/);
  const type = conv ? conv[1] : "";
  const map = {
    feat: "FEATURE", feature: "FEATURE",
    fix: "FIX", bug: "FIX", bugfix: "FIX", hotfix: "FIX", revert: "FIX",
    ui: "UI", style: "UI", design: "UI",
    perf: "PERFORMANCE",
    docs: "DOCS", doc: "DOCS",
    chore: "SETUP", build: "SETUP", ci: "SETUP", config: "SETUP",
    setup: "SETUP", init: "SETUP", refactor: "SETUP", test: "SETUP",
  };
  if (map[type]) return map[type];
  if (/\b(fix|bug|patch|resolve[sd]?)\b/.test(s)) return "FIX";
  if (/\b(ui|css|style|layout|design|theme|button|modal|dialog)\b/.test(s)) return "UI";
  if (/\b(perf|performance|optimi[sz]e|faster|speed|cache)\b/.test(s)) return "PERFORMANCE";
  if (/\b(doc|docs|readme|manual|comment)\b/.test(s)) return "DOCS";
  if (/\b(setup|config|chore|deps?|dependenc|build|deploy|ci)\b/.test(s)) return "SETUP";
  return "FEATURE";
}

// Strip a conventional-commit prefix so the title reads like a sentence.
function cleanTitle(subject) {
  const stripped = subject.replace(/^(\w+)(\([^)]*\))?!?:\s*/, "").trim();
  return stripped || subject;
}

// Build a human body. Prefer the commit's own body; otherwise summarise the
// files that changed so the entry still carries information.
function bodyFor(hash, rawBody) {
  const body = (rawBody || "").trim();
  if (body) return body;
  let files = [];
  try {
    files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", hash])
      .split("\n").map((f) => f.trim()).filter(Boolean);
  } catch { /* ignore */ }
  if (files.length === 0) return "";
  const shown = files.slice(0, 6).join(", ");
  const more = files.length > 6 ? `, +${files.length - 6} more` : "";
  return `Touched ${files.length} file${files.length !== 1 ? "s" : ""}: ${shown}${more}.`;
}

// ── resolve which commits to process ─────────────────────────────────────────
function resolveHashes(argv) {
  const arg = argv[0];
  if (arg === "--sync" || arg === "--count") {
    const n = parseInt(argv[1] || "10", 10) || 10;
    return git(["log", `-n${n}`, "--format=%H", "--reverse"]).split("\n").filter(Boolean);
  }
  if (arg === "--range") {
    return git(["log", argv[1], "--format=%H", "--reverse"]).split("\n").filter(Boolean);
  }
  // default: just HEAD
  return [git(["rev-parse", "HEAD"])];
}

function main() {
  // Bail quietly if this isn't a usable repo or the store is missing — a hook
  // must never block a commit.
  try { git(["rev-parse", "--is-inside-work-tree"]); } catch { return; }
  if (!existsSync(DEVLOG_PATH)) return;

  let store;
  try {
    store = JSON.parse(readFileSync(DEVLOG_PATH, "utf8"));
  } catch (e) {
    console.error("[devlog] could not parse devlogs.json:", e.message);
    return;
  }
  if (!Array.isArray(store.logs)) store.logs = [];

  const known = new Set(store.logs.map((l) => l.commit).filter(Boolean));
  let nextNum = store.logs.reduce((max, l) => {
    const m = /^l(\d+)$/.exec(l.id || "");
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  let hashes;
  try { hashes = resolveHashes(process.argv.slice(2)); } catch { return; }

  let added = 0;
  for (const hash of hashes) {
    const short = hash.slice(0, 9);
    if (known.has(short)) continue;

    const subject = git(["show", "-s", "--format=%s", hash]);
    // Never log the dev-log's own bookkeeping commits, or merge commits
    // (post-merge already records the branch tips that matter).
    if (/^devlog[:\s]/i.test(subject)) continue;
    const parents = git(["show", "-s", "--format=%P", hash]).split(" ").filter(Boolean);
    if (parents.length > 1) continue;

    const rawBody = git(["show", "-s", "--format=%b", hash]);
    const date = git(["show", "-s", "--format=%cI", hash]);

    const entry = {
      id: `l${++nextNum}`,
      date,
      label: labelFor(subject),
      title: cleanTitle(subject),
      body: bodyFor(hash, rawBody),
      commit: short,
    };
    store.logs.unshift(entry); // newest-first, matching the existing store
    known.add(short);
    added++;
  }

  if (added === 0) return;

  writeFileSync(DEVLOG_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");

  // Stage the updated store so it rides along with the next commit (we never
  // auto-commit or amend — that would rewrite history and could fight a push).
  try { git(["add", DEVLOG_PATH]); } catch { /* ignore */ }

  console.log(`[devlog] +${added} entr${added === 1 ? "y" : "ies"} → client/src/devlogs/devlogs.json`);
}

main();
