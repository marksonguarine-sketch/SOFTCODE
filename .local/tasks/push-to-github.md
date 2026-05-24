# Push Local Codebase to GitHub

## What & Why
A `git rebase` is currently in progress with one conflict: `server/vite.ts` was deleted in a prior commit during rebase but the local version (with HMR and process.exit fixes) must be kept. All local Replit files are correct and must be pushed to GitHub main branch without losing any changes.

## Done looks like
- Rebase conflict resolved in favor of local files
- Rebase completed successfully
- All local commits pushed to GitHub main branch
- No local code lost

## Out of scope
- Any code changes — this is purely a git operation

## Steps
1. **Resolve the conflict** — `server/vite.ts` is "deleted by us" in the rebase but the incoming commit has the correct version. Stage the file with `git add server/vite.ts` to accept it.
2. **Continue the rebase** — Run `GIT_EDITOR=true git rebase --continue` to apply the remaining commit and finish the rebase.
3. **Push to GitHub** — Run `git push origin main --force-with-lease` (or `--force` if needed) to push the full updated project to GitHub main.

## Relevant files
- `server/vite.ts`
