#!/usr/bin/env node
/**
 * The site's gate: what must pass before a change to the paper's code is reported as done.
 *
 *   node scripts/gate.mjs
 *
 * 1. every pipeline and tool script parses (`node --check`), so a syntax slip cannot reach the cloud newsroom, uses no
 *    name it never defines (TypeScript over the JavaScript, scripts/tsconfig.names.json), and the lessons' decision
 *    rule decides its known cases correctly (scripts/evidence-selftest.mjs);
 * 2. `astro check` reports no errors;
 * 3. `npm run build` (the production build and its search index) succeeds;
 * 4. the built pages hold together for a reader (scripts/site-check.mjs: links, RTL, alt text, dates, sources).
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

// 1a. Every name a script uses is defined somewhere. Parsing cannot see it: the multi-provider rewrite of 2026-10-17
// dropped `const refusedLogin` from scripts/editor-precheck.mjs, which still parsed, and the daily editor's round died
// on a ReferenceError every morning until 2026-10-23. TypeScript reads the JavaScript (scripts/tsconfig.names.json);
// only "cannot find name" fails the gate, every other type message is ignored, and a config fault fails it too.
t = Date.now();
const names = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", path.join("scripts", "tsconfig.names.json")], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const undefinedNames = `${names.stdout ?? ""}${names.stderr ?? ""}`.split(/\r?\n/).filter((l) => /error TS(2304|2552|5\d{3}|18003):/.test(l));
if (names.error || undefinedNames.length) fail("names (scripts/tsconfig.names.json)", names.error ? String(names.error.message) : undefinedNames.join("\n"));
console.log(`[ok] every name the scripts use is defined (${seconds(t)})`);

t = Date.now();
const llm = spawnSync(process.execPath, [path.join("scripts", "llm-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (llm.status !== 0) fail("OpenAI requests (scripts/llm-selftest.mjs)", llm.stdout + llm.stderr);
console.log(`[ok] OpenAI requests and connection test pass offline (${seconds(t)})`);

t = Date.now();
const codex = spawnSync(process.execPath, [path.join("scripts", "codex-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (codex.status !== 0) fail("ChatGPT subscription (scripts/codex-selftest.mjs)", codex.stdout + codex.stderr);
console.log(`[ok] ChatGPT subscription authentication and requests pass offline (${seconds(t)})`);

t = Date.now();
const accounts = spawnSync(process.execPath, [path.join("scripts", "accounts-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (accounts.status !== 0) fail("ChatGPT account switching (scripts/accounts-selftest.mjs)", accounts.stdout + accounts.stderr);
console.log(`[ok] Account switching, expiry reminders and encrypted cloud sign-in pass offline (${seconds(t)})`);

t = Date.now();
const pool = spawnSync(process.execPath, [path.join("scripts", "codex-pool-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (pool.status !== 0) fail("ChatGPT quota fallback (scripts/codex-pool-selftest.mjs)", pool.stdout + pool.stderr);
console.log(`[ok] ChatGPT primary/backup quotas and reset decisions pass offline (${seconds(t)})`);

// 1b. The lessons' decision rule decides its known cases correctly (scripts/evidence-selftest.mjs, 2026-09-25).
t = Date.now();
const selftest = spawnSync(process.execPath, [path.join("scripts", "evidence-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (selftest.status !== 0) fail("the lessons' decision rule (scripts/evidence-selftest.mjs)", selftest.stdout + selftest.stderr);
console.log(`[ok] the lessons' decision rule passes its known cases (${seconds(t)})`);

// 1c. The newsroom's safeguards decide their known cases correctly (scripts/pipeline-selftest.mjs, 2026-09-26): the
// check before publication, the duplicate rule, the lessons' lint, the state files.
t = Date.now();
const safeguards = spawnSync(process.execPath, [path.join("scripts", "pipeline-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (safeguards.status !== 0) fail("the newsroom's safeguards (scripts/pipeline-selftest.mjs)", safeguards.stdout + safeguards.stderr);
console.log(`[ok] the newsroom's safeguards pass their known cases (${seconds(t)})`);

// 1c-1. «من زمن الفكرة»: every drawing of an idea's time is free, kept at its size, captioned and printed by its idea
// (scripts/exhibits-selftest.mjs, 2026-11-22).
t = Date.now();
const exhibits = spawnSync(process.execPath, [path.join("scripts", "exhibits-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (exhibits.status !== 0) fail("the ideas' period drawings (scripts/exhibits-selftest.mjs)", exhibits.stdout + exhibits.stderr);
console.log(`[ok] the ideas' period drawings are free, kept and printed by their idea (${seconds(t)})`);

t = Date.now();
const newsEvidence = spawnSync(process.execPath, [path.join("scripts", "news-evidence-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (newsEvidence.status !== 0) fail("news evidence collection (scripts/news-evidence-selftest.mjs)", newsEvidence.stdout + newsEvidence.stderr);
console.log(`[ok] source metadata, cited primary documents and fetch failures pass offline (${seconds(t)})`);

// 1c-2. The economic calendar's readers decide the institutions' own markup correctly (scripts/calendar-selftest.mjs,
// 2026-11-15): a vote on paper had been stored as a rate decision and a day's events ran out of the order of their hours.
t = Date.now();
const agenda = spawnSync(process.execPath, [path.join("scripts", "calendar-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (agenda.status !== 0) fail("the economic calendar (scripts/calendar-selftest.mjs)", agenda.stdout + agenda.stderr);
console.log(`[ok] the calendar's readers, order and stored fallbacks pass offline (${seconds(t)})`);

// 1d. The picture desk decides its known cases correctly (scripts/images-selftest.mjs, 2026-09-28): the cascade's
// order, the place filter, the repeat guard, accented names, namesake towns, and every library failing at once.
t = Date.now();
const pictures = spawnSync(process.execPath, [path.join("scripts", "images-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (pictures.status !== 0) fail("the picture desk (scripts/images-selftest.mjs)", pictures.stdout + pictures.stderr);
console.log(`[ok] the picture desk passes its known cases (${seconds(t)})`);

// 1e. The contact form's endpoint and inbox (functions/api, Cloudflare Pages Functions, which no build here runs)
// decide their known cases correctly (scripts/contact-selftest.mjs, 2026-11-19).
t = Date.now();
const contact = spawnSync(process.execPath, [path.join("scripts", "contact-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (contact.status !== 0) fail("the contact form (scripts/contact-selftest.mjs)", contact.stdout + contact.stderr);
console.log(`[ok] the contact form's endpoint and inbox pass their known cases (${seconds(t)})`);

// 1f. The news clock decides its known cases, and every scheduled line of the newsroom keeps one slot a day
// (scripts/news-clock-selftest.mjs, 2026-11-20): GitHub drops a line's slots while one firing waits, 8-9 hours by then.
t = Date.now();
const newsClock = spawnSync(process.execPath, [path.join("scripts", "news-clock-selftest.mjs")], { cwd: ROOT, encoding: "utf8" });
if (newsClock.status !== 0) fail("the news clock (scripts/news-clock-selftest.mjs)", newsClock.stdout + newsClock.stderr);
console.log(`[ok] the news clock and the one-slot lines pass their known cases (${seconds(t)})`);

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
  // 3a. No page pays for the whole archive (2026-11-15). The section bar's panels read every story against every
  // sub-topic's terms again on each page: about a second a page, so the build grew with the square of the archive, reached
  // 17 to 28 minutes at 660 stories and was cut at the deploy's 20-minute limit on most runs for five days. Astro prints
  // each page's time; the middle one is a few milliseconds when shared work is done once per build (src/lib/topics.ts).
  if (name === "npm run build") {
    const slow = slowPages(out);
    if (slow) fail("the build's time per page", slow);
  }
}

/** The build's pages by Astro's own clock («(+12ms)», «(+1.20s)»): a message when the middle page takes too long. */
function slowPages(out) {
  const LIMIT_MS = 250;
  const times = [...String(out).replace(/\u001b\[[0-9;]*m/g, "").matchAll(/\.html\s+\(\+([\d.]+)(ms|s)\)/g)].map((m) => Number(m[1]) * (m[2] === "s" ? 1000 : 1)).sort((a, b) => a - b);
  if (times.length < 50) return "";
  const middle = times[Math.floor(times.length / 2)];
  console.log(`[ok] ${times.length} pages built, the middle one in ${Math.round(middle)} ms`);
  if (middle <= LIMIT_MS) return "";
  return `The middle page of ${times.length} took ${Math.round(middle)} ms to build (limit ${LIMIT_MS} ms): something reads the whole archive on every page.\nFind it with a CPU profile of the build (.claude/rules/operations.md, 2026-11-15) and compute it once per build.`;
}

// 4. What a reader meets on the built site: links, Arabic right-to-left pages, alt text, dates, sources (2026-09-26).
t = Date.now();
const site = spawnSync(process.execPath, [path.join("scripts", "site-check.mjs")], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (site.status !== 0) fail("the built site's check (scripts/site-check.mjs)", site.stdout + site.stderr);
console.log(`[ok] the built site's pages, links, images, dates and sources (${seconds(t)})`);

const files = fingerprints(ROOT);
mkdirSync(path.join(ROOT, ".gate"), { recursive: true });
writeFileSync(path.join(ROOT, ".gate", "pass.json"), JSON.stringify({ at: new Date().toISOString(), files }, null, 1));
console.log(`\nGATE PASSED in ${seconds(started)}. Recorded ${Object.keys(files).length} file fingerprints in .gate/pass.json.`);
