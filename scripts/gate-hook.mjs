#!/usr/bin/env node
/**
 * Stop hook for the site's gate (registered in .claude/settings.json, so it runs only in this project's
 * sessions). When a file the gate covers has changed since the last passing `node scripts/gate.mjs`, it
 * holds the turn once and names the files, so "edited, then said it was clean" cannot happen unnoticed.
 * It never holds twice in a row (`stop_hook_active`), never holds a session working elsewhere, and any
 * error of its own lets the turn end: a broken guard must never trap a session.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprints } from "./gate-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  if (event.stop_hook_active) return;
  const cwd = path.resolve(event.cwd || process.cwd());
  const rel = path.relative(ROOT, cwd);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return;
  let pass = {};
  try {
    pass = JSON.parse(readFileSync(path.join(ROOT, ".gate", "pass.json"), "utf8")).files ?? {};
  } catch {
    /* no pass recorded yet: everything counts as changed */
  }
  const now = fingerprints(ROOT);
  const changed = [...new Set([...Object.keys(now), ...Object.keys(pass)])].filter((f) => now[f] !== pass[f]).sort();
  if (!changed.length) return;
  const list = changed.slice(0, 12).map((f) => `    ${f}${now[f] ? "" : " (removed)"}`).join("\n");
  const more = changed.length > 12 ? `\n    …and ${changed.length - 12} more` : "";
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `SITE GATE IS STALE and this turn is ending. These changed since the last passing gate:\n${list}${more}\n\nRun \`node scripts/gate.mjs\` (pipeline syntax, astro check, production build) and report what it ACTUALLY prints. If it fails, say so plainly. This block fires once; it will not fire again this turn.`,
  }));
}

try {
  main();
} catch {
  /* a broken guard must never trap the session */
}
