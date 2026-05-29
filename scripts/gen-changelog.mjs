// Generates client/src/changelog.generated.json from the full git history.
//
// The "Developers Time Log" screen (shown after the boot loader) reads this
// file. We bake it at build time so production never needs git at runtime.
//
// Run manually after committing:  node scripts/gen-changelog.mjs
// It is also wired into the build via the "prebuild" npm script.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../client/src/changelog.generated.json");

// Field + record separators that won't appear in commit text.
const FS = "\x1f";
const RS = "\x1e";

let raw = "";
try {
  raw = execSync(
    `git log --no-merges --pretty=format:"%H${FS}%h${FS}%an${FS}%aI${FS}%s${FS}%b${RS}"`,
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
} catch (err) {
  console.error("[gen-changelog] git log failed — writing empty changelog.", err.message);
  raw = "";
}

const commits = raw
  .split(RS)
  .map((chunk) => chunk.replace(/^\s+/, ""))
  .filter(Boolean)
  .map((chunk) => {
    const [hash, shortHash, author, date, subject, body] = chunk.split(FS);
    return {
      hash,
      shortHash,
      author,
      date,
      subject: (subject || "").trim(),
      body: (body || "").trim(),
    };
  })
  .filter((c) => c.hash);

// Never clobber a good bundled changelog with an empty one. On CI/deploy hosts
// without a .git directory (e.g. Railway/nixpacks) `git log` yields nothing —
// in that case keep whatever was committed so the Time Log still has data.
if (commits.length === 0 && existsSync(OUT)) {
  try {
    const existing = JSON.parse(readFileSync(OUT, "utf8"));
    if (Array.isArray(existing.commits) && existing.commits.length > 0) {
      console.log(`[gen-changelog] git produced 0 commits — keeping existing ${existing.commits.length} from ${OUT}`);
      process.exit(0);
    }
  } catch { /* fall through and write empty */ }
}

const payload = {
  generatedAt: new Date().toISOString(),
  total: commits.length,
  commits, // newest first (git log default)
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`[gen-changelog] Wrote ${commits.length} commits to ${OUT}`);
