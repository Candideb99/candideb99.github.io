#!/usr/bin/env node
/**
 * The control room's sync with the cloud (SYNC in scripts/control-room.mjs), run before every job it starts and before
 * every push. `git pull --rebase --autostash` exits 0 when putting the desk's own uncommitted changes back conflicts, and
 * leaves conflict markers behind: every local run rewrites pipeline/runs/latest.json and every cloud run commits it, so
 * the markers landed there, the next sync failed ("Exiting because of an unresolved conflict") and no job could start,
 * and Publish would have committed the markers (a review of 2026-10-31, reproduced in a test repository). So the last
 * run's summary, which every run rewrites, is the cloud's again before pulling (each local run keeps its own report
 * beside it); anything still unmerged after the pull takes the cloud's version, its local version kept in `git stash`,
 * and the job stops saying so; a rebase that stops half way is undone. The state files merge entry by entry
 * (scripts/merge-state.mjs, named in .gitattributes).
 *
 *   node scripts/sync.mjs [remote] [branch]     (default: pages main)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [remote = "pages", branch = "main"] = process.argv.slice(2);
const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const REGENERATED = ["pipeline/runs/latest.json"];

for (const file of REGENERATED) if (git("diff", "--quiet", "--", file).status === 1) git("checkout", "--", file);
const pull = git("pull", "--rebase", "--autostash", "-X", "theirs", remote, branch);
process.stdout.write(pull.stdout ?? "");
process.stderr.write(pull.stderr ?? "");
const gitDir = git("rev-parse", "--git-dir").stdout.trim() || ".git";
if (existsSync(path.join(gitDir, "rebase-merge")) || existsSync(path.join(gitDir, "rebase-apply"))) {
  git("rebase", "--abort");
  console.error("sync: the cloud's commits could not be laid under this copy's; nothing was changed. Publish or discard the local commits, then sync again.");
  process.exit(1);
}
const unmerged = git("diff", "--name-only", "--diff-filter=U").stdout.split("\n").filter(Boolean);
if (unmerged.length) {
  for (const file of unmerged) git("checkout", "HEAD", "--", file);
  console.error(`sync: ${unmerged.join(", ")} changed both here and in the cloud. The cloud's version is kept; this copy's is in \`git stash list\`.`);
  process.exit(1);
}
process.exit(pull.status ?? 1);
