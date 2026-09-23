#!/usr/bin/env node
/**
 * The site's gate: what must pass before a change to the paper's code is reported as done.
 *
 *   node scripts/gate.mjs
 *
 * 1. every pipeline and tool script parses (`node --check`), so a syntax slip cannot reach the cloud newsroom;
 * 2. `astro check` reports no errors;
 * 3. `npm run build` (the production build and its search index) succeeds.
 *
 * On success it records the fingerprint of every covered file (scripts/gate-files.mjs) in .gate/pass.json.
 * The Stop hook (scripts/gate-hook.mjs, registered in .claude/settings.json) holds a turn once when any of
 * them has changed since. Why it exists, 2026-09-23: a change that looked finished (a `related` prop added
 * to the cover) failed `astro check` with an implicit-any error, and was caught only because the check was
 * run by hand. On failure nothing is recorded, and the output says which step failed and how.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateFiles, fingerprints } from "./gate-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const started = Date.now();
const tail = (text, n = 30) => String(text ?? "").trim().split(/\r?\n/).slice(-n).join("\n");
const seconds = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

function fail(step, output) {
  console.log(`\nGATE FAILED at ${step}. Nothing is recorded; fix it and run the gate again.\n`);
  console.log(tail(output));
  process.exit(1);
}

// 1. Every script parses.
let t = Date.now();
const scripts = gateFiles(ROOT).filter((f) => f.endsWith(".mjs"));
for (const f of scripts) {
  const r = spawnSync(process.execPath, ["--check", f], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) fail(`node --check ${f}`, r.stderr || r.stdout);
}
console.log(`[ok] ${scripts.length} scripts parse (${seconds(t)})`);

// 2 and 3. The type check and the production build, as the project runs them.
for (const [name, command] of [["astro check", "npm run check"], ["npm run build", "npm run build"]]) {
  t = Date.now();
  // One command line through the shell (npm is a .cmd on Windows); nothing in it comes from outside.
  const r = spawnSync(command, { cwd: ROOT, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.status !== 0) fail(name, out);
  const errors = out.match(/-\s*(\d+)\s+errors?/);
  if (name === "astro check" && errors && Number(errors[1]) > 0) fail(name, out);
  console.log(`[ok] ${name} (${seconds(t)})`);
}

const files = fingerprints(ROOT);
mkdirSync(path.join(ROOT, ".gate"), { recursive: true });
writeFileSync(path.join(ROOT, ".gate", "pass.json"), JSON.stringify({ at: new Date().toISOString(), files }, null, 1));
console.log(`\nGATE PASSED in ${seconds(started)}. Recorded ${Object.keys(files).length} file fingerprints in .gate/pass.json.`);
