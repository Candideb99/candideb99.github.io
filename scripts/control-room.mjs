#!/usr/bin/env node
/**
 * خازندار Control Room — the editor's desk.
 *
 * THESIS: the newsroom runs itself, and the desk says so first. The owner's few decisions — approve a
 * draft he asked for, take a story down, put one on top, re-file one — sit one click away; everything
 * else is a fact he can read, not a control he must work. It refuses the dashboard-of-buttons.
 * OWN-WORLD: the paper's own materials. Paper and ink, hairline rules instead of boxes, one banknote
 * green for the primary action and the live "automatic" mark, the wordmark in Amiri, headlines in the
 * paper's naskh, everything else in the system sans. A left rail with four destinations.
 * STORY: he opens the desk, reads that the paper is running (next run, last run, every section's
 * freshness, the deploy light), and closes it — unless something waits for him.
 * FIRST VIEWPORT: rail on the left; a ruled status band across the top; the coverage strip; then
 * what waits for approval, then "need something now". Primary action = Publish, green, on the draft.
 * FORM: app shell with a left rail; ruled newspaper furniture. Operate mode; the paper's world inherited.
 *
 *   node scripts/control-room.mjs   →  http://127.0.0.1:7777, or the next free port (binds to 127.0.0.1 only)
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, unlink, writeFile, rm, mkdtemp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { codexStatus, CODEX_REASONING_EFFORT } from "../pipeline/lib/codex.mjs";
import { CLAUDE_EFFORTS, claudeEffort } from "../pipeline/lib/claude-effort.mjs";
import { accountById, listAccounts, beginAccountLogin, loginState, setAccountReminder, setAccountPool, readAccountStore } from "../pipeline/lib/codex-accounts.mjs";
import { validateCodexAuth } from "../pipeline/lib/codex-cloud.mjs";
import { readQuotaState, refreshAccountUsage } from "../pipeline/lib/codex-pool.mjs";

const root = process.cwd();
const PORT = Number(process.env.KHAZENDAR_CONTROL_PORT ?? 7777);
const SITE_FILE = path.join(root, "src", "data", "site.json");
const ARTICLES = path.join(root, "content", "articles");
const SEEN = path.join(root, "pipeline", "state", "seen.json");
const FONTS = path.join(root, "public", "fonts");
const site = JSON.parse(readFileSync(SITE_FILE, "utf8"));
const LIVE = site.url;
const REPO = "Candideb99/candideb99.github.io";
const REPO_URL = `https://github.com/${REPO}`;
const GIT_ID = ["-c", "user.name=khazendar-control", "-c", "user.email=newsroom@users.noreply.github.com"];
const NEWS_SECTIONS = ["economy", "markets", "energy", "companies", "technology"];
const SECTION_NAME = { economy: "الاقتصاد", markets: "الأسواق", energy: "الطاقة", companies: "الشركات", technology: "التكنولوجيا", analysis: "تحليلات", explainers: "مدخل إلى الاقتصاد" };
/** What the cloud runs on its own (newsroom.yml). UTC; the page shows it in the owner's local time. */
const SCHEDULE = [
  { what: "News stories", when: "every 3 hours, at :23 (GitHub keeps about four a day)", utc: null },
  { what: "Morning fill-in: one more news round when the morning has a gap (news-fill.yml)", when: "mornings, 06:00-10:30 UTC, once the last round started 2.5 hours ago", utc: null },
  { what: "An explainer", when: "daily", utc: "05:41" },
  { what: "An analysis", when: "daily", utc: "14:07" },
  { what: "A research paper", when: "Tuesdays and Fridays", utc: "09:31" },
  { what: "The week's review", when: "Fridays", utc: "15:37" },
  { what: "The flagship reports: new editions, from their publishers' own pages", when: "daily", utc: "08:17" },
  { what: "Second look and learning: the earlier stories re-read against their sources, the proved mistakes corrected and learned", when: "every news round, before it writes", utc: null },
  { what: "Editor's round: photos, freshness, the week's numbers", when: "daily", utc: "07:17" },
  { what: "Weekly lessons test: keep the new lessons or put back the last approved ones", when: "Mondays", utc: "06:13" },
  { what: "Market quotes and the calendar", when: "on every build, and every 2 hours", utc: null },
];

// ------------------------------------------------------------------ env / keys
function loadEnv() {
  const file = path.join(root, ".env");
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
function envFileKeys() {
  const file = path.join(root, ".env");
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].trim();
  }
  return out;
}
async function setEnvKey(name, value) {
  // One line per key: a value carrying a line break would write a second key of its choosing into .env.
  if (/[\r\n]/.test(String(value ?? ""))) throw new Error(`${name} must be one line.`);
  const file = path.join(root, ".env");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !new RegExp(`^\\s*${name}\\s*=`).test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (value) kept.push(`${name}=${value}`);
  kept.push("");
  await writeFile(file, kept.join("\n"), "utf8");
  if (value) process.env[name] = value;
  else delete process.env[name];
}
/** A secret goes to GitHub over stdin, never as an argument, so it never shows in a process list. */
function ghSecret(name, value) {
  const r = spawnSync("gh", ["secret", "set", name, "--repo", REPO], { input: value, encoding: "utf8", shell: false, windowsHide: true });
  return r.status === 0 ? "ok" : (r.stderr || r.stdout || "gh failed").slice(0, 200);
}
function ghArgs(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, shell: false, timeout: 30000 });
  if (r.status !== 0) throw new Error("GitHub could not complete that action. Check gh auth status and repository access.");
  return r.stdout.trim();
}
let cloudAccountChanging = false;
let cloudUsage = { accounts: {} };
async function refreshCloudUsage() {
  const { artifacts = [] } = JSON.parse(ghArgs(["api", `repos/${REPO}/actions/artifacts?name=chatgpt-usage&per_page=10`]));
  const latest = artifacts.filter((a) => !a.expired).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) throw new Error("No cloud allowance report yet. It appears after the first connected Sol run.");
  const temp = await mkdtemp(path.join(os.tmpdir(), "khazendar-cloud-usage-"));
  try {
    ghArgs(["run", "download", String(latest.workflow_run.id), "--repo", REPO, "--name", "chatgpt-usage", "--dir", temp]);
    const report = JSON.parse(await readFile(path.join(temp, "khazendar-chatgpt-usage.json"), "utf8"));
    cloudUsage = { updatedAt: report.updatedAt, active: report.active, accounts: Object.fromEntries(Object.entries(report.accounts || {}).map(([id, q]) => [id, { checkedAt: q.checkedAt, windows: q.windows, exhausted: q.exhausted, retryAt: q.retryAt }])) };
    return cloudUsage;
  } finally {
    if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("khazendar-cloud-usage-")) await rm(temp, { recursive: true, force: true });
  }
}
async function activateCloudAccount(id, backup = "") {
  if (cloudAccountChanging) throw new Error("A scheduled-publishing account connection is already in progress.");
  cloudAccountChanging = true;
  try { return await configureCloudAccount(id, backup); }
  finally { cloudAccountChanging = false; }
}
async function configureCloudAccount(id, backup = "") {
  const account = accountById(id);
  const pair = [account, ...(backup ? [accountById(backup)] : [])];
  if (pair.some((a) => a.target !== "cloud")) throw new Error("Connect separate account sessions for scheduled publishing first. This keeps cloud refreshes independent of the desktop login.");
  if (pair.length === 2 && (id === backup || (listAccounts().find((a) => a.id === id)?.email && listAccounts().find((a) => a.id === id)?.email === listAccounts().find((a) => a.id === backup)?.email))) throw new Error("Choose two different ChatGPT accounts; two sign-ins to one account share the same allowance.");
  try { ghArgs(["api", `repos/${REPO}/contents/scripts/codex-cloud-auth.mjs?ref=main`]); }
  catch { throw new Error("The Sol cloud integration is prepared locally but has not been deployed to main yet. Deploy it before changing the scheduled provider."); }
  const vars = ghArgs(["variable", "list", "--repo", REPO]);
  const currentPair = [(vars.match(/KHAZENDAR_CODEX_ACCOUNT\s+(\S+)/) ?? [])[1], ((vars.match(/KHAZENDAR_CODEX_BACKUP\s+(\S+)/) ?? [])[1] || "").replace(/^none$/, "")];
  if (currentPair[0] === id && currentPair[1] === backup && /KHAZENDAR_PROVIDER\s+codex/.test(vars)) return "These accounts are already connected for scheduled publishing. Their sessions refresh automatically.";
  if (/KHAZENDAR_PROVIDER\s+codex/.test(vars) && pair.some((a) => currentPair.includes(a.id))) throw new Error("That session is now managed by GitHub. Reconnect it before replacing the cloud account pair so an old refresh token cannot overwrite the live session.");
  const paused = /KHAZENDAR_PAUSED\s+1/.test(vars);
  let credentialsChanged = false, complete = false;
  ghArgs(["variable", "set", "KHAZENDAR_PAUSED", "--repo", REPO, "--body", "1"]);
  try {
    const runs = JSON.parse(ghArgs(["run", "list", "--repo", REPO, "--limit", "30", "--json", "status,workflowName"]));
    if (runs.some((r) => ["Newsroom", "Editor"].includes(r.workflowName) && ["in_progress", "queued", "waiting"].includes(r.status))) throw new Error("A cloud newsroom/editor run is still active. Let it finish before changing the account.");
    const quotaState = { accounts: {} }, accounts = [];
    for (const a of pair) {
      quotaState.accounts[a.id] = await refreshAccountUsage(a);
      accounts.push({ id: a.id, auth: validateCodexAuth(await readFile(path.join(a.home, "auth.json"), "utf8")) });
    }
    const auth = JSON.stringify({ version: 2, primary: id, backup, accounts, quotaState });
    validateCodexAuth(auth);
    const key = randomBytes(32).toString("hex");
    credentialsChanged = true;
    if (ghSecret("KHAZENDAR_CODEX_AUTH_JSON", auth) !== "ok" || ghSecret("KHAZENDAR_CODEX_STATE_KEY", key) !== "ok") throw new Error("GitHub refused the cloud sign-in secrets. The provider was not changed.");
    for (const [name, value] of [["KHAZENDAR_CODEX_SESSION", randomUUID()], ["KHAZENDAR_CODEX_ACCOUNT", id], ["KHAZENDAR_CODEX_BACKUP", backup || "none"], ["KHAZENDAR_CODEX_MODEL", "gpt-6.1-sol"], ["KHAZENDAR_MODEL", "gpt-6.1-sol"], ["KHAZENDAR_PROVIDER", "codex"]]) ghArgs(["variable", "set", name, "--repo", REPO, "--body", value]);
    complete = true;
    return "Scheduled publishing now uses gpt-6.1-sol through the selected ChatGPT account(s). The primary is preferred; an available backup is used only on quota exhaustion. Both exhausted: wait for a reported reset. No Platform API key is used.";
  } catch (error) {
    if (credentialsChanged) error.message += " Cloud runs remain paused until this connection is completed successfully.";
    throw error;
  } finally {
    if (!paused && (!credentialsChanged || complete)) ghArgs(["variable", "set", "KHAZENDAR_PAUSED", "--repo", REPO, "--body", "0"]);
  }
}

// --------------------------------------------------------------------- shell
/**
 * A program with its arguments as an array and no shell, so nothing a request carries can become a second command
 * (2026-10-23: `/writers` had put the model name it was sent into a shell line, and a page could run any program on
 * the laptop through it). Answers stdout and stderr together, trimmed; a program that cannot start answers its error.
 */
function exec(command, args, { raw = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: false, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    if (!raw) child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) => resolve(`error: ${error.message}`));
    child.on("close", () => resolve(raw ? out : out.trim()));
  });
}
async function porcelain() {
  // git status --porcelain puts a LEADING SPACE on unstaged changes; never trim its output.
  const out = await exec("git", ["status", "--porcelain"], { raw: true });
  const map = new Map();
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const file = line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop();
    if (file) map.set(file.replace(/\\/g, "/"), line.slice(0, 2));
  }
  return map;
}
/** Kill a job and everything it spawned; `child.kill()` alone leaves node→shell→node grandchildren alive on Windows. */
function killTree(child) {
  if (!child) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

// ----------------------------------------------------------------- the one job
const job = { running: null, name: "", kind: "", log: [], startedAt: null, exitCode: null, finishedAt: null, stopped: false };
function pushLog(line) {
  job.log.push(line);
  if (job.log.length > 3000) job.log.shift();
}
/**
 * Runs `steps`, [program, args] pairs, one after another and stops at the first that fails, as `a && b` did. No shell:
 * git and node are programs and take their arguments as they are. npm and npx are .cmd files on Windows, which Node
 * starts only through a shell; every argument they are given here is fixed in this file.
 */
function runJob(name, kind, steps, opts = {}) {
  if (job.running) return false;
  Object.assign(job, { name, kind, log: [], startedAt: Date.now(), exitCode: null, finishedAt: null, stopped: false });
  const env = { ...loadEnv(), ...(opts.env ?? {}) };
  const step = (i) => {
    const [command, args] = steps[i];
    pushLog(`$ ${command} ${args.join(" ")}`);
    const shell = process.platform === "win32" && (command === "npm" || command === "npx");
    const child = spawn(command === "node" ? process.execPath : command, args, { cwd: root, env, shell, windowsHide: true });
    job.running = child;
    const feed = (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach(pushLog);
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    let ended = false;
    const end = (code) => {
      if (ended) return;
      ended = true;
      if (code === 0 && !job.stopped && i + 1 < steps.length) return step(i + 1);
      job.exitCode = code;
      job.running = null;
      job.finishedAt = Date.now();
      pushLog(`— finished (${name}) with exit code ${code} —`);
    };
    child.on("error", (error) => {
      pushLog(error.message);
      end(1);
    });
    child.on("close", end);
  };
  step(0);
  return true;
}
/** The last log lines that mean something to an editor, not to a programmer. */
function progressLines() {
  const meaningful = job.log.filter((l) => /^(drafted|published|skip|desk|rejected|reading|fetched|selected|writing|critic|image|photo|candidates|stories|—)/i.test(l) || /"/.test(l));
  return meaningful.slice(-4).map((l) => l.replace(/^\$ .*/, "").slice(0, 180));
}
/** "2 of 4 written · 1 refused" — counted from the run's own log lines, so it is never a guess. */
function jobProgress() {
  const written = job.log.filter((l) => /\] (drafted|published) "/.test(l)).length;
  const refused = job.log.filter((l) => /\] (reject|skip) /.test(l)).length;
  const m = job.log[0]?.match(/--limit=(\d+)/);
  return { written, refused, target: m ? Number(m[1]) : null };
}

// ------------------------------------------------------------------- articles
function parseArticle(file, raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fm) return null;
  let d;
  try {
    d = YAML.parse(fm[1]);
  } catch {
    return null;
  }
  return { file, data: d, body: fm[2] ?? "" };
}
async function allArticles() {
  const files = (await readdir(ARTICLES)).filter((f) => f.endsWith(".md"));
  const status = await porcelain();
  const out = [];
  for (const file of files) {
    const parsed = parseArticle(file, await readFile(path.join(ARTICLES, file), "utf8"));
    if (!parsed) continue;
    const d = parsed.data;
    const untracked = (status.get(`content/articles/${file}`) ?? "").includes("?");
    out.push({
      file,
      slug: d.slug,
      title: d.title,
      subtitle: d.subtitle ?? "",
      section: d.section,
      kind: d.kind ?? "news",
      publishedAt: String(d.publishedAt ?? ""),
      score: d.quality?.score ?? null,
      verdict: d.quality?.verdict ?? "",
      image: d.image?.url ?? null,
      sources: (d.sources ?? []).map((s) => ({ name: s.name, nameEn: s.nameEn, title: s.title, url: s.url })),
      hasChart: Boolean(d.chart),
      hasTable: Boolean(d.table),
      importance: d.quality?.importance ?? null,
      featured: d.featured === true,
      models: d.models ?? {},
      // A draft is what the pipeline flagged as one, or a brand-new file git has never seen.
      isDraft: d.draft === true || untracked,
      committed: !untracked,
    });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
/** The daily checks' own records (the editor round writes them, 2026-09-25): photos and freshness, and the week's numbers. */
async function stateFile(name) {
  try {
    return JSON.parse(await readFile(path.join(root, "pipeline", "state", name), "utf8"));
  } catch {
    return null;
  }
}
async function latestRun() {
  try {
    return JSON.parse(await readFile(path.join(root, "pipeline", "runs", "latest.json"), "utf8"));
  } catch {
    return null;
  }
}
function nextCloudRun() {
  const now = new Date();
  for (let h = 0; h <= 24; h += 1) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + h, 23, 0));
    if (t.getUTCHours() % 3 === 0 && t > now) return t.toISOString();
  }
  return null;
}
/**
 * Where each live story sits, by the same arithmetic as src/pages/index.astro and src/lib/articles.ts:
 * lead = strongest fresh news story (importance − hours/12 + 1.5 for a photo; or the newest featured one
 * within 48 h); cover = lead + the four strongest of the freshest twelve; next five = ticker.
 */
function placeOnFront(live) {
  const now = Date.now();
  const hours = (a) => (now - Date.parse(a.publishedAt)) / 36e5;
  const news = live.filter((a) => a.kind === "news").sort((x, y) => Date.parse(y.publishedAt) - Date.parse(x.publishedAt));
  for (const a of live) a.where = a.kind === "news" ? "section" : "hub";
  if (!news.length) return live;
  const featured = news.filter((a) => a.featured && hours(a) < 48);
  const lead = featured[0] ?? [...news].sort((x, y) => ((y.importance ?? 5) - hours(y) / 12 + (y.image ? 1.5 : 0)) - ((x.importance ?? 5) - hours(x) / 12 + (x.image ? 1.5 : 0)))[0];
  const imp = (a) => (a.importance ?? 5) + (a.image ? 0.5 : 0);
  const cover = [lead, ...news.filter((a) => a !== lead).slice(0, 12).sort((x, y) => imp(y) - imp(x)).slice(0, 4)];
  const ticker = news.filter((a) => !cover.includes(a)).slice(0, 5);
  cover.forEach((a, i) => (a.where = i === 0 ? "lead" : `cover ${i + 1}`));
  ticker.forEach((a) => (a.where = "ticker"));
  return live;
}
/** Per section: stories in the last 24 h and 7 days, and the newest one — the answer to "is the whole paper alive?". */
function coverage(live) {
  const now = Date.now();
  const rows = {};
  for (const id of NEWS_SECTIONS) rows[id] = { id, name: SECTION_NAME[id], day: 0, week: 0, last: null };
  for (const k of ["explainer", "analysis", "paper", "weekly", "feature"]) rows[k] = { id: k, name: { explainer: "Explainers", analysis: "Analyses", paper: "Paper readings", weekly: "Week's review", feature: "In depth (في العمق)" }[k], day: 0, week: 0, last: null };
  for (const a of live) {
    const key = a.kind === "news" ? a.section : a.kind;
    const r = rows[key];
    if (!r) continue;
    const h = (now - Date.parse(a.publishedAt)) / 36e5;
    if (h < 24) r.day += 1;
    if (h < 168) r.week += 1;
    if (!r.last || a.publishedAt > r.last) r.last = a.publishedAt;
  }
  return Object.values(rows);
}
/** Flip a draft to live in place. */
async function markPublished(file) {
  const full = path.join(ARTICLES, file);
  let raw = await readFile(full, "utf8");
  raw = raw.replace(/^draft:\s*true\r?\n/m, "");
  raw = raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, (m, head, tail) => `${head}\nupdatedAt: ${new Date().toISOString()}${tail}`);
  await writeFile(full, raw, "utf8");
}
/** A discarded story must not come back on the next run. */
async function markDiscarded(slug) {
  try {
    const state = JSON.parse(await readFile(SEEN, "utf8"));
    let n = 0;
    for (const entry of Object.values(state.items ?? {})) {
      if (entry.slug === slug) {
        entry.decision = "discarded";
        entry.at = new Date().toISOString();
        n += 1;
      }
    }
    if (n) await writeFile(SEEN, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    /* optional */
  }
}
/** Set or clear `featured`; only one story is featured at a time. */
async function setFeatured(file, on) {
  const files = (await readdir(ARTICLES)).filter((f) => f.endsWith(".md"));
  const touched = [];
  for (const f of files) {
    const full = path.join(ARTICLES, f);
    let raw = await readFile(full, "utf8");
    const had = /^featured:\s*true\r?\n/m.test(raw);
    const want = on && f === file;
    if (had === want) continue;
    raw = raw.replace(/^featured:\s*true\r?\n/m, "");
    if (want) raw = raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, (m, head, tail) => `${head}\nfeatured: true${tail}`);
    await writeFile(full, raw, "utf8");
    touched.push(`content/articles/${f}`);
  }
  return touched;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
/** The bodies are plain paragraphs with the odd bold or sub-heading; that is all this renders. */
function bodyHtml(md) {
  return md
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^#{2,3}\s/.test(p)) return `<h3>${esc(p.replace(/^#+\s*/, ""))}</h3>`;
      return `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

let cachedGeminiModels = null;
let lastGeminiModelsFetch = 0;

async function fetchLiveGeminiModels(apiKey) {
  if (!apiKey) return null;
  const now = Date.now();
  if (cachedGeminiModels && (now - lastGeminiModelsFetch < 3600000)) return cachedGeminiModels;
  try {
    // The key goes in a header, never in the address: an address ends up in error messages and logs.
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.models)) {
      const list = data.models
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((n) => n.startsWith("gemini") && !n.includes("-tts") && !n.includes("-embedding") && !n.includes("-transcribe") && !n.includes("-audio") && !n.includes("-robotics"));
      if (list.length > 0) {
        cachedGeminiModels = list;
        lastGeminiModelsFetch = now;
        return list;
      }
    }
  } catch {
    /* fallback to curated list */
  }
  return null;
}

// --------------------------------------------------------------------- health
async function health() {
  const secrets = await exec("gh", ["secret", "list", "--repo", REPO]);
  const vars = await exec("gh", ["variable", "list", "--repo", REPO]);
  const ghOk = !/not logged|not recognized|command not found|could not|error/i.test(secrets);
  const local = envFileKeys();
  let editorReal = null;
  let deploy = null;
  if (ghOk) {
    const d = await exec("gh", ["run", "list", "--repo", REPO, "--workflow", "deploy.yml", "-L", "1", "--json", "conclusion,createdAt,headSha,url"]);
    try {
      const [r] = JSON.parse(d);
      if (r) deploy = { ok: r.conclusion === "success", when: r.createdAt, sha: (r.headSha ?? "").slice(0, 7), url: r.url };
    } catch {
      /* none yet */
    }
    const last = await exec("gh", ["run", "list", "--repo", REPO, "--workflow", "editor.yml", "-L", "1", "--json", "startedAt,updatedAt,conclusion"]);
    try {
      const [r] = JSON.parse(last);
      if (r) {
        const s = (new Date(r.updatedAt) - new Date(r.startedAt)) / 1000;
        editorReal = { seconds: Math.round(s), working: s > 90 };
      }
    } catch {
      /* none */
    }
  }

  const activeProvider = (local.KHAZENDAR_PROVIDER || (vars.match(/KHAZENDAR_PROVIDER\s+(\S+)/) ?? [])[1] || "gemini").toLowerCase();
  const cloudProvider = (vars.match(/KHAZENDAR_PROVIDER\s+(\S+)/) ?? [])[1] || "gemini";
  const geminiKey = local.GEMINI_API_KEY || local.GOOGLE_API_KEY;
  if (!cachedGeminiModels && geminiKey) {
    fetchLiveGeminiModels(geminiKey).catch(() => {});
  }
  const geminiModels = cachedGeminiModels || ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-flash-latest", "gemini-pro-latest"];
  const codex = codexStatus(spawnSync, loadEnv());
  const cloudAccountId = cloudProvider === "codex" ? (vars.match(/KHAZENDAR_CODEX_ACCOUNT\s+(\S+)/) ?? [])[1] : "";
  const cloudBackupId = cloudProvider === "codex" ? (vars.match(/KHAZENDAR_CODEX_BACKUP\s+(\S+)/) ?? [])[1] : "";
  const localUsage = readQuotaState();
  const accounts = listAccounts(loadEnv()).map((a) => ({ ...a, cloudActive: a.id === cloudAccountId || a.id === cloudBackupId,
    quota: (a.target === "cloud" ? cloudUsage : localUsage).accounts[a.id], inUse: (a.target === "cloud" ? cloudUsage : localUsage).active === a.id }));

  const providers = {
    codex: {
      id: "codex", name: "ChatGPT subscription (Codex)", active: activeProvider === "codex",
      subscription: codex.subscription, available: codex.available, note: codex.message,
      keySet: false, cloudKeySet: false,
      model: local.KHAZENDAR_CODEX_MODEL || "gpt-6.1-sol", models: ["gpt-6.1-sol"],
    },
    gemini: {
      id: "gemini",
      name: "Google Gemini",
      active: activeProvider === "gemini",
      keySet: Boolean(geminiKey),
      cloudKeySet: /GEMINI_API_KEY|GOOGLE_API_KEY/.test(secrets),
      model: local.KHAZENDAR_GEMINI_MODEL || (activeProvider === "gemini" ? local.KHAZENDAR_MODEL : "") || "gemini-3.8-flash",
      models: geminiModels,
      thinkingBudget: local.KHAZENDAR_THINKING_BUDGET || "-1",
    },
    claude: {
      id: "claude",
      name: "Anthropic Claude",
      active: activeProvider === "claude",
      keySet: Boolean(local.ANTHROPIC_API_KEY),
      tokenSet: Boolean(local.CLAUDE_CODE_OAUTH_TOKEN),
      cloudKeySet: /ANTHROPIC_API_KEY/.test(secrets),
      cloudTokenSet: /CLAUDE_CODE_OAUTH_TOKEN/.test(secrets),
      model: local.KHAZENDAR_CLAUDE_MODEL || (activeProvider === "claude" ? local.KHAZENDAR_MODEL : "") || "claude-opus-5-5",
      models: ["claude-opus-5-5", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    },
    openai: {
      id: "openai",
      name: "OpenAI API (separate billing)",
      active: activeProvider === "openai",
      keySet: Boolean(local.OPENAI_API_KEY),
      cloudKeySet: /OPENAI_API_KEY/.test(secrets),
      model: local.KHAZENDAR_OPENAI_MODEL || (activeProvider === "openai" ? local.KHAZENDAR_MODEL : "") || "gpt-6.1-sol",
      models: ["gpt-6.1-sol", "gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4.5-preview"],
    },
    qwen: {
      id: "qwen",
      name: "Alibaba Qwen",
      active: activeProvider === "qwen",
      keySet: Boolean(local.DASHSCOPE_API_KEY || local.QWEN_API_KEY),
      cloudKeySet: /DASHSCOPE_API_KEY|QWEN_API_KEY/.test(secrets),
      model: local.KHAZENDAR_QWEN_MODEL || (activeProvider === "qwen" ? local.KHAZENDAR_MODEL : "") || "qwen-plus",
      models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen2.5-72b-instruct"],
    },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      active: activeProvider === "openrouter",
      keySet: Boolean(local.OPENROUTER_API_KEY),
      cloudKeySet: /OPENROUTER_API_KEY/.test(secrets),
      model: local.KHAZENDAR_OPENROUTER_MODEL || (activeProvider === "openrouter" ? local.KHAZENDAR_MODEL : "") || "google/gemini-3.8-flash",
      models: ["google/gemini-3.8-flash", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "qwen/qwen-2.5-72b-instruct"],
    },
  };

  const active = providers[activeProvider] || providers.gemini;
  const activeKeySet = active.subscription || active.keySet || (active.id === "claude" && active.tokenSet);
  const cloudActive = providers[cloudProvider] || providers.gemini;
  const activeCloudKeySet = cloudProvider === "codex" ? /KHAZENDAR_CODEX_AUTH_JSON/.test(secrets) && /KHAZENDAR_CODEX_STATE_KEY/.test(secrets) : cloudActive.cloudKeySet || (cloudActive.id === "claude" && cloudActive.cloudTokenSet);

  return {
    ghOk,
    activeProvider,
    providers,
    chatgptAccounts: accounts,
    chatgptPool: { local: readAccountStore().pool || { enabled: false }, cloud: { enabled: Boolean(cloudBackupId && cloudBackupId !== "none"), primary: cloudAccountId, backup: cloudBackupId } },
    cloud: {
      activeProvider: cloudProvider,
      newsroomModel: (vars.match(/KHAZENDAR_MODEL\s+(\S+)/) ?? [])[1] || cloudActive.model,
      editorOn: /KHAZENDAR_EDITOR\s+1/.test(vars),
      review: /KHAZENDAR_REVIEW\s+1/.test(vars),
      paused: /KHAZENDAR_PAUSED\s+1/.test(vars),
      hasKey: activeCloudKeySet,
      anthropic: /ANTHROPIC_API_KEY/.test(secrets),
      oauth: /CLAUDE_CODE_OAUTH_TOKEN/.test(secrets),
      gemini: /GEMINI_API_KEY|GOOGLE_API_KEY/.test(secrets),
    },
    local: {
      activeProvider,
      activeModel: active.model,
      hasKey: activeKeySet,
      gemini: Boolean(local.GEMINI_API_KEY || local.GOOGLE_API_KEY),
      anthropic: Boolean(local.ANTHROPIC_API_KEY),
      oauth: Boolean(local.CLAUDE_CODE_OAUTH_TOKEN),
      openai: Boolean(local.OPENAI_API_KEY),
      qwen: Boolean(local.DASHSCOPE_API_KEY || local.QWEN_API_KEY),
      openrouter: Boolean(local.OPENROUTER_API_KEY),
    },
    chatModel: local.KHAZENDAR_CHAT_MODEL || "default",
    thinkingBudget: local.KHAZENDAR_THINKING_BUDGET || "-1",
    claudeEffort: claudeEffort(local),
    editorReal,
    deploy,
    chatReady: activeKeySet,
  };
}

// ------------------------------------------------- the chat ("Change the site")
// Claude Code 2.1.2xx ships a native bin/claude.exe and no cli.js (2026-09-24, updated for Opus 5.5); older
// installs keep the node route. Either way the process starts without a shell. `CLI` is [command, ...leading args].
const CLI_ROOTS = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code"),
  path.join(process.env.HOME ?? "", ".npm-global", "lib", "node_modules", "@anthropic-ai", "claude-code"),
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code",
];
const CLI_BIN = CLI_ROOTS.map((root) => path.join(root, "bin", "claude.exe")).find((p) => existsSync(p));
const CLI_JS = CLI_BIN ? undefined : CLI_ROOTS.map((root) => path.join(root, "cli.js")).find((p) => existsSync(p));
const CLI = CLI_BIN ? [CLI_BIN] : CLI_JS ? [process.execPath, CLI_JS] : null;

function chatEnv() {
  const env = loadEnv();
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;
  for (const key of Object.keys(env)) {
    if (/^CLAUDECODE$|^CLAUDE_/.test(key) || key === "ANTHROPIC_BASE_URL" || key === "ANTHROPIC_AUTH_TOKEN") delete env[key];
    // The chat needs its own Claude credential and no other: the newsroom's keys stay out of its reach, so a file
    // that talks it into running something finds nothing to send anywhere.
    else if (/(?:_KEY|_TOKEN|_SECRET)$|^KHAZENDAR_CODEX_AUTH/.test(key)) delete env[key];
  }
  if (oauth) env.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}
const CHAT_RULES = `You are the site assistant for خازندار, an automated Arabic economics newspaper owned by Ahmed.
You are being driven from the paper's control room, not a terminal. Ahmed is not a programmer.
This chat is for CHANGING THE SITE — its design, its pages, the newsroom's rules and sources. Running
the newsroom, reviewing and publishing stories are done from the Desk, not here; if he asks for
those, tell him in one line to use the Desk.

READ FIRST: CLAUDE.md, START_HERE.md, DESIGN.md and STYLE.md. They bind you like every other agent here.

HOW YOU ANSWER
- In the language he wrote in, Arabic or English. Short plain sentences. Lead with what changed and
  what it means for the paper. Never paste diffs, stack traces, commands or code unless asked.
- Unsure what he means? Ask one short question instead of guessing.

WHAT YOU MAY DO
- Read anything. Change files in src/, pipeline/lib/, pipeline/sources.json, DESIGN.md, STYLE.md.
- Run npm run check and npm run build, and say plainly whether they passed.

WHAT YOU MUST NEVER DO — HE PUBLISHES, NOT YOU
- NEVER run git commit, push, stash, reset, checkout, restore, rebase or clean. Leave every change
  UNCOMMITTED; the panel shows him what changed and he decides. This is his only control.
- Never hand-write or edit a news article. Never invent a figure, a quote or a source. Never generate
  a picture. Never print, copy or commit .env, a key or a token.

END EVERY TURN with one line: what changed, and whether the site still builds.`;
// Also out of the chat's reach: the keys file, and the workflows, which run in the cloud with every key the site has.
const BLOCKED_TOOLS = ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(git restore:*)", "Bash(git clean:*)", "Bash(git stash:*)", "Bash(git rebase:*)", "Read(./.env)", "Read(./.env.*)", "Edit(./.github/workflows/**)"];
const chat = { running: null, sessionId: null, clients: new Set(), turns: [], baseline: null, touched: [] };
function chatSend(event) {
  for (const res of chat.clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function startChat(message) {
  if (chat.running) return false;
  const keys = envFileKeys();
  const activeProvider = (keys.KHAZENDAR_PROVIDER || "gemini").toLowerCase();

  if (activeProvider === "claude") {
    if (!CLI) {
      chatSend({ t: "error", text: "Claude Code is not installed on this machine. Switch to Gemini in Settings, or install Claude Code." });
      return true;
    }
    if (!keys.CLAUDE_CODE_OAUTH_TOKEN && !keys.ANTHROPIC_API_KEY) {
      chatSend({ t: "error", text: "Claude is active but no key or token is saved. Open Settings and add one, or switch to Gemini." });
      return true;
    }
    chat.baseline = await porcelain();
    chat.touched = [];
    chat.turns.push({ role: "you", text: message });
    chatSend({ t: "you", text: message });
    const args = [...CLI.slice(1), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--append-system-prompt", CHAT_RULES];
    if (keys.KHAZENDAR_CHAT_MODEL) args.push("--model", keys.KHAZENDAR_CHAT_MODEL);
    if (chat.sessionId) args.push("--resume", chat.sessionId);
    else {
      chat.sessionId = randomUUID();
      args.push("--session-id", chat.sessionId);
    }
    args.push("--disallowed-tools", ...BLOCKED_TOOLS);
    const child = spawn(CLI[0], args, { cwd: root, env: chatEnv(), windowsHide: true, shell: false });
    chat.running = child;
    chatSend({ t: "busy" });
    child.stdin.write(message);
    child.stdin.end();
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "assistant") {
          for (const part of ev.message?.content ?? []) {
            if (part.type === "text" && part.text.trim()) {
              chat.turns.push({ role: "paper", text: part.text });
              chatSend({ t: "paper", text: part.text });
            }
            if (part.type === "tool_use") {
              const what = part.input?.file_path ?? part.input?.command ?? part.input?.pattern ?? "";
              chatSend({ t: "step", text: `${part.name} ${String(what).replace(root, "").replace(/^[\\/]/, "")}`.trim() });
            }
          }
        }
        if (ev.type === "result") chatSend({ t: "done", text: ev.is_error ? "stopped with an error" : "done", seconds: Math.round((ev.duration_ms ?? 0) / 1000) });
      }
    });
    child.stderr.on("data", (d) => {
      const text = String(d).trim();
      if (text) chatSend({ t: "step", text: text.slice(0, 300) });
    });
    child.on("close", async () => {
      chat.running = null;
      const after = await porcelain();
      chat.touched = [...after].filter(([f, c]) => chat.baseline.get(f) !== c && !f.startsWith("content/articles/")).map(([f]) => f);
      chatSend({ t: "changes", changes: await siteChanges() });
    });
    return true;
  }

  // Active provider is Gemini, OpenAI, Qwen, or OpenRouter
  const hasKey = activeProvider === "gemini" ? Boolean(keys.GEMINI_API_KEY || keys.GOOGLE_API_KEY)
    : activeProvider === "codex" ? codexStatus(spawnSync, loadEnv()).subscription
    : activeProvider === "openai" ? Boolean(keys.OPENAI_API_KEY)
    : activeProvider === "qwen" ? Boolean(keys.DASHSCOPE_API_KEY || keys.QWEN_API_KEY)
    : activeProvider === "openrouter" ? Boolean(keys.OPENROUTER_API_KEY)
    : false;

  if (!hasKey) {
    chatSend({ t: "error", text: `Active provider "${activeProvider}" has no API key saved yet. Open Settings and add the key to start.` });
    return true;
  }

  chat.baseline = await porcelain();
  chat.touched = [];
  chat.turns.push({ role: "you", text: message });
  chatSend({ t: "you", text: message });
  chatSend({ t: "busy" });
  chatSend({ t: "step", text: `Thinking with ${activeProvider.toUpperCase()}...` });

  (async () => {
    try {
      const { chat: llmChat } = await import("../pipeline/lib/llm.mjs");
      const history = chat.turns.slice(-6).map((t) => `${t.role === "you" ? "User" : "Assistant"}: ${t.text}`).join("\n\n");
      const res = await llmChat({
        role: "assistant",
        system: CHAT_RULES,
        user: `${history}\n\nUser request: ${message}`,
        json: false,
        timeoutMs: 120000,
      });
      chat.turns.push({ role: "paper", text: res.text });
      chatSend({ t: "paper", text: res.text });
      chatSend({ t: "done", text: "done", seconds: Math.round(res.ms / 1000) });
    } catch (err) {
      chatSend({ t: "error", text: `${activeProvider} error: ${err.message}` });
    } finally {
      chat.running = null;
      const after = await porcelain();
      chat.touched = [...after].filter(([f, c]) => chat.baseline.get(f) !== c && !f.startsWith("content/articles/")).map(([f]) => f);
      chatSend({ t: "changes", changes: await siteChanges() });
    }
  })();

  return true;
}
function describe(file) {
  if (file.startsWith("src/styles/")) return "how the site looks";
  if (file.startsWith("src/components/") || file.startsWith("src/layouts/")) return "a part of the page";
  if (file.startsWith("src/pages/")) return "a page";
  if (file === "src/data/site.json") return "the site's settings";
  if (file.startsWith("src/data/")) return "site data";
  if (file.startsWith("pipeline/lib/")) return "a newsroom rule";
  if (file === "pipeline/sources.json") return "the list of sources";
  if (file.startsWith("pipeline/")) return "the newsroom";
  if (file.startsWith(".github/")) return "an automatic job";
  if (file.startsWith("scripts/")) return "this control room";
  if (/\.md$/.test(file)) return "a notes page";
  return "a project file";
}
async function siteChanges() {
  const map = await porcelain();
  const files = [...map.entries()]
    .filter(([f]) => !f.startsWith("content/articles/") && !f.startsWith("pipeline/state/") && !f.startsWith("pipeline/runs/"))
    .map(([file, code]) => ({ file, what: describe(file), how: code.includes("?") ? "new" : code.includes("D") ? "removed" : "changed" }));
  return { files, count: files.length };
}

// ------------------------------------------------------------------------ page
const ICON = {
  desk: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M6 8h8M6 11.5h5"/></svg>',
  stories: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h9"/></svg>',
  settings: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6h9M15 6h2M3 14h2M8 14h9"/><circle cx="13" cy="6" r="2"/><circle cx="6" cy="14" r="2"/></svg>',
  change: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h14v9H8l-4 3v-3H3z"/></svg>',
  out: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H4v12h12v-4M11 4h5v5M16 4l-7 7"/></svg>',
  dots: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15" cy="10" r="1.6"/></svg>',
  spin: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 3a7 7 0 1 1-6.3 4"/></svg>',
};

function page() {
  const current = JSON.parse(readFileSync(SITE_FILE, "utf8"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>خازندار — Control room</title>
<style>
@font-face{font-family:"Amiri";font-weight:700;font-display:swap;src:url("/fonts/amiri-arabic-700.woff2") format("woff2")}
@font-face{font-family:"Naskh";font-weight:400;font-display:swap;src:url("/fonts/naskh-arabic.woff2") format("woff2")}
:root{
  --paper:#fcfcf9;--paper-2:#f3f3ee;--paper-3:#ebebe4;--ink:#141414;--ink-2:#454442;--ink-3:#6a6965;--rule:#d6d5ce;--rule-2:#e6e5df;
  --green:#0f5c3c;--green-deep:#0a4530;--green-tint:#e6f0ea;--red:#8c2a14;--red-tint:#f6e7e2;--amber:#8a6a12;--amber-tint:#f7efd6;
  --sans:"Segoe UI",system-ui,-apple-system,sans-serif;--ar:"Naskh","Noto Naskh Arabic","Sakkal Majalla","Traditional Arabic",serif;
  --rail:248px;--gutter:40px;--t:160ms cubic-bezier(.2,.7,.2,1)
}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;font:15px/1.5 var(--sans);color:var(--ink);background:var(--paper);display:grid;grid-template-columns:var(--rail) 1fr;min-height:100vh}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;cursor:pointer;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:8px 14px;border-radius:2px;transition:background var(--t),border-color var(--t),color var(--t),box-shadow var(--t)}
button:hover{background:#000}button:focus-visible{outline:2px solid var(--green);outline-offset:2px}
button:disabled{opacity:.45;cursor:not-allowed}
button.go{background:var(--green);border-color:var(--green);font-weight:600}button.go:hover{background:var(--green-deep)}
button.quiet{background:transparent;color:var(--ink);border-color:var(--rule)}button.quiet:hover{background:var(--paper-2);border-color:var(--ink-3)}
button.danger{background:transparent;color:var(--red);border-color:var(--rule)}button.danger:hover{background:var(--red-tint);border-color:var(--red)}
button.sm{padding:5px 10px;font-size:13.5px}
select,input[type=text],input[type=email],input[type=password],textarea{font:inherit;color:var(--ink);padding:7px 9px;border:1px solid var(--rule);background:#fff;border-radius:2px;transition:border-color var(--t),box-shadow var(--t)}
select:focus,input:focus,textarea:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-tint)}
h1,h2,h3{margin:0;font-weight:600}
h2{font-size:17px;line-height:1.3;padding:0 0 10px;border-bottom:1px solid var(--rule);margin:36px 0 16px}
h2:first-child{margin-top:0}
h2 .n{font-size:12.5px;font-weight:600;color:var(--paper);background:var(--ink);border-radius:9px;padding:1px 8px;vertical-align:2px;margin-inline-start:8px}
.m{color:var(--ink-3);font-size:13px}.ok{color:var(--green)}.no{color:var(--red)}
.ar{font-family:var(--ar);direction:rtl;text-align:right;unicode-bidi:plaintext}
/* rail */
.rail{background:var(--paper-2);border-inline-end:1px solid var(--rule);padding:28px 20px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh}
.rail .mark{font-family:"Amiri",var(--ar);font-size:34px;line-height:1;color:var(--green-deep);direction:rtl;text-align:left;margin-bottom:2px}
.rail .sub{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:26px}
.rail a.nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:3px;color:var(--ink-2);text-decoration:none;transition:background var(--t),color var(--t)}
.rail a.nav svg{width:18px;height:18px;flex:none}
.rail a.nav:hover{background:var(--paper-3);color:var(--ink)}
.rail a.nav.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(20,20,20,.06);font-weight:600}
.rail .foot{margin-top:auto;padding-top:18px;border-top:1px solid var(--rule);display:grid;gap:8px;font-size:13px}
.rail .foot a{display:flex;align-items:center;gap:8px;color:var(--ink-2)}.rail .foot a svg{width:15px;height:15px}
.light{display:flex;align-items:flex-start;gap:8px;color:var(--ink-2);line-height:1.35}.light i{flex:none;width:9px;height:9px;border-radius:50%;margin-top:5px;background:var(--rule)}
.light.ok i{background:var(--green)}.light.no i{background:var(--red)}
/* content */
main{padding:32px var(--gutter) 64px;max-width:1520px;width:100%}
.pane{display:none}.pane.on{display:block}
/* status band */
.band{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr 1fr;border-top:1px solid var(--ink);border-bottom:1px solid var(--rule)}
.band > div{padding:16px 18px 16px 0;border-inline-end:1px solid var(--rule-2);margin-inline-end:18px}
.band > div:last-child{border:0;margin:0}
.band .k{font-size:12.5px;color:var(--ink-3);margin-bottom:4px}
.band .v{font-size:20px;line-height:1.25;font-weight:600}
.band .v small{font-size:13.5px;font-weight:400;color:var(--ink-2)}
.band .auto{display:flex;align-items:center;gap:8px;color:var(--green);font-weight:600;font-size:15px}
.band .auto i{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px var(--green-tint)}
.band .auto.off{color:var(--amber)}.band .auto.off i{background:var(--amber);box-shadow:0 0 0 3px var(--amber-tint)}
/* running */
.running{margin-top:14px;padding:12px 16px;background:var(--amber-tint);border:1px solid #e6d7a3;border-radius:3px;display:grid;gap:6px}
.running .h{display:flex;align-items:center;gap:10px;font-weight:600}
.running .h svg{width:16px;height:16px;animation:spin 1s linear infinite;color:var(--amber)}
@keyframes spin{to{transform:rotate(360deg)}}
.running pre{margin:0;background:transparent;color:var(--ink-2);font:12.5px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap}
.running details pre{background:var(--ink);color:#e6e2d8;padding:12px;max-height:280px;overflow:auto;margin-top:8px}
.running summary{cursor:pointer;color:var(--green);font-size:13px}
/* coverage */
.cov{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--rule)}
.cov > div{padding:12px 14px 14px 0;border-inline-end:1px solid var(--rule-2);margin-inline-end:14px}
.cov > div:last-child{border:0;margin:0}
.cov .s{font-family:var(--ar);font-size:18px;direction:rtl;text-align:left;line-height:1.2}
.cov .c{font-size:13px;color:var(--ink-2);margin-top:6px}.cov .c b{color:var(--ink);font-weight:600}
.cov .quiet .c{color:var(--amber)}
.hubs{display:flex;gap:26px;flex-wrap:wrap;padding:12px 0 0;font-size:13px;color:var(--ink-2)}.hubs b{color:var(--ink);font-weight:600}
/* two-column desk */
.cols{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:56px;align-items:start;margin-top:36px}
@media (max-width:1180px){.cols{grid-template-columns:1fr}}
/* drafts */
.draft{display:grid;grid-template-columns:132px minmax(0,1fr);gap:18px;padding:16px 0;border-bottom:1px solid var(--rule-2)}
.draft img,.draft .noimg{width:132px;height:88px;object-fit:cover;background:var(--paper-3);border:1px solid var(--rule)}
.draft .noimg{display:flex;align-items:center;justify-content:center;color:var(--ink-3);font-size:12px}
.draft h3{font-family:var(--ar);font-weight:400;font-size:21px;line-height:1.35;direction:rtl;text-align:right}
.draft p{font-family:var(--ar);margin:4px 0 6px;color:var(--ink-2);font-size:16px;direction:rtl;text-align:right;line-height:1.5}
.draft .meta{font-size:12.5px;color:var(--ink-3)}
.draft .acts{display:flex;gap:8px;align-items:center;margin-top:10px}
.empty{padding:22px 0;color:var(--ink-3)}
/* get material */
.get{display:grid;gap:10px}
.get .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.get .row label{display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--ink-2)}
.sched{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:13.5px}
.sched li{display:grid;grid-template-columns:1fr auto;gap:12px;padding:6px 0;border-bottom:1px solid var(--rule-2)}
.sched li span:last-child{color:var(--ink-3);white-space:nowrap}
/* stories */
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.bar input[type=text]{min-width:280px;flex:1}
table.list{width:100%;border-collapse:collapse}
table.list th{font-size:12.5px;font-weight:600;color:var(--ink-3);text-align:left;padding:8px 10px;border-bottom:1px solid var(--ink)}
table.list td{padding:11px 10px;border-bottom:1px solid var(--rule-2);vertical-align:middle}
table.list tr:hover td{background:#fff}
td.t a{font-family:var(--ar);font-size:18px;line-height:1.35;color:var(--ink);display:block;direction:rtl;text-align:right;unicode-bidi:plaintext}
td.t .meta{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.chip{display:inline-block;font-size:12px;padding:2px 8px;border-radius:10px;background:var(--paper-3);color:var(--ink-2);white-space:nowrap}
.chip.front{background:var(--green-tint);color:var(--green-deep);font-weight:600}
.score{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:3px;font-weight:600;font-size:12.5px;background:var(--paper-3)}
.score.hi{background:var(--green-tint);color:var(--green-deep)}.score.lo{background:var(--red-tint);color:var(--red)}
td.src details summary{cursor:pointer;font-size:13px;color:var(--green);list-style:none}
td.src ul{margin:6px 0 0;padding-inline-start:16px;font-size:12.5px;max-width:420px}
/* actions menu */
.menu{position:relative}
.menu summary{list-style:none;cursor:pointer;width:32px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--rule);border-radius:2px;color:var(--ink-2);background:#fff}
.menu summary::-webkit-details-marker{display:none}
.menu summary svg{width:18px;height:18px}.menu[open] summary{border-color:var(--ink)}
.menu .pop{position:absolute;right:0;top:34px;z-index:20;min-width:230px;background:#fff;border:1px solid var(--rule);border-radius:3px;box-shadow:0 8px 24px -8px rgba(20,20,20,.25),0 2px 6px rgba(20,20,20,.08);padding:6px}
.menu .pop button,.menu .pop a{display:block;width:100%;text-align:left;background:none;border:0;color:var(--ink);padding:8px 10px;border-radius:2px;font-size:14px;margin:0}
.menu .pop button:hover,.menu .pop a:hover{background:var(--paper-2);text-decoration:none}
.menu .pop .sep{border-top:1px solid var(--rule-2);margin:6px 0}
.menu .pop .lbl{font-size:12px;color:var(--ink-3);padding:6px 10px 2px}
.menu .pop button.d{color:var(--red)}.menu .pop button.d:hover{background:var(--red-tint)}
.menu .pop .secs{display:grid;grid-template-columns:1fr 1fr}
.menu .pop .secs button{font-family:var(--ar);font-size:15px;text-align:right;direction:rtl}
/* settings */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}
@media (max-width:1100px){.grid2{grid-template-columns:1fr}}
.set label{display:block;margin:0 0 12px}.set label > span{display:block;font-weight:600;margin-bottom:4px}
.set label .m{font-weight:400}.set input,.set select{width:100%}
.keyrow{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:12px}
.keyrow label{margin:0}
.keycard{border:1px solid var(--rule-2);border-radius:4px;padding:12px 14px;background:#fff;margin-bottom:12px;transition:border-color var(--t),box-shadow var(--t)}
.keycard.active{border-color:var(--green);box-shadow:0 0 0 2px var(--green-tint)}
.keycard .khead{display:flex;justify-content:space-between;align-items:center;gap:10px}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.04em;margin-inline-start:6px;display:inline-block}
.badge.active{background:var(--green-tint);color:var(--green-deep)}
.badge.idle{background:var(--paper-3);color:var(--ink-3)}
code{background:var(--paper-3);padding:2px 6px;font-size:13px;border-radius:2px}
.dots p{margin:6px 0}
/* chat */
#thread{display:flex;flex-direction:column;gap:12px;min-height:220px;max-height:56vh;overflow:auto;padding:4px 2px}
.bub{max-width:78%;padding:10px 14px;border:1px solid var(--rule);border-radius:3px;white-space:pre-wrap;word-wrap:break-word;line-height:1.55}
.bub.you{align-self:flex-end;background:var(--green-tint);border-color:#cfe0d6}.bub.paper{align-self:flex-start;background:#fff}
.bub.rtl{direction:rtl;text-align:right;font-family:var(--ar);font-size:16px}
.step{align-self:flex-start;color:var(--ink-3);font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
.ask{display:flex;gap:10px;align-items:flex-end;margin-top:14px}.ask textarea{flex:1;resize:vertical;min-height:56px}
.chg{margin-top:20px;padding:14px 16px;background:var(--green-tint);border:1px solid #cfe0d6;border-radius:3px}
/* preview */
#overlay{position:fixed;inset:0;background:rgba(20,20,20,.42);display:none;z-index:40}#overlay.on{display:block}
#preview{position:fixed;top:0;right:0;bottom:0;width:min(780px,96vw);background:var(--paper);overflow:auto;padding:22px 30px 40px;box-shadow:-12px 0 40px rgba(20,20,20,.28)}
#preview .bar{position:sticky;top:-22px;background:var(--paper);padding:10px 0;border-bottom:1px solid var(--rule);margin-bottom:16px;display:flex;gap:8px}
#preview .bar .x{margin-inline-start:auto}
#preview article{direction:rtl;text-align:right;font-family:var(--ar);font-size:17.5px;line-height:1.9}
#preview article h1{font-family:"Amiri",var(--ar);font-size:28px;line-height:1.3;font-weight:700;margin:0 0 6px}
#preview article .sub{font-size:18px;color:var(--ink-2);margin:0 0 12px}
#preview article img{width:100%;height:auto;margin:8px 0 2px}#preview article .credit{font-size:12px;color:var(--ink-3);font-family:var(--sans)}
#preview article .lede{font-weight:600}#preview article .facts{background:var(--paper-2);padding:10px 14px;margin:12px 0}#preview article .facts ul{margin:0;padding-inline-start:18px}
#preview article .why{border-top:2px solid var(--green);border-bottom:1px solid var(--rule);padding:10px 0;margin:14px 0}
#preview .meta{direction:ltr;text-align:left;font-family:var(--sans);font-size:13px;color:var(--ink-2);border-top:1px solid var(--rule);margin-top:18px;padding-top:12px}
#preview .meta ul{padding-inline-start:16px}
/* narrow */
@media (max-width:900px){
  body{grid-template-columns:1fr}
  .rail{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;padding:14px 16px;border-inline-end:0;border-bottom:1px solid var(--rule)}
  .rail .mark{font-size:26px;margin:0 8px 0 0}.rail .sub{display:none}.rail .foot{display:none}
  main{padding:20px 16px 48px}
  .band{grid-template-columns:1fr 1fr}.band > div{border:0;margin:0;padding:12px 0}
  .cov{grid-template-columns:1fr 1fr 1fr}
  .draft{grid-template-columns:1fr}.draft img,.draft .noimg{width:100%;height:160px}
  table.list th:nth-child(3),table.list td:nth-child(3),table.list th:nth-child(4),table.list td:nth-child(4){display:none}
  .bar input[type=text]{min-width:0;width:100%}
}
</style></head><body>
<nav class="rail">
  <div class="mark">خازندار</div>
  <div class="sub">Control room</div>
  <a class="nav on" data-tab="desk" href="#desk">${ICON.desk}<span>Desk</span></a>
  <a class="nav" data-tab="stories" href="#stories">${ICON.stories}<span>Stories</span></a>
  <a class="nav" data-tab="set" href="#set">${ICON.settings}<span>Settings</span></a>
  <a class="nav" data-tab="chat" href="#chat">${ICON.change}<span>Change the site</span></a>
  <div class="foot">
    <div class="light" id="deploy-light"><i></i><span>Checking the last deploy…</span></div>
    <a href="${LIVE}" target="_blank">${ICON.out}<span>Open the live site</span></a>
    <a href="${REPO_URL}/actions" target="_blank">${ICON.out}<span>Cloud runs on GitHub</span></a>
  </div>
</nav>
<main>

<!-- ================================ DESK ================================ -->
<section class="pane on" id="pane-desk">
  <div class="band" id="band">
    <div><div class="k">The newsroom</div><div class="auto" id="auto"><i></i><span>Checking…</span></div><div class="m" id="auto-note" style="margin-top:4px"></div><div style="margin-top:10px"><button class="danger sm" id="pauseBtn" onclick="togglePause()" style="display:none">Pause everything</button></div></div>
    <div><div class="k">Next automatic run</div><div class="v" id="b-next">–</div></div>
    <div><div class="k">Last run</div><div class="v" id="b-last">–</div></div>
    <div><div class="k">Live on the site</div><div class="v" id="b-live">–</div></div>
    <div><div class="k">Waiting for you</div><div class="v" id="b-wait">–</div></div>
  </div>
  <div class="running" id="running" style="display:none">
    <div class="h">${ICON.spin}<span id="running-name">Working</span><span class="m" id="running-time"></span><span class="ok" id="running-count"></span><button class="danger sm" style="margin-inline-start:auto" onclick="stopJob()">Stop</button></div>
    <pre id="running-lines"></pre>
    <details><summary>Show every line</summary><pre id="log"></pre></details>
  </div>

  <p class="m" id="checks" style="margin:10px 0 0"></p>
  <details id="lessons-box" style="display:none;margin:6px 0 0"><summary class="m" id="lessons-sum"></summary><ol class="m" id="lessons-list" style="margin:6px 0 0;padding-inline-start:20px"></ol></details>
  <p class="m" id="models-used" style="margin:10px 0 0"></p>
  <h2>Every part of the paper</h2>
  <div class="cov" id="cov"></div>
  <div class="hubs" id="hubs"></div>

  <h2>Latest on the site <a href="#stories" class="m" style="font-weight:400;margin-inline-start:10px">every story, with search →</a></h2>
  <table class="list"><thead><tr><th>Story</th><th>Where</th><th>Score</th><th>Sources</th><th></th></tr></thead><tbody id="latest"></tbody></table>

  <div class="cols">
    <div>
      <h2>Waiting for your approval <span class="n" id="n-drafts">0</span></h2>
      <div id="drafts"><div class="empty">Nothing waits for you. The newsroom is publishing on its own; anything you ask for below will appear here for approval first.</div></div>
      <div id="drafts-all" style="display:none;margin-top:12px"><button class="go" onclick="publishAll()">Publish everything above</button></div>
    </div>
    <div>
      <h2>Need something now?</h2>
      <div class="get">
        <div class="row"><button class="quiet" onclick="run('news')">News stories</button><label>in <select id="newsSection"><option value="">all sections</option><option value="economy">الاقتصاد</option><option value="markets">الأسواق</option><option value="energy">الطاقة</option><option value="companies">الشركات</option><option value="technology">التكنولوجيا</option></select></label><label><select id="limit"><option>1</option><option>2</option><option selected>4</option><option>6</option><option>8</option></select> stories</label></div>
        <div class="row"><button class="quiet" onclick="run('dry')">Test one story (dry run)</button><span class="m">Uses the local controller and reports the result without saving an article.</span></div>
        <div class="row"><button class="quiet" onclick="run('explainer')">An explainer</button><button class="quiet" onclick="run('analysis')">An analysis</button><label>of <select id="analysisSection"><option value="">the week</option><option value="economy">الاقتصاد only</option><option value="markets">الأسواق only</option><option value="energy">الطاقة only</option></select></label></div>
        <div class="row"><button class="quiet" onclick="run('paper')">A research paper</button><button class="quiet" onclick="run('weekly')">The week's review</button><button class="quiet" onclick="run('feature')">In depth (في العمق)</button><button class="quiet" onclick="run('pull')">Sync from GitHub</button></div>
        <p class="m" style="margin:2px 0 0">These write drafts for your approval. News takes 8–10 minutes for four stories; the others 3–5.</p>
      </div>
      <h2>What runs on its own</h2>
      <ul class="sched" id="sched"></ul>
      <p class="m" style="margin-top:10px">All of it in the cloud, whether this laptop is on or not. The paper's sections are balanced by rule: a section with nothing for three days takes the next good story.</p>
      <div id="rejected-box" style="display:none"><h2>Refused by the copy desk, last run</h2><div id="rejected" class="m"></div></div>
    </div>
  </div>
</section>

<!-- ================================ STORIES ================================ -->
<section class="pane" id="pane-stories">
  <div class="bar">
    <input type="text" id="f-q" placeholder="Search a headline…" oninput="renderLive()">
    <select id="f-section" onchange="renderLive()"><option value="">every section</option><option value="economy">الاقتصاد</option><option value="markets">الأسواق</option><option value="energy">الطاقة</option><option value="companies">الشركات</option><option value="technology">التكنولوجيا</option><option value="analysis">تحليلات</option><option value="explainers">مدخل</option></select>
    <select id="f-kind" onchange="renderLive()"><option value="">every kind</option><option value="news">news</option><option value="analysis">analysis</option><option value="explainer">explainer</option><option value="paper">paper</option><option value="weekly">weekly</option><option value="feature">in depth</option></select>
    <select id="f-month" onchange="renderLive()"><option value="">any month</option></select>
    <select id="f-where" onchange="renderLive()"><option value="">anywhere</option><option value="front">on the front page</option><option value="section">section pages only</option></select>
    <span class="m" id="f-count"></span>
  </div>
  <table class="list"><thead><tr><th>Story</th><th>Where</th><th>Score</th><th>Sources</th><th></th></tr></thead><tbody id="live"></tbody></table>
  <p class="m" style="margin-top:14px"><b>Where</b> is the story's place right now: the front page's lead, one of the four cover stories, the ticker, or its section page (and الأحدث). Nothing is ever archived away — every story keeps its page, its section's older pages and its topic page for good, as the big dailies do.</p>
</section>

<!-- ================================ SETTINGS ================================ -->
<section class="pane" id="pane-set">
  <h2>Right now</h2>
  <div id="now" class="dots" style="font-size:15px;margin-bottom:8px">checking…</div>
  <div class="grid2">
    <div class="set">
      <h2>Who decides what goes live</h2>
      <label><span>The automatic runs in the cloud</span>
        <select id="reviewSel"><option value="0">Publish on their own — the paper never waits for me</option><option value="1">Write drafts and wait — I approve every story from the desk</option></select></label>
      <button class="go" onclick="saveReview()">Apply</button> <span class="m" id="reviewsaved"></span>
      <p class="m">Runs you start from the desk always wait for you. This is only about the cloud.</p>

      <h2>Who controls &amp; writes the website</h2>
      <p class="m">The active AI provider controls story selection, writing, fact-checking, and the copy desk. When one provider is active, all other providers stay in <b>idle mode</b> on standby with their credentials preserved.</p>

      <label><span>Active AI Controller</span>
        <select id="activeProvider" onchange="onProviderChange()">
          <option value="codex">ChatGPT subscription — Codex (no API bill)</option>
          <option value="gemini">Google Gemini (standby)</option>
          <option value="claude">Anthropic Claude (Idle / Standby)</option>
          <option value="openai">OpenAI API (separate billing)</option>
          <option value="qwen">Alibaba Qwen (Idle / Standby)</option>
          <option value="openrouter">OpenRouter / Multi-model Hub (Idle / Standby)</option>
        </select>
      </label>

      <div style="display:flex;align-items:flex-end;gap:8px">
        <label style="flex:1"><span>Model for the newsroom</span>
          <select id="newsroomModel"></select>
        </label>
        <button class="quiet sm" type="button" style="margin-bottom:8px" onclick="refreshModels()" title="Query API for newly released models">↻ Discover Models</button>
      </div>

      <label id="thinkingRow"><span>Reasoning &amp; Thinking depth (Gemini)</span>
        <select id="thinkingBudget">
          <option value="-1">Deepest Reasoning (Maximum / Unlimited) — Recommended</option>
          <option value="32768">High Reasoning (32,768 thinking tokens)</option>
          <option value="8192">Balanced Reasoning (8,192 thinking tokens)</option>
          <option value="2048">Fast Reasoning (2,048 thinking tokens)</option>
          <option value="0">Standard / No Extra Thinking (0 tokens)</option>
        </select>
      </label>

      <label id="effortRow"><span>How hard Claude thinks (effort)</span>
        <select id="claudeEffort">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Extra</option>
          <option value="max">Max (3.5× or more usage)</option>
        </select>
      </label>

      <label><span>Model for the "Change the site" chat</span>
        <select id="chatModel">
          <option value="">Default (same as newsroom)</option>
          <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
          <option value="gemini-4-argon">Gemini 4 Argon</option>
          <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
          <option value="gpt-6.1-sol">GPT-6.1 Sol</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o mini</option>
          <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
          <option value="claude-opus-5-5">Claude Opus 5.5</option>
        </select>
      </label>

      <button class="go" id="applyWriters" onclick="saveWriters()">Apply Controller &amp; Model</button> <span class="m" id="writersaved"></span>
      <button class="quiet" type="button" onclick="saveWriters(true)">Use locally for testing</button>
      <p class="m">Apply updates this laptop and GitHub cloud runs. Use locally for testing changes this laptop only; start a dry run from the Desk to preview a story.</p>

      <h2>API Keys &amp; Credentials Vault</h2>
      <div id="keystatus" style="display:none"></div>

      <div class="keycard" id="card_codex">
        <div class="khead">
          <div><b>ChatGPT subscription — Codex</b> <span class="badge" id="badge_codex">checking…</span><br><span class="m" id="ks_codex">checking…</span><br><span class="m">Reasoning effort: ${CODEX_REASONING_EFFORT}. Applies to local and GitHub cloud calls after deployment.</span></div>
          <span id="act_btn_codex"></span>
        </div>
        <p class="m">Uses your ChatGPT subscription allowance, with no Platform API key. Connect another account below and select it when needed. A cancelled or unusable subscription stops its model calls; it never starts paid API calls or silently switches providers.</p>
        <button class="quiet sm" type="button" onclick="testCodex(this)">Test ChatGPT subscription</button> <span class="m" id="codex-test" role="status" aria-live="polite"></span>
        <h3>Primary and backup accounts</h3>
        <p class="m">Keep both accounts signed in. Prefer the primary; use the backup when a quota window is exhausted. Return to the primary once its allowance is available. If both are exhausted, stop until a reported reset. Authentication refreshes automatically while the sessions remain valid.</p>
        <div class="keyrow"><label>Run location<select id="pool-target" onchange="renderPoolSelectors()"><option value="local">This laptop</option><option value="cloud">GitHub scheduled publishing</option></select></label><label>Primary account<select id="pool-primary"></select></label><label>Backup account<select id="pool-backup"></select></label></div>
        <p><label><input type="checkbox" id="pool-enabled" style="width:auto"> Enable quota fallback</label></p>
        <button class="quiet sm" id="pool-save" onclick="saveAccountPool()">Save account pair</button> <button class="quiet sm" onclick="refreshCloudQuotas()">Read latest cloud usage report</button>
        <p class="m" id="pool-note" role="status" aria-live="polite"></p>
        <div id="chatgpt-accounts"></div>
        <p class="m">Subscription expiry: OpenAI sign-in does not provide a reliable current cancellation/renewal date. Dates below are reminders entered by you; token expiry is different and refreshes automatically.</p>
        <div class="keyrow"><label><span>New connection</span><select id="chatgpt-target"><option value="local">Another account for this laptop</option><option value="cloud">Separate sign-in for GitHub scheduled publishing</option></select></label><label><span>Sign-in method</span><select id="chatgpt-method"><option value="browser">Browser sign-in</option><option value="device">Device code</option></select></label><button class="quiet" type="button" onclick="connectChatGPT()">Connect ChatGPT account</button></div>
        <p class="m" id="chatgpt-login" role="status" aria-live="polite"></p>
      </div>

      <!-- Gemini Card -->
      <div class="keycard" id="card_gemini">
        <div class="khead">
          <div><b>Google Gemini API Key</b> <span class="badge" id="badge_gemini">checking…</span><br><span class="m" id="ks_gemini">checking…</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span id="act_btn_gemini"></span>
            <button class="quiet sm" onclick="reveal('k_gemini')">Edit</button>
          </div>
        </div>
        <div class="keyrow" id="w_k_gemini" style="display:none">
          <label><input type="password" id="k_gemini" placeholder="AIzaSy... (Gemini API key)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('GEMINI_API_KEY','k_gemini')">Save</button>
        </div>
      </div>

      <!-- Claude Card -->
      <div class="keycard" id="card_claude">
        <div class="khead">
          <div><b>Claude Subscription Token</b> <span class="badge" id="badge_claude">checking…</span><br><span class="m" id="ks_oauth">checking…</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span id="act_btn_claude"></span>
            <button class="quiet sm" onclick="reveal('k_oauth')">Edit</button>
          </div>
        </div>
        <div class="keyrow" id="w_k_oauth" style="display:none">
          <label><input type="password" id="k_oauth" placeholder="sk-ant-oat... (Claude CLI token)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('CLAUDE_CODE_OAUTH_TOKEN','k_oauth')">Save</button>
        </div>
        <div class="khead" style="margin-top:8px">
          <div><b>Claude Direct API Key</b> <span class="m">— pay-per-use alternative</span><br><span class="m" id="ks_ant">checking…</span></div>
          <button class="quiet sm" onclick="reveal('k_ant')">Edit</button>
        </div>
        <div class="keyrow" id="w_k_ant" style="display:none">
          <label><input type="password" id="k_ant" placeholder="sk-ant-api... (Claude API key)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('ANTHROPIC_API_KEY','k_ant')">Save</button>
        </div>
      </div>

      <!-- OpenAI Card -->
      <div class="keycard" id="card_openai">
        <div class="khead">
          <div><b>OpenAI API Key</b> <span class="badge" id="badge_openai">checking…</span><br><span class="m" id="ks_openai">checking…</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span id="act_btn_openai"></span>
            <button class="quiet sm" onclick="reveal('k_openai')">Edit</button>
          </div>
        </div>
        <div class="keyrow" id="w_k_openai" style="display:none">
          <label><input type="password" id="k_openai" placeholder="sk-proj-... (OpenAI key)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('OPENAI_API_KEY','k_openai')">Save</button>
        </div>
        <p class="m"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Create an API key</a> · <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">Set up API billing</a>. API usage is billed separately from your ChatGPT subscription.</p>
        <p class="m">Save the key above, then test GPT-6.1 Sol here. If OpenAI is selected above, the test uses its selected newsroom model. This makes one small billed request and leaves the active controller unchanged.</p>
        <button class="quiet sm" type="button" onclick="testOpenAI(this)">Test OpenAI connection</button> <span class="m" id="openai-test" role="status" aria-live="polite"></span>
      </div>

      <!-- Qwen Card -->
      <div class="keycard" id="card_qwen">
        <div class="khead">
          <div><b>Alibaba Qwen / DashScope Key</b> <span class="badge" id="badge_qwen">checking…</span><br><span class="m" id="ks_qwen">checking…</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span id="act_btn_qwen"></span>
            <button class="quiet sm" onclick="reveal('k_qwen')">Edit</button>
          </div>
        </div>
        <div class="keyrow" id="w_k_qwen" style="display:none">
          <label><input type="password" id="k_qwen" placeholder="sk-... (DashScope key)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('DASHSCOPE_API_KEY','k_qwen')">Save</button>
        </div>
      </div>

      <!-- OpenRouter Card -->
      <div class="keycard" id="card_openrouter">
        <div class="khead">
          <div><b>OpenRouter API Key</b> <span class="badge" id="badge_openrouter">checking…</span><br><span class="m" id="ks_openrouter">checking…</span></div>
          <div style="display:flex;gap:6px;align-items:center">
            <span id="act_btn_openrouter"></span>
            <button class="quiet sm" onclick="reveal('k_openrouter')">Edit</button>
          </div>
        </div>
        <div class="keyrow" id="w_k_openrouter" style="display:none">
          <label><input type="password" id="k_openrouter" placeholder="sk-or-... (OpenRouter key)" autocomplete="off"></label>
          <button class="quiet" onclick="saveKey('OPENROUTER_API_KEY','k_openrouter')">Save</button>
        </div>
      </div>

      <p style="margin-top:14px"><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="k_gh" checked style="width:auto;margin:0"> Also send it to GitHub, so the cloud can use it</label> <span class="m" id="k_note"></span></p>
    </div>
    <div class="set">
      <h2>The newspaper</h2>
      <label><span>Contact email <span class="m">— AdSense will not approve the site without one</span></span><input type="email" id="contactEmail" value="${esc(current.contactEmail)}"></label>
      <label><span>Publisher name</span><input type="text" id="publisher" value="${esc(current.publisher)}"></label>
      <label><span>AdSense publisher id <span class="m">— looks like ca-pub-1234567890</span></span><input type="text" id="adsenseClient" value="${esc(current.adsenseClient)}"></label>
      <label><span>Google verification code</span><input type="text" id="googleSiteVerification" value="${esc(current.googleSiteVerification)}"></label>
      <label><span>Visible to search engines?</span>
        <select id="private"><option value="true"${current.private ? " selected" : ""}>No — keep it unlisted (before launch)</option><option value="false"${current.private ? "" : " selected"}>Yes — ask Google and Bing to list it (launch)</option></select></label>
      <button class="go" onclick="saveSettings()">Save and publish</button> <span class="m" id="saved"></span>

      <h2>Is everything switched on?</h2>
      <div id="switches" class="m dots">checking…</div>
    </div>
  </div>
</section>

<!-- ================================ CHAT ================================ -->
<section class="pane" id="pane-chat">
  <h2>Change the site</h2>
  <p class="m" style="margin:0 0 12px">For changing how the paper <b>looks and works</b> — the design, a page, the newsroom's rules, its sources. Running the paper is done on the Desk. Arabic or English: <i>"الخط صغير في الموبايل"</i>, <i>"add the Saudi central bank feed"</i>, <i>"why does the copy desk keep refusing Al Jazeera stories?"</i></p>
  <div id="thread"><div class="empty" id="thread-empty">Ask below. The answer appears right here, in this thread, usually within a minute — with a line for each thing it does on the way.</div></div>
  <div class="ask"><textarea id="msg" placeholder="Type here, then press Enter…"></textarea><button class="go" id="send" onclick="ask()">Send</button></div>
  <div class="chg" id="changes" style="display:none">
    <b>Site changes not live yet — your call</b>
    <div id="changes-body"></div>
    <button class="go" onclick="publishChanges()">Publish to the live site</button>
    <button class="quiet" onclick="run('build')">Preview locally first</button>
    <button class="danger" onclick="undoChanges()">Undo the last change</button>
  </div>
</section>
</main>
<div id="overlay" onclick="if(event.target===this)closePreview()"><div id="preview"></div></div>

<script>
var TOKEN=${JSON.stringify(DESK_TOKEN)};
// Every request to the desk carries its token (the door, in the server). A tab left open from before a restart holds
// the old one: the desk answers 401 and the tab reloads itself once to take the new one.
var deskFetch=window.fetch.bind(window);
window.fetch=function(u,o){o=o||{};var h=new Headers(o.headers||{});if(new URL(u,location.href).origin===location.origin)h.set('x-khazendar-token',TOKEN);o.headers=h;return deskFetch(u,o).then(function(r){if(r.status===401)reloadOnce();return r})};
function reloadOnce(){try{if(Date.now()-(+sessionStorage.getItem('desk-reload')||0)<15000)return;sessionStorage.setItem('desk-reload',String(Date.now()))}catch(e){}location.reload()}
// A link from a story's data opens only a web page: a «javascript:» address would run inside the desk.
var link=function(u){u=String(u==null?'':u).trim();return /^https?:/i.test(u)?u:'#'};
var LIVE_URL=${JSON.stringify(LIVE)};
var SECTION=${JSON.stringify(SECTION_NAME)};
var DOTS=${JSON.stringify(ICON.dots)};
var KIND={news:'news',explainer:'explainer',analysis:'analysis',paper:'paper reading',weekly:'weekly review',feature:'in depth'};
var WHERE={lead:'Front page · the lead','cover 2':'Front page · cover 2','cover 3':'Front page · cover 3','cover 4':'Front page · cover 4','cover 5':'Front page · cover 5',ticker:'Front page · ticker',section:'Section page',hub:'Its hub'};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var rtl=function(s){return /[\\u0600-\\u06FF]/.test(s)};
var post=function(url,body){return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined})};
var fmtWhen=function(iso){if(!iso)return '–';var d=new Date(iso);return d.toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})};
var ago=function(iso){if(!iso)return 'never';var h=(Date.now()-Date.parse(iso))/36e5;if(h<1)return Math.round(h*60)+' min ago';if(h<48)return Math.round(h)+' h ago';return Math.round(h/24)+' days ago'};
var utcToLocal=function(hhmm){if(!hhmm)return '';var p=hhmm.split(':');var d=new Date();d.setUTCHours(+p[0],+p[1],0,0);return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})};

// ---- navigation
function show(tab){document.querySelectorAll('.rail a.nav').forEach(function(a){a.classList.toggle('on',a.dataset.tab===tab)});document.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+tab)});if(tab==='chat')document.getElementById('msg').focus()}
document.querySelectorAll('.rail a.nav').forEach(function(a){a.onclick=function(e){e.preventDefault();location.hash=a.dataset.tab;show(a.dataset.tab)}});
show((location.hash||'#desk').slice(1));
window.addEventListener('hashchange',function(){show((location.hash||'#desk').slice(1))});

// ---- state
var LIVE=[],wasRunning=false,timer=null;
function refresh(){fetch('/api/state').then(function(r){return r.json()}).then(function(s){try{render(s);}catch(e){console.error('Render error:',e);}clearTimeout(timer);timer=setTimeout(refresh,s&&s.job&&s.job.running?3000:20000)}).catch(function(err){console.error('State fetch error:',err);timer=setTimeout(refresh,5000)})}
function scoreTag(s){if(s==null||s==='')return '<span class="score">–</span>';var c=s>=8?'hi':(s<=5?'lo':'');return '<span class="score '+c+'">'+s+'</span>'}
function srcList(list){return '<details><summary>'+list.length+' source'+(list.length===1?'':'s')+'</summary><ul>'+list.map(function(s){return '<li><a href="'+esc(link(s.url))+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul></details>'}
function render(s){
  document.getElementById('b-next').innerHTML=esc(fmtWhen(s.nextCloudRun));
  document.getElementById('b-last').innerHTML=s.lastRun?esc(KIND[s.lastRun.mode]||s.lastRun.mode)+' <small>· '+s.lastRun.published+' written · '+esc(ago(s.lastRun.startedAt))+'</small>':'–';
  document.getElementById('b-live').textContent=s.live.length+' stories';
  document.getElementById('b-wait').innerHTML=s.drafts.length?'<span class="ok">'+s.drafts.length+' draft'+(s.drafts.length>1?'s':'')+'</span>':'<span style="font-weight:400;color:var(--ink-3)">nothing</span>';
  var used=document.getElementById('models-used');
  if(used){
    var cleanList=s.modelsUsed.map(function(m){
      var id=esc(m.id).replace(/^claude-cli\\//,'Claude ').replace(/^gemini\\//,'Gemini ').replace(/^openai\\//,'OpenAI ').replace(/^qwen\\//,'Qwen ').replace(/^openrouter\\//,'OpenRouter ').replace(/:free$/,'');
      return '<code>'+id+'</code> ×'+m.n;
    });
    used.innerHTML=cleanList.length?'Wrote the last 24 h: '+cleanList.join(' · '):'';
  }
  var quietCut=Date.now()-72*36e5;
  var NEWS=['economy','markets','energy','companies','technology'];
  var covEl = document.getElementById('cov');
  if (covEl) covEl.innerHTML=s.coverage.filter(function(c){return NEWS.indexOf(c.id)>=0}).map(function(c){var q=!c.last||Date.parse(c.last)<quietCut;return '<div class="'+(q?'quiet':'')+'"><div class="s">'+esc(c.name)+'</div><div class="c"><b>'+c.day+'</b> today · <b>'+c.week+'</b> this week<br>'+(c.last?'last '+esc(ago(c.last)):'nothing yet')+(q&&c.last?' · due for one':'')+'</div></div>'}).join('');
  var hubsEl = document.getElementById('hubs');
  if (hubsEl) hubsEl.innerHTML=s.coverage.filter(function(c){return NEWS.indexOf(c.id)<0}).map(function(c){return '<span><b>'+esc(c.name)+'</b> · '+c.week+' this week · last '+esc(ago(c.last))+'</span>'}).join('');
  var schedEl = document.getElementById('sched');
  if (schedEl) schedEl.innerHTML=s.schedule.map(function(x){return '<li><span>'+esc(x.what)+'</span><span>'+esc(x.when)+(x.utc?' at '+utcToLocal(x.utc):'')+'</span></li>'}).join('');
  var r=document.getElementById('running');
  if (r) {
    r.style.display=s.job.running?'grid':'none';
    if(s.job.running){document.getElementById('running-name').textContent='Working: '+s.job.name;var secs=Math.round((Date.now()-s.job.startedAt)/1000);document.getElementById('running-time').textContent=Math.floor(secs/60)+'m '+(secs%60)+'s';var c=s.job.counts;document.getElementById('running-count').textContent=c&&s.job.kind==='news'?'· '+c.written+(c.target?' of '+c.target:'')+' written'+(c.refused?' · '+c.refused+' refused':''):'';document.getElementById('running-lines').textContent=s.job.progress.join('\\n')||'starting…';document.getElementById('log').textContent=s.job.log.join('\\n')}
    else if(wasRunning){document.getElementById('auto-note').textContent=s.job.exitCode===0?'Finished: '+s.job.name+'.':'Stopped or failed: '+s.job.name+'.'}
  }
  wasRunning=Boolean(s.job.running);
  var ndEl = document.getElementById('n-drafts');
  if (ndEl) ndEl.textContent=s.drafts.length;
  var dEl = document.getElementById('drafts');
  if (dEl) dEl.innerHTML=s.drafts.length?s.drafts.map(draft).join(''):'<div class="empty">Nothing waits for you. The newsroom is publishing on its own; anything you ask for on the right appears here for approval first.</div>';
  var daEl = document.getElementById('drafts-all');
  if (daEl) daEl.style.display=s.drafts.length>1?'block':'none';
  var rej=(s.lastRun&&s.lastRun.report||[]).filter(function(x){return /^rejected|^skip/.test(x.outcome||'')});
  var rbEl = document.getElementById('rejected-box');
  if (rbEl) rbEl.style.display=rej.length?'block':'none';
  var rjEl = document.getElementById('rejected');
  if (rjEl) rjEl.innerHTML=rej.map(function(x){return '<p><span class="ar" style="display:block;font-size:15px;color:var(--ink)">'+esc(x.title||x.headline||'')+'</span>'+esc((x.outcome||'').replace(/^rejected (after revision|by critic after revision \\(\\d+\\)): /,'').slice(0,200))+'</p>'}).join('');
  LIVE = s.live;
  renderChecks(s);
  renderLive();
}
function renderChecks(s){
  var q=s.quality&&s.quality.week,b=s.quality&&s.quality.weekBefore,h=s.health&&s.health.last,parts=[];
  if(q&&q.outcomes){var oc=q.outcomes;parts.push('<b>Fixed and verified this week</b> '+oc.repairedBeforePublication+' error'+(oc.repairedBeforePublication===1?'':'s')+' repaired before publication, '+oc.correctionsVerifiedClean+' correction'+(oc.correctionsVerifiedClean===1?'':'s')+' read clean afterwards · <b>Flagged, not fixed</b> '+oc.heldBeforePublication+' held, '+oc.correctionsStuck+' correction'+(oc.correctionsStuck===1?'':'s')+' left unresolved'+(oc.correctionsNotVerifiedYet?', '+oc.correctionsNotVerifiedYet+' not read again':''))}
  if(q&&q.precheck&&q.precheck.checked){var pc=q.precheck;parts.push('<b>Checked before publication</b> '+pc.checked+' this week: '+pc.clean+' clean, '+pc.repaired+' repaired'+(pc.errorsFound?' ('+pc.errorsFound+' proved error'+(pc.errorsFound===1?'':'s')+' caught before readers saw them)':'')+(pc.held?', <b>'+pc.held+' held</b>'+(pc.heldTitles&&pc.heldTitles.length?': '+pc.heldTitles.map(esc).join('; '):''):''))}
  if(q){var sl=q.secondLook;parts.push('<b>Second look</b> '+sl.read+' stor'+(sl.read===1?'y':'ies')+' read again this week'+(sl.corrected?', '+sl.corrected+' corrected':'')+(sl.listed?', '+sl.listed+' with an error listed':''));
    if(q.styleFaultsPerStory!=null)parts.push('<b>Style faults</b> '+q.styleFaultsPerStory+' a story'+(b&&b.styleFaultsPerStory!=null?' (last week '+b.styleFaultsPerStory+')':''))}
  if(h){var ph=h.photos||{};parts.push('<b>Photos</b> '+(ph.pending||(ph.redo&&ph.redo.length)?(ph.pending||0)+' being checked'+(ph.redo&&ph.redo.length?', '+ph.redo.length+' replaced':''):'all in place'));
    if(h.owner&&h.owner.length)parts.push('<b style="color:var(--amber)">Needs you: '+h.owner.map(esc).join('; ')+'</b>')}
  document.getElementById('checks').innerHTML=parts.length?'Daily checks, no Claude unless something is wrong: '+parts.join(' · '):'';
  var L=s.lessons,act=L&&L.lessons?L.lessons.filter(function(l){return l.status==='active'}):[];
  var E=s.quality&&s.quality.evidence;
  if(E&&E.vsNone){var n=E.vsNone,d=E.lastDecision;document.getElementById('checks').innerHTML+=' · <b>Do the lessons help?</b> '+(n.e>=20?'<b>proven</b>':'not proven yet')+': better in '+n.better+' paired stories, worse in '+n.worse+' (evidence ×'+n.e.toFixed(1)+', 20 proves)'+(d?' · <b>Weekly decision</b> '+esc(d.at.slice(0,10))+': '+({promote:'the lessons were promoted',revert:'reverted to the last approved lessons',keep:'kept, unproven',frozen:'frozen, the fact-check is in doubt'}[d.decision]||esc(d.decision)):'')+(E.canary&&E.canary.alarm?' · <b style="color:var(--amber)">The fact-check missed planted errors</b>':'')}
  document.getElementById('lessons-box').style.display=act.length?'block':'none';
  if(act.length){document.getElementById('lessons-sum').innerHTML='<b>What the newsroom has learned</b>: '+act.length+' lessons from '+((L.used||[]).length)+' mistakes it printed and corrected; the writer reads them before every story';
    document.getElementById('lessons-list').innerHTML=act.sort(function(a,b){return b.seen-a.seen}).map(function(l){return '<li>'+esc(l.rule)+' <span style="color:var(--ink-3)">('+esc(l.class)+', seen '+l.seen+'×)</span></li>'}).join('')}
}
function draft(a){var writer=(a.models&&a.models.writer)?String(a.models.writer).split('→').pop().trim().split('/').pop():'';return '<div class="draft">'+(a.image?'<img src="'+esc(a.image)+'" alt="">':'<div class="noimg">no photo</div>')+'<div><h3>'+esc(a.title)+'</h3><p>'+esc(a.subtitle)+'</p><div class="meta">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+scoreTag(a.score)+' '+esc(a.verdict)+(a.hasChart?' · chart':'')+(a.hasTable?' · table':'')+' · '+a.sources.length+' sources'+(a.committed?' · from the cloud':'')+(writer?' · <span style="opacity:0.75" title="Writer: '+esc(a.models.writer)+'">'+esc(writer)+'</span>':'')+'</div><div class="acts"><button class="quiet sm" data-file="'+esc(a.file)+'" onclick="openPreview(this.dataset.file)">Read it</button><button class="go sm" data-file="'+esc(a.file)+'" onclick="publish(this.dataset.file)">Publish</button><button class="danger sm" data-file="'+esc(a.file)+'" data-slug="'+esc(a.slug)+'" onclick="discard(this.dataset.file,this.dataset.slug)">Discard</button></div></div></div>'}
function renderLive(){
  var sec=document.getElementById('f-section').value,kind=document.getElementById('f-kind').value,month=document.getElementById('f-month').value,where=document.getElementById('f-where').value,q=document.getElementById('f-q').value.trim().toLowerCase();
  var rows=LIVE.filter(function(a){var front=a.where!=='section'&&a.where!=='hub';return (!sec||a.section===sec)&&(!kind||a.kind===kind)&&(!month||a.publishedAt.slice(0,7)===month)&&(!where||(where==='front'?front:!front))&&(!q||(a.title+' '+a.subtitle).toLowerCase().indexOf(q)>=0)});
  document.getElementById('f-count').textContent=rows.length===LIVE.length?LIVE.length+' stories':rows.length+' of '+LIVE.length;
  document.getElementById('live').innerHTML=rows.slice(0,200).map(rowHtml).join('');
}
function rowHtml(a){var front=a.where!=='section'&&a.where!=='hub';
    var writer=(a.models&&a.models.writer)?String(a.models.writer).split('→').pop().trim().split('/').pop():'';
    return '<tr><td class="t"><a href="'+LIVE_URL+'/articles/'+esc(a.slug)+'/" target="_blank">'+esc(a.title)+'</a><div class="meta">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+esc(fmtWhen(a.publishedAt))+(a.featured?' · ★ featured':'')+(writer?' · <span style="opacity:0.75" title="Writer: '+esc(a.models.writer)+'">'+esc(writer)+'</span>':'')+'</div></td>'+
      '<td><span class="chip'+(front?' front':'')+'">'+esc(WHERE[a.where]||a.where)+'</span></td><td>'+scoreTag(a.score)+'</td><td class="src">'+srcList(a.sources)+'</td>'+
      '<td><details class="menu"><summary aria-label="Actions">'+DOTS+'</summary><div class="pop">'+
      '<a href="'+LIVE_URL+'/articles/'+esc(a.slug)+'/" target="_blank">Open on the site</a>'+
      (a.kind==='news'?(a.featured?'<button data-file="'+esc(a.file)+'" onclick="feature(this.dataset.file,false)">Take it off the lead</button>':'<button data-file="'+esc(a.file)+'" onclick="feature(this.dataset.file,true)">Make it the lead (48 h)</button>')+'<div class="sep"></div><div class="lbl">Move to</div><div class="secs">'+['economy','markets','energy','companies','technology'].filter(function(s){return s!==a.section}).map(function(s){return '<button data-file="'+esc(a.file)+'" data-sec="'+s+'" onclick="moveTo(this.dataset.file,this.dataset.sec)">'+esc(SECTION[s])+'</button>'}).join('')+'</div>':'')+
      '<div class="sep"></div><button class="d" data-file="'+esc(a.file)+'" data-title="'+esc(a.title)+'" onclick="unpublish(this.dataset.file,this.dataset.title)">Unpublish</button></div></details></td></tr>'}
document.addEventListener('click',function(e){document.querySelectorAll('details.menu[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open')})});
refresh();

// ---- actions
function run(kind){var limit=document.getElementById('limit').value;var sec=kind==='news'?document.getElementById('newsSection').value:kind==='analysis'?document.getElementById('analysisSection').value:'';post('/run?kind='+kind+'&limit='+limit+(sec?'&sections='+sec:'')).then(function(r){return r.text()}).then(function(t){if(!/^started/.test(t))alert(t);refresh()})}
function stopJob(){post('/stop').then(refresh)}
function publish(file){post('/publish?file='+encodeURIComponent(file)).then(function(r){return r.text()}).then(function(t){if(!/^Publishing/.test(t))alert(t);closePreview();refresh()})}
function publishAll(){if(!confirm('Publish every waiting story to the live site?'))return;post('/publish-all').then(function(r){return r.text()}).then(function(t){if(!/^Publishing/.test(t))alert(t);refresh()})}
function discard(file,slug){if(!confirm('Throw this draft away? It will not come back on the next run.'))return;post('/discard?file='+encodeURIComponent(file)+'&slug='+encodeURIComponent(slug)).then(function(){closePreview();refresh()})}
function unpublish(file,title){if(!confirm('Remove this story from the live site?\\n\\n'+title))return;post('/unpublish?file='+encodeURIComponent(file)).then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}
function feature(file,on){post('/feature?file='+encodeURIComponent(file)+'&on='+(on?1:0)).then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}
function moveTo(file,section){post('/move?file='+encodeURIComponent(file)+'&section='+section).then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}

// ---- preview
function openPreview(file){var box=document.getElementById('preview');box.innerHTML='<p class="m">loading…</p>';document.getElementById('overlay').classList.add('on');
  fetch('/draft?file='+encodeURIComponent(file)).then(function(r){return r.json()}).then(function(a){var d=a.data;
    box.innerHTML='<div class="bar"><button class="go" data-file="'+esc(file)+'" onclick="publish(this.dataset.file)">Publish this</button><button class="danger" data-file="'+esc(file)+'" data-slug="'+esc(d.slug)+'" onclick="discard(this.dataset.file,this.dataset.slug)">Discard</button><button class="quiet x" onclick="closePreview()">Close</button></div>'+
      '<article><h1>'+esc(d.title)+'</h1><p class="sub">'+esc(d.subtitle)+'</p>'+(d.image?'<img src="'+esc(d.image.url)+'" alt="'+esc(d.image.alt)+'"><div class="credit">'+esc(d.image.credit||'')+'</div>':'')+'<p class="lede">'+esc(d.lede)+'</p>'+
      ((d.keyFacts||[]).length?'<div class="facts"><ul>'+d.keyFacts.map(function(f){return '<li>'+(f.label?'<b>'+esc(f.label)+':</b> ':'')+esc(f.value)+'</li>'}).join('')+'</ul></div>':'')+a.bodyHtml+(d.whyItMatters?'<div class="why"><b>لماذا يهم؟</b> '+esc(d.whyItMatters)+'</div>':'')+
      (d.chart?'<p class="m" style="direction:ltr;text-align:left">Carries a chart ('+esc(d.chart.title||d.chart.type)+'); it renders on the site.</p>':'')+(d.table?'<p class="m" style="direction:ltr;text-align:left">Carries a table; it renders on the site.</p>':'')+'</article>'+
      '<div class="meta"><b>Sources</b><ul>'+(d.sources||[]).map(function(s){return '<li><a href="'+esc(link(s.url))+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul><b>Quality</b> '+scoreTag(d.quality&&d.quality.score)+' '+esc(d.quality&&d.quality.verdict||'')+(d.quality&&d.quality.criticSummary?'<div class="ar m" style="margin-top:4px">'+esc(d.quality.criticSummary)+'</div>':'')+'<div class="m" style="margin-top:6px">Written by '+esc((d.models&&d.models.writer)||'?')+' · checked by '+esc((d.models&&d.models.critic)||'?')+'</div></div>'})}
function closePreview(){document.getElementById('overlay').classList.remove('on')}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closePreview()});

// ---- health / settings
var HEALTH_DATA = null;
function dot(ok,label,note){return '<p><span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:8px;background:'+(ok===null?'#c9a227':ok?'var(--green)':'var(--red)')+'"></span><b>'+label+'</b>'+(note?' <span class="m">— '+note+'</span>':'')+'</p>'}

function updateModelOptions(h) {
  var pSel = document.getElementById('activeProvider');
  if (!pSel) return;
  var prov = pSel.value;
  var apply=document.getElementById('applyWriters');if(apply){apply.disabled=prov==='codex';apply.title=prov==='codex'?'Choose an account below for GitHub scheduled publishing.':'';}
  var p = (h && h.providers && h.providers[prov]) || (HEALTH_DATA && HEALTH_DATA.providers && HEALTH_DATA.providers[prov]);
  var mSel = document.getElementById('newsroomModel');
  if (!p || !mSel) return;
  var currentModel = p.model || p.models[0];
  var models = [currentModel].concat(p.models).filter(function(m,i,a){return a.indexOf(m)===i});
  mSel.innerHTML = models.map(function(m){
    return '<option value="'+esc(m)+'"'+(m===currentModel?' selected':'')+'>'+esc(m)+'</option>';
  }).join('');
}

function onProviderChange() {
  var pSel = document.getElementById('activeProvider');
  var prov = pSel ? pSel.value : 'gemini';
  var thinkRow = document.getElementById('thinkingRow');
  if (thinkRow) thinkRow.style.display = prov === 'gemini' ? 'block' : 'none';
  var effortRow = document.getElementById('effortRow');
  if (effortRow) effortRow.style.display = prov === 'claude' ? 'block' : 'none';
  updateModelOptions(HEALTH_DATA);
}

function quickActivate(id) {
  var pSel = document.getElementById('activeProvider');
  if (pSel) pSel.value = id;
  onProviderChange();
  saveWriters(id === 'codex');
}

function refreshModels() {
  var prov = document.getElementById('activeProvider').value;
  var btn = event.target;
  var old = btn.textContent;
  btn.textContent = 'Querying API…';
  fetch('/models/refresh?provider=' + encodeURIComponent(prov))
    .then(function(r) { return r.json(); })
    .then(function(res) {
      btn.textContent = old;
      if (res.models && res.models.length) {
        if (HEALTH_DATA && HEALTH_DATA.providers && HEALTH_DATA.providers[res.provider]) {
          HEALTH_DATA.providers[res.provider].models = res.models;
        }
        updateModelOptions(HEALTH_DATA);
        alert('Discovered ' + res.models.length + ' available models directly from ' + res.provider.toUpperCase() + ' API.');
      } else {
        alert(res.error || 'No models returned from API.');
      }
    })
    .catch(function(err) {
      btn.textContent = old;
      alert('Error fetching models: ' + err.message);
    });
}

function loadHealth(){fetch('/health').then(function(r){return r.json()}).then(function(h){
  if (!h) return;
  HEALTH_DATA = h;
  var cloud = h.cloud || {};
  var providers = h.providers || {};
  PAUSED=Boolean(cloud.paused);
  var provNames = { codex: 'ChatGPT subscription (Codex)', gemini: 'Google Gemini', claude: 'Anthropic Claude', openai: 'OpenAI API (separate billing)', qwen: 'Alibaba Qwen', openrouter: 'OpenRouter' };
  var curName = provNames[h.activeProvider] || h.activeProvider || 'Gemini';
  var curModel = (providers[h.activeProvider] && providers[h.activeProvider].model) || '';

  var auto=document.getElementById('auto');if(auto){auto.className='auto'+((cloud.review||PAUSED)?' off':'');auto.innerHTML='<i></i><span>'+(PAUSED?'PAUSED — nothing is being written or published':cloud.review?'Waits for your approval':'Publishes on its own')+'</span>';}
  var an=document.getElementById('auto-note');if(an)an.innerHTML='Controlled by <b>'+esc(curName)+'</b> ('+esc(curModel)+')'+(h.activeProvider!=='claude'?' · Claude in idle mode':'');

  var pb=document.getElementById('pauseBtn');if(pb){pb.style.display='inline-block';pb.textContent=PAUSED?'Resume':'Pause everything';pb.className=PAUSED?'go sm':'danger sm';}

  var provSummary = [];
  for (var k in providers) {
    var p = providers[k];
    provSummary.push('<b>'+esc(p.name)+':</b> '+(p.active?'<span class="ok">ACTIVE ('+esc(p.model)+')</span>':'<span class="m">Idle ('+(p.subscription?'signed in':(p.keySet||p.tokenSet)?'key saved':'not connected')+')</span>'));
  }
  var nowEl=document.getElementById('now');
  if(nowEl)nowEl.innerHTML=
    '<p><b>This laptop:</b> '+esc(curName)+' ('+esc(curModel)+')</p>'+
    '<p><b>Cloud controller:</b> '+esc(provNames[cloud.activeProvider]||cloud.activeProvider)+' ('+esc(cloud.newsroomModel)+')</p>'+
    '<p><b>The cloud runs:</b> '+(PAUSED?'are <span class="no">paused</span>':cloud.review?'write drafts and wait for you':'publish on their own')+'.</p>'+
    '<p><b>Providers Status:</b> '+provSummary.join(' · ')+'</p>';

  var pSel = document.getElementById('activeProvider');
  if (pSel) pSel.value = h.activeProvider;
  updateModelOptions(h);
  CHATGPT_ACCOUNTS = h.chatgptAccounts || []; CHATGPT_POOLS = h.chatgptPool || {};
  renderChatGPTAccounts(CHATGPT_ACCOUNTS); renderPoolSelectors();

  for (var id in h.providers) {
    var pr = h.providers[id];
    var card = document.getElementById('card_' + id);
    if (card) card.className = 'keycard' + (pr.active ? ' active' : '');
    var b = document.getElementById('badge_' + id);
    if (b) {
      b.className = 'badge ' + (pr.active ? 'active' : 'idle');
      b.textContent = pr.active ? 'ACTIVE' : 'IDLE';
    }
    var ks = document.getElementById('ks_' + id);
    if (ks) {
      var hasLocal = pr.keySet || pr.tokenSet;
      var hasCloud = pr.cloudKeySet || pr.cloudTokenSet;
      ks.innerHTML = id === 'codex' ? esc(pr.note) : hasLocal ? '<span class="ok">Saved on laptop' + (hasCloud ? ' and on GitHub' : '') + '</span>' : '<span class="m">Not set</span>';
    }
    var actSpan = document.getElementById('act_btn_' + id);
    if (actSpan) {
      if (pr.active) {
        actSpan.innerHTML = '<span class="badge ok" style="font-size:11px">Current Controller</span>';
      } else {
        var pShort = pr.name.split(' ')[0] === 'Google' || pr.name.split(' ')[0] === 'Alibaba' ? pr.name.split(' ')[1] : pr.name.split(' ')[0];
        actSpan.innerHTML = '<button class="go sm" data-pid="' + esc(id) + '" onclick="quickActivate(this.dataset.pid)">Activate ' + esc(pShort) + '</button>';
      }
    }
  }

  var ksOauth = document.getElementById('ks_oauth');
  if (ksOauth) ksOauth.innerHTML = h.providers.claude.tokenSet ? '<span class="ok">Saved' + (h.providers.claude.cloudTokenSet ? ' (laptop and GitHub)' : ' (laptop only)') + '</span>' : '<span class="no">Not set</span>';
  var ksAnt = document.getElementById('ks_ant');
  if (ksAnt) ksAnt.innerHTML = h.providers.claude.keySet ? '<span class="ok">Saved' + (h.providers.claude.cloudKeySet ? ' (laptop and GitHub)' : ' (laptop only)') + '</span>' : '<span class="m">Not set</span>';

  var dl = document.getElementById('deploy-light');
  if (dl && h.deploy) {
    dl.className = 'light ' + (h.deploy.ok ? 'ok' : 'no');
    dl.innerHTML = '<i></i><span>' + (h.deploy.ok ? 'Site deploy OK · ' + esc(fmtWhen(h.deploy.when)) : '<b>THE SITE IS NOT UPDATING</b> — last deploy failed. <a href="' + esc(h.deploy.url) + '" target="_blank">See why</a>') + '</span>';
  }

  var cm = document.getElementById('chatModel');
  if (cm) cm.value = h.chatModel === 'default' ? '' : h.chatModel;
  var tb = document.getElementById('thinkingBudget');
  if (tb && h.thinkingBudget) tb.value = h.thinkingBudget;
  var thinkRow = document.getElementById('thinkingRow');
  if (thinkRow) thinkRow.style.display = h.activeProvider === 'gemini' ? 'block' : 'none';
  var ce = document.getElementById('claudeEffort');
  if (ce && h.claudeEffort) ce.value = h.claudeEffort;
  var effortRow = document.getElementById('effortRow');
  if (effortRow) effortRow.style.display = h.activeProvider === 'claude' ? 'block' : 'none';

  var rs = document.getElementById('reviewSel');
  if (rs) rs.value = cloud.review ? '1' : '0';
  var sw = document.getElementById('switches');
  if (sw) {
    sw.innerHTML = (h.deploy ? dot(h.deploy.ok, 'The site\\\'s last deploy', h.deploy.ok ? 'succeeded · ' + fmtWhen(h.deploy.when) : 'FAILED — readers see an older edition') : '') +
      dot(h.ghOk, 'This laptop can talk to GitHub', h.ghOk ? 'gh is signed in' : 'run: gh auth login') +
      dot(cloud.editorOn && cloud.hasKey, 'The daily editor', !cloud.editorOn ? 'switched off' : cloud.hasKey ? 'switched on with active key' : 'switched on but has no key, so it skips') +
      (h.editorReal ? dot(h.editorReal.working, 'The daily editor is actually doing work', 'its last run took ' + h.editorReal.seconds + 's' + (h.editorReal.working ? '' : ' — a real round takes minutes')) : '') +
      dot(h.chatReady, 'The "Change the site" tab', h.chatReady ? 'ready (' + esc(curName) + ')' : 'needs an active key');
  }
}).catch(function(err){ console.error('Health fetch failed:', err); });}
loadHealth();
function saveKey(name,id){var v=document.getElementById(id).value.trim();if(!v)return;var n=document.getElementById('k_note');n.textContent='saving…';post('/keys',{name:name,value:v,github:document.getElementById('k_gh').checked}).then(function(r){return r.text()}).then(function(t){n.textContent=t;document.getElementById(id).value='';loadHealth()})}
function testOpenAI(btn){var n=document.getElementById('openai-test');var model=document.getElementById('activeProvider').value==='openai'?document.getElementById('newsroomModel').value:'gpt-6.1-sol';btn.disabled=true;n.textContent='Testing '+model+'…';post('/providers/openai/test',{model:model}).then(function(r){return r.json()}).then(function(r){n.textContent=r.ok?'Connected: '+r.model+' · '+r.message+' · '+(r.ms/1000).toFixed(1)+'s':r.error}).catch(function(e){n.textContent='Could not test: '+e.message}).finally(function(){btn.disabled=false})}
function testCodex(btn){var n=document.getElementById('codex-test');btn.disabled=true;n.textContent='Testing your ChatGPT subscription…';post('/providers/codex/test',{}).then(function(r){return r.json()}).then(function(r){n.textContent=r.ok?'Connected: '+r.model+' · '+r.message+' · '+r.billing:r.error}).catch(function(e){n.textContent='Could not test: '+e.message}).finally(function(){btn.disabled=false})}
var CHATGPT_ACCOUNTS=[],CHATGPT_POOLS={};
function quotaText(q){if(!q)return 'Usage not checked yet.';var windows=(q.windows||[]).map(function(w){var label=w.windowDurationMins===300?'5-hour':w.windowDurationMins===10080?'Weekly':String(w.windowDurationMins||'?')+' min';return label+': '+(w.usedPercent==null?'unknown':Math.max(0,100-w.usedPercent)+'% remaining')+(w.resetsAt?' · resets '+new Date(w.resetsAt).toLocaleString():'')});return windows.join(' | ')+(q.exhausted?' · exhausted':'')+(q.checkedAt?' · checked '+new Date(q.checkedAt).toLocaleString():'')}
function renderChatGPTAccounts(accounts){document.getElementById('chatgpt-accounts').innerHTML=accounts.map(function(a){return '<div style="border-top:1px solid var(--rule);margin-top:12px;padding-top:10px"><b>'+esc(a.email||a.label)+'</b> '+esc(a.plan)+(a.active?' · selected local account':'')+(a.cloudActive?' · connected to cloud':'')+(a.inUse?' · last used':'')+' · '+esc(a.target==='cloud'?'scheduled publishing sign-in':'local sign-in')+'<p class="m">'+esc(quotaText(a.quota))+'</p>'+(a.target==='local'?'<button class="quiet sm" data-id="'+esc(a.id)+'" onclick="refreshUsage(this)">Refresh usage</button>':'')+'<div class="row"><label>Expected access end (your reminder) <input type="date" id="expiry-'+esc(a.id)+'" value="'+esc(a.expectedEnd)+'"></label><button class="quiet sm" data-id="'+esc(a.id)+'" onclick="saveChatGPTDate(this.dataset.id)">Save date</button><button class="quiet sm" data-id="'+esc(a.id)+'" data-target="'+esc(a.target)+'" onclick="useChatGPT(this.dataset.id,this.dataset.target)">'+(a.target==='cloud'?'Use for GitHub scheduled publishing':'Use this account')+'</button></div></div>'}).join('')}
function renderPoolSelectors(){var target=document.getElementById('pool-target').value;var accounts=CHATGPT_ACCOUNTS.filter(function(a){return a.target===target});var pool=CHATGPT_POOLS[target]||{};var options=accounts.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.email||a.label)+'</option>'}).join('');document.getElementById('pool-primary').innerHTML=options;document.getElementById('pool-backup').innerHTML='<option value="">No backup</option>'+options;document.getElementById('pool-primary').value=pool.primary||(accounts[0]&&accounts[0].id)||'';document.getElementById('pool-backup').value=pool.backup||'';document.getElementById('pool-enabled').checked=Boolean(pool.enabled);document.getElementById('pool-save').disabled=!accounts.length;document.getElementById('pool-note').textContent=accounts.length<2?'Connect the second account below, then choose it as backup.':pool.enabled?'Quota fallback is configured. Both accounts stay connected.':'Choose two different accounts and enable quota fallback.'}
function saveAccountPool(){var target=document.getElementById('pool-target').value;var enabled=document.getElementById('pool-enabled').checked;var primary=document.getElementById('pool-primary').value,backup=enabled?document.getElementById('pool-backup').value:'';var n=document.getElementById('pool-note');if(enabled&&(!backup||primary===backup)){n.textContent='Choose two different accounts first.';return}n.textContent='Saving account pair…';post(target==='cloud'?'/accounts/cloud':'/accounts/pool',{id:primary,primary:primary,backup:backup,enabled:enabled}).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()}).catch(function(e){n.textContent=e.message})}
function refreshUsage(btn){btn.disabled=true;post('/accounts/usage',{id:btn.dataset.id}).then(function(r){return r.json()}).then(function(r){document.getElementById('pool-note').textContent=r.error||quotaText(r.quota);loadHealth()}).catch(function(e){document.getElementById('pool-note').textContent=e.message}).finally(function(){btn.disabled=false})}
function refreshCloudQuotas(){document.getElementById('pool-note').textContent='Reading the latest cloud allowance report…';post('/accounts/cloud-usage',{}).then(function(r){return r.text()}).then(function(t){document.getElementById('pool-note').textContent=t;loadHealth()})}
function saveChatGPTDate(id){post('/accounts/reminder',{id:id,date:document.getElementById('expiry-'+id).value}).then(function(r){return r.text()}).then(function(t){document.getElementById('chatgpt-login').textContent=t})}
function useChatGPT(id,target){var n=document.getElementById('chatgpt-login');n.textContent='Connecting…';post(target==='cloud'?'/accounts/cloud':'/accounts/use',{id:id}).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()})}
function connectChatGPT(){post('/accounts/login',{target:document.getElementById('chatgpt-target').value,method:document.getElementById('chatgpt-method').value}).then(function(r){return r.json()}).then(function(r){if(r.error)document.getElementById('chatgpt-login').textContent=r.error;else pollChatGPTLogin()})}
function pollChatGPTLogin(){fetch('/accounts').then(function(r){return r.json()}).then(function(r){var s=r.login,n=document.getElementById('chatgpt-login');if(s.complete){n.textContent='Account connected. Select Use this account or Use for GitHub scheduled publishing.';loadHealth()}else if(s.error)n.textContent=s.error;else{n.innerHTML=s.url?'Open <a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">ChatGPT sign-in</a>'+ (s.method==='browser'?' and complete the browser approval.':' and enter <b>'+esc(s.code||'the code shown shortly')+'</b>.'):'Starting ChatGPT sign-in…';if(s.running)setTimeout(pollChatGPTLogin,1500)}})}
function saveWriters(localOnly){var n=document.getElementById('writersaved');n.textContent='applying…';var tb=document.getElementById('thinkingBudget')?document.getElementById('thinkingBudget').value:'-1';var ce=document.getElementById('claudeEffort')?document.getElementById('claudeEffort').value:'';post('/writers',{provider:document.getElementById('activeProvider').value,model:document.getElementById('newsroomModel').value,chatModel:document.getElementById('chatModel').value,thinkingBudget:tb,claudeEffort:ce,localOnly:localOnly===true}).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()})}
function togglePause(){if(!PAUSED&&!confirm('Pause everything? The cloud will stop writing and publishing until you press Resume. Stories already live stay live.'))return;post('/pause?value='+(PAUSED?0:1)).then(function(r){return r.text()}).then(function(t){alert(t);loadHealth()})}
function reveal(id){var w=document.getElementById('w_'+id);w.style.display=w.style.display==='none'?'grid':'none';if(w.style.display==='grid')document.getElementById(id).focus()}
function saveReview(){var n=document.getElementById('reviewsaved');n.textContent='applying…';post('/review?value='+document.getElementById('reviewSel').value).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()})}
function saveSettings(){var body={contactEmail:contactEmail.value,publisher:publisher.value,adsenseClient:adsenseClient.value,googleSiteVerification:googleSiteVerification.value,private:document.getElementById('private').value==='true'};post('/settings',body).then(function(r){return r.text()}).then(function(t){document.getElementById('saved').textContent=t})}

// ---- chat
var thread=document.getElementById('thread');
function bubble(cls,text){var e=document.getElementById('thread-empty');if(e)e.remove();var d=document.createElement('div');d.className='bub '+cls+(rtl(text)?' rtl':'');d.textContent=text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight;return d}
function step(text){var d=document.createElement('div');d.className='step';d.textContent='· '+text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight}
var busy=null;var ce=new EventSource('/chat/events?t='+TOKEN);
ce.onmessage=function(e){var ev=JSON.parse(e.data);if(ev.t==='you')bubble('you',ev.text);if(ev.t==='paper'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}if(ev.t==='step')step(ev.text);if(ev.t==='busy')busy=bubble('paper','…');if(ev.t==='error'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}if(ev.t==='done'){if(busy){busy.remove();busy=null}document.getElementById('send').disabled=false;document.getElementById('msg').disabled=false;step('finished in '+ev.seconds+'s')}if(ev.t==='changes')renderChanges(ev.changes)};
function ask(){var box=document.getElementById('msg');var text=box.value.trim();if(!text)return;box.value='';box.disabled=true;document.getElementById('send').disabled=true;post('/chat',{message:text}).then(function(r){if(!r.ok){r.text().then(alert);box.disabled=false;document.getElementById('send').disabled=false}})}
document.getElementById('msg').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
function renderChanges(c){var box=document.getElementById('changes');if(!c||!c.count){box.style.display='none';return}box.style.display='block';var seen={};c.files.forEach(function(f){var k=f.what+' — '+f.how;seen[k]=(seen[k]||0)+1});document.getElementById('changes-body').innerHTML='<ul>'+Object.keys(seen).map(function(k){return '<li>'+esc(k)+(seen[k]>1?' ('+seen[k]+' files)':'')+'</li>'}).join('')+'</ul>'}
function publishChanges(){if(!confirm('Publish these site changes?'))return;post('/publish-changes').then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}
function undoChanges(){if(!confirm('Undo the last change the chat made?'))return;post('/undo').then(function(r){return r.text()}).then(function(t){alert(t);location.reload()})}
fetch('/changes').then(function(r){return r.json()}).then(renderChanges);
</script></body></html>`;
}

// ----------------------------------------------------------------------- door
// The desk listens on 127.0.0.1 only, but every web page open in the owner's browser can send requests to that
// address too, and a page on a domain that re-points itself at 127.0.0.1 (DNS rebinding) can even read the answers.
// Found 2026-10-23: any site visited while the desk was open could publish, unpublish, replace the keys, put its own
// AdSense account on the paper or, through /writers, run a program on the laptop. So the desk obeys only the page it
// served: a token drawn fresh at every launch goes with every request, the address asked for must be the desk's own,
// a request a browser marks as sent by another site is refused, and the desk's page cannot be framed.
const DESK_TOKEN = randomBytes(32).toString("hex");
/** gemini-3.8-flash, claude-opus-5-5, google/gemini-3.8-flash:free: what a model name may contain, and nothing else. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
};
/** Why a request is refused, or null when it is the desk's own page asking. */
function doorCheck(req, url) {
  const port = server.address().port;
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!own.includes(req.headers.host ?? "")) return [403, "This is the Khazendar control room. Open it at its own address."];
  const origin = req.headers.origin;
  if (origin && !own.some((h) => origin === `http://${h}`)) return [403, "Refused: the request came from another website."];
  // The page itself and its fonts open from anywhere (the launcher, a bookmark); everything else is asked by the page.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/fonts/"))) return null;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") return [403, "Refused: the request came from another website."];
  // An EventSource cannot send a header, so the chat's stream alone takes the token in its address.
  const given = Buffer.from(String(req.headers["x-khazendar-token"] ?? (url.pathname === "/chat/events" ? url.searchParams.get("t") ?? "" : "")));
  const token = Buffer.from(DESK_TOKEN);
  if (given.length !== token.length || !timingSafeEqual(given, token)) return [401, "The control room was restarted. Reload this page."];
  if (req.method !== "GET" && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return [415, "Refused: not a request from the control room's page."];
  return null;
}

// ---------------------------------------------------------------------- routes
function body(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
// --autostash: the chat leaves edits uncommitted on purpose and a plain rebase refuses to run over them.
// -X theirs: the cloud commits pipeline/state every run; keep the local hunk, as newsroom.yml does.
const PUSH = [["git", ["pull", "--rebase", "--autostash", "-X", "theirs", "pages", "main"]], ["git", ["push", "pages", "HEAD:main"]]];
function commitAndPush(name, paths, message) {
  return runJob(name, "publish", [["git", ["add", ...paths]], ["git", [...GIT_ID, "commit", "-q", "-m", message]], ...PUSH]);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const text = (code, s) => {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(s);
  };
  const json = (o) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(o));
  };
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    const refused = doorCheck(req, url);
    if (refused) return text(...refused);
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page());
    }
    if (url.pathname.startsWith("/fonts/")) {
      const file = path.join(FONTS, path.basename(url.pathname));
      if (!file.endsWith(".woff2") || !existsSync(file)) return text(404, "not found");
      res.writeHead(200, { "content-type": "font/woff2", "cache-control": "public, max-age=604800" });
      return res.end(await readFile(file));
    }
    if (url.pathname === "/api/state") {
      const arts = await allArticles();
      const live = placeOnFront(arts.filter((a) => !a.isDraft));
      return json({
        job: { running: Boolean(job.running), name: job.name, kind: job.kind, startedAt: job.startedAt, exitCode: job.exitCode, finishedAt: job.finishedAt, progress: job.running ? progressLines() : [], counts: job.running ? jobProgress() : null, log: job.log.slice(-400) },
        drafts: arts.filter((a) => a.isDraft),
        live,
        coverage: coverage(live),
        // Which models actually wrote the last 24 hours' stories — read from the articles themselves,
        // so it is true whatever the settings say.
        modelsUsed: (() => {
          const cut = Date.now() - 24 * 36e5;
          const count = {};
          for (const a of live) {
            if (Date.parse(a.publishedAt) < cut) continue;
            const w = String(a.models?.writer ?? "").split("→").pop().trim();
            if (w) count[w] = (count[w] ?? 0) + 1;
          }
          return Object.entries(count).sort((x, y) => y[1] - x[1]).map(([id, n]) => ({ id, n }));
        })(),
        schedule: SCHEDULE,
        lastRun: await latestRun(),
        quality: await stateFile("quality.json"),
        health: await stateFile("health.json"),
        lessons: await stateFile("lessons.json"),
        nextCloudRun: nextCloudRun(),
      });
    }
    if (url.pathname === "/draft") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const full = path.join(ARTICLES, file);
      if (!file.endsWith(".md") || !existsSync(full)) return text(404, "not found");
      const parsed = parseArticle(file, await readFile(full, "utf8"));
      return json({ data: parsed.data, bodyHtml: bodyHtml(parsed.body) });
    }
    if (url.pathname === "/run" && req.method === "POST") {
      const kind = url.searchParams.get("kind");
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 4, 10));
      const plans = {
        dry: ["test one story", [["node", ["pipeline/run.mjs", "--dry-run", "--limit=1"]]]],
        news: ["news stories", [["node", ["pipeline/run.mjs", "--draft", `--limit=${limit}`]]]],
        explainer: ["an explainer", [["node", ["pipeline/run.mjs", "--draft", "--mode=explainer"]]]],
        analysis: ["an analysis", [["node", ["pipeline/run.mjs", "--draft", "--mode=analysis"]]]],
        paper: ["a research paper", [["node", ["pipeline/run.mjs", "--draft", "--mode=paper"]]]],
        weekly: ["the week's review", [["node", ["pipeline/run.mjs", "--draft", "--mode=weekly"]]]],
        feature: ["an in-depth piece (في العمق)", [["node", ["pipeline/run.mjs", "--draft", "--mode=feature"]]]],
        build: ["build & local preview", [["npm", ["run", "build"]], ["npx", ["astro", "preview", "--port", "4325", "--host", "127.0.0.1"]]], { env: { KHAZENDAR_SHOW_DRAFTS: "1" } }],
        pull: ["sync from GitHub", [["git", ["pull", "--rebase", "--autostash", "-X", "theirs", "pages", "main"]]]],
      };
      const plan = plans[kind];
      if (!plan) return text(400, "unknown action");
      const sections = (url.searchParams.get("sections") ?? "").replace(/[^a-z,]/g, "");
      if (sections && (kind === "news" || kind === "analysis")) {
        plan[1][0][1].push(`--sections=${sections}`);
        plan[0] += ` (${sections})`;
      }
      if (!runJob(plan[0], kind, plan[1], plan[2])) return text(409, `Still busy with "${job.name}". Wait for it to finish, or press Stop.`);
      return text(200, "started");
    }
    if (url.pathname === "/stop" && req.method === "POST") {
      job.stopped = true;
      killTree(job.running);
      killTree(chat.running);
      return text(200, "stopping");
    }
    if (url.pathname === "/publish" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      if (!file.endsWith(".md") || !existsSync(path.join(ARTICLES, file))) return text(404, "not found");
      if (job.running) return text(409, `Still busy with "${job.name}". Wait for it to finish first.`);
      await markPublished(file);
      commitAndPush("publish 1 story", [`content/articles/${file}`, "pipeline/state", "pipeline/runs"], `newsroom: publish ${file.replace(/\.md$/, "")}`);
      return text(200, "Publishing — it is live in about a minute.");
    }
    if (url.pathname === "/publish-all" && req.method === "POST") {
      if (job.running) return text(409, `Still busy with "${job.name}". Wait for it to finish first.`);
      const drafts = (await allArticles()).filter((a) => a.isDraft);
      if (!drafts.length) return text(200, "Nothing to publish.");
      for (const d of drafts) await markPublished(d.file);
      commitAndPush(`publish ${drafts.length} stories`, [...drafts.map((d) => `content/articles/${d.file}`), "pipeline/state", "pipeline/runs"], `newsroom: publish ${drafts.length} item(s) from the desk`);
      return text(200, "Publishing — they are live in about a minute.");
    }
    if (url.pathname === "/discard" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const full = path.join(ARTICLES, file);
      if (!file.endsWith(".md") || !existsSync(full)) return text(404, "not found");
      const status = await porcelain();
      const tracked = !(status.get(`content/articles/${file}`) ?? "").includes("?");
      await unlink(full);
      await markDiscarded(url.searchParams.get("slug") ?? "");
      if (tracked && !job.running) commitAndPush("discard a cloud draft", ["-A", `content/articles/${file}`, "pipeline/state"], `newsroom: discard ${file.replace(/\.md$/, "")}`);
      return text(200, "discarded");
    }
    if (url.pathname === "/feature" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const on = url.searchParams.get("on") === "1";
      if (!file.endsWith(".md") || !existsSync(path.join(ARTICLES, file))) return text(404, "not found");
      if (job.running) return text(409, `Still busy with "${job.name}". Wait for it to finish first.`);
      const touched = await setFeatured(file, on);
      if (!touched.length) return text(200, on ? "It already leads." : "It was not featured.");
      commitAndPush(on ? "feature a story" : "unfeature a story", touched, `front page: ${on ? "feature" : "unfeature"} ${file.replace(/\.md$/, "")}`);
      return text(200, on ? "Done — it leads the front page for the next 48 hours, live in about a minute." : "Done — the front page goes back to the formula, live in about a minute.");
    }
    if (url.pathname === "/move" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const section = url.searchParams.get("section") ?? "";
      const full = path.join(ARTICLES, file);
      if (!file.endsWith(".md") || !existsSync(full)) return text(404, "not found");
      if (!NEWS_SECTIONS.includes(section)) return text(400, "unknown section");
      if (job.running) return text(409, `Still busy with "${job.name}". Wait for it to finish first.`);
      const raw = await readFile(full, "utf8");
      const next = raw.replace(/^section:\s*\S+/m, `section: ${section}`);
      if (next === raw) return text(200, "It is already there.");
      await writeFile(full, next, "utf8");
      commitAndPush("move a story", [`content/articles/${file}`], `section: move ${file.replace(/\.md$/, "")} to ${section}`);
      return text(200, `Moved to ${SECTION_NAME[section]} — live in about a minute.`);
    }
    if (url.pathname === "/unpublish" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const full = path.join(ARTICLES, file);
      if (!file.endsWith(".md") || !existsSync(full)) return text(404, "not found");
      if (job.running) return text(409, `Still busy with "${job.name}". Wait for it to finish first.`);
      await unlink(full);
      commitAndPush("unpublish", ["-A", "content/articles"], `unpublish: ${file.replace(/\.md$/, "")}`);
      return text(200, "Removed. The site updates in about a minute.");
    }
    if (url.pathname === "/health") return json(await health());
    if (url.pathname === "/accounts") return json({ accounts: listAccounts(loadEnv()), login: loginState() });
    if (url.pathname === "/accounts/login" && req.method === "POST") {
      try { return json(beginAccountLogin(await body(req))); } catch (error) { return json({ error: error.message }); }
    }
    if (url.pathname === "/accounts/reminder" && req.method === "POST") {
      const { id, date = "" } = await body(req);
      setAccountReminder(id, date);
      return text(200, "Reminder saved. It is your expected date, not a verified billing expiry.");
    }
    if (url.pathname === "/accounts/pool" && req.method === "POST") {
      if (job.running || chat.running) return text(409, "Finish the current job before changing its account pair.");
      const pool = setAccountPool(await body(req));
      const primary = accountById(pool.primary);
      await setEnvKey("KHAZENDAR_CODEX_HOME", primary.id === "desktop" ? "" : primary.home);
      await setEnvKey("KHAZENDAR_CODEX_MODEL", "gpt-6.1-sol");
      await setEnvKey("KHAZENDAR_PROVIDER", "codex");
      return text(200, pool.enabled ? "Primary and backup saved. Quota fallback is active for this laptop; both accounts stay signed in." : "Quota fallback disabled. This laptop uses the selected primary account.");
    }
    if (url.pathname === "/accounts/usage" && req.method === "POST") {
      try {
        const { id } = await body(req); const account = accountById(id);
        if (account.target !== "local") throw new Error("Read the latest cloud report instead; GitHub owns that session's refreshes.");
        return json({ quota: await refreshAccountUsage(account) });
      } catch (error) { return json({ error: error.message }); }
    }
    if (url.pathname === "/accounts/cloud-usage" && req.method === "POST") {
      await refreshCloudUsage();
      return text(200, "Cloud allowance report loaded. Check each account's usage and last-check time below.");
    }
    if (url.pathname === "/accounts/use" && req.method === "POST") {
      if (job.running || chat.running) return text(409, "Finish the current job before switching its account.");
      const { id } = await body(req); const account = accountById(id);
      if (account.target !== "local") return text(400, "Use the scheduled-publishing button for this separate cloud session.");
      if (!codexStatus(spawnSync, { ...loadEnv(), KHAZENDAR_CODEX_HOME: account.home }).subscription) return text(400, "That account needs a ChatGPT sign-in first.");
      setAccountPool({ primary: id, enabled: false });
      await setEnvKey("KHAZENDAR_CODEX_HOME", id === "desktop" ? "" : account.home);
      await setEnvKey("KHAZENDAR_CODEX_MODEL", "gpt-6.1-sol");
      await setEnvKey("KHAZENDAR_PROVIDER", "codex");
      return text(200, "This laptop now uses the selected ChatGPT account with gpt-6.1-sol. Cloud runs are unchanged.");
    }
    if (url.pathname === "/accounts/cloud" && req.method === "POST") {
      const { id, backup = "" } = await body(req);
      return text(200, await activateCloudAccount(id, backup));
    }
    if (url.pathname === "/providers/codex/test" && req.method === "POST") {
      try {
        const { testCodexConnection } = await import("../pipeline/lib/llm.mjs");
        return json(await testCodexConnection());
      } catch (error) { return json({ ok: false, error: error.message }); }
    }
    if (url.pathname === "/providers/openai/test" && req.method === "POST") {
      const { model = "gpt-6.1-sol" } = await body(req);
      if (typeof model !== "string" || !/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]*$/.test(model)) return json({ ok: false, error: "Choose an OpenAI model first." });
      const apiKey = loadEnv().OPENAI_API_KEY;
      if (!apiKey) return json({ ok: false, error: "Save an OpenAI API key in Settings first. Create one at platform.openai.com/api-keys and enable API billing." });
      try {
        const { testOpenAIConnection } = await import("../pipeline/lib/llm.mjs");
        return json(await testOpenAIConnection({ apiKey, model }));
      } catch (error) {
        return json({ ok: false, error: String(error.message).split(apiKey).join("[redacted]") });
      }
    }
    if (url.pathname === "/models/refresh") {
      const prov = url.searchParams.get("provider") || "gemini";
      if (prov === "gemini") {
        const local = envFileKeys();
        const gemKey = local.GEMINI_API_KEY || local.GOOGLE_API_KEY;
        if (!gemKey) return json({ error: "No Gemini API key in .env" });
        cachedGeminiModels = null;
        const live = await fetchLiveGeminiModels(gemKey);
        return json({ provider: "gemini", models: live || [] });
      }
      return json({ provider: prov, models: [] });
    }
    if (url.pathname === "/writers" && req.method === "POST") {
      const { provider, model, newsroomModel, chatModel, thinkingBudget, claudeEffort: effort, localOnly } = await body(req);
      const prov = ["codex", "gemini", "claude", "openai", "qwen", "openrouter"].includes(provider) ? provider : "gemini";
      const picked = model || newsroomModel;
      const actualModel = typeof picked === "string" ? picked.trim() : "";
      const cm = typeof chatModel === "string" ? chatModel.trim() : "";
      if ([actualModel, cm].some((m) => m && !MODEL_NAME.test(m))) return text(400, "That model name has characters no model name has.");
      if (thinkingBudget !== undefined && !(typeof thinkingBudget === "string" && /^-?\d{1,6}$/.test(thinkingBudget))) return text(400, "The thinking budget must be a whole number.");
      if (effort !== undefined && effort !== "" && !CLAUDE_EFFORTS.includes(effort)) return text(400, `Claude's effort is one of ${CLAUDE_EFFORTS.join(", ")}.`);

      await setEnvKey("KHAZENDAR_PROVIDER", prov);
      if (actualModel) {
        await setEnvKey("KHAZENDAR_MODEL", actualModel);
        if (prov === "gemini") await setEnvKey("KHAZENDAR_GEMINI_MODEL", actualModel);
        if (prov === "claude") await setEnvKey("KHAZENDAR_CLAUDE_MODEL", actualModel);
        if (prov === "openai") await setEnvKey("KHAZENDAR_OPENAI_MODEL", actualModel);
        if (prov === "codex") await setEnvKey("KHAZENDAR_CODEX_MODEL", actualModel);
        if (prov === "qwen") await setEnvKey("KHAZENDAR_QWEN_MODEL", actualModel);
        if (prov === "openrouter") await setEnvKey("KHAZENDAR_OPENROUTER_MODEL", actualModel);
      }
      await setEnvKey("KHAZENDAR_CHAT_MODEL", cm);
      if (typeof thinkingBudget === "string") {
        await setEnvKey("KHAZENDAR_THINKING_BUDGET", thinkingBudget);
      }
      if (CLAUDE_EFFORTS.includes(effort)) await setEnvKey("KHAZENDAR_CLAUDE_EFFORT", effort);

      if (localOnly === true || prov === "codex") return text(200, `Saved on this laptop for testing: ${prov.toUpperCase()} (${actualModel || "default"}). Scheduled cloud runs are unchanged.`);
      if (typeof thinkingBudget === "string") await exec("gh", ["variable", "set", "KHAZENDAR_THINKING_BUDGET", "--repo", REPO, `--body=${thinkingBudget}`]);
      if (CLAUDE_EFFORTS.includes(effort)) await exec("gh", ["variable", "set", "KHAZENDAR_CLAUDE_EFFORT", "--repo", REPO, `--body=${effort}`]);

      const b = await exec("gh", ["variable", "set", "KHAZENDAR_PROVIDER", "--repo", REPO, `--body=${prov}`]);
      if (actualModel) await exec("gh", ["variable", "set", "KHAZENDAR_MODEL", "--repo", REPO, `--body=${actualModel}`]);
      const bad = /error|not logged|could not/i.test(b) ? b : null;
      return text(200, bad ? `Saved locally; cloud variable update skipped: ${bad.slice(0, 100)}` : `Done — active controller is now ${prov.toUpperCase()} (${actualModel || "default"}). Other models are in idle mode.`);
    }
    if (url.pathname === "/keys" && req.method === "POST") {
      const { name, value, github } = await body(req);
      const v = String(value ?? "").trim();
      const validKeys = [
        "GEMINI_API_KEY", "GOOGLE_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "DASHSCOPE_API_KEY", "QWEN_API_KEY",
        "OPENROUTER_API_KEY",
        "PEXELS_API_KEY", "UNSPLASH_ACCESS_KEY",
      ];
      if (!validKeys.includes(name)) return text(400, "unknown key name");
      if (!v || /\s/.test(v)) return text(400, "That does not look like a key — it should be one unbroken string.");
      if (name === "ANTHROPIC_API_KEY" && /^sk-ant-oat/.test(v)) return text(400, "That is a subscription token (sk-ant-oat…), not an API key — paste it in the token box instead.");
      if (name === "CLAUDE_CODE_OAUTH_TOKEN" && /^sk-ant-api/.test(v)) return text(400, "That is an API key (sk-ant-api…), not a subscription token — paste it in the API key box instead.");
      await setEnvKey(name, v);
      let note = "Saved on this laptop.";
      if (github) {
        const r = ghSecret(name, v);
        note += r === "ok" ? " Sent to GitHub too." : ` GitHub refused it: ${r}`;
      }
      return text(200, note);
    }
    // "Pause everything": the cloud newsroom and the daily editor skip every scheduled run until resumed.
    if (url.pathname === "/pause" && req.method === "POST") {
      const value = url.searchParams.get("value") === "1" ? "1" : "0";
      const out = await exec("gh", ["variable", "set", "KHAZENDAR_PAUSED", "--repo", REPO, `--body=${value}`]);
      if (/error|not logged|could not/i.test(out)) return text(200, `Could not: ${out.slice(0, 160)}`);
      return text(200, value === "1" ? "Paused — nothing will be written or published until you press Resume. Stories already live stay live." : "Resumed — the next scheduled run goes ahead.");
    }
    if (url.pathname === "/review" && req.method === "POST") {
      const value = url.searchParams.get("value") === "1" ? "1" : "0";
      const out = await exec("gh", ["variable", "set", "KHAZENDAR_REVIEW", "--repo", REPO, `--body=${value}`]);
      return text(200, /error|not logged|could not/i.test(out) ? `Could not: ${out.slice(0, 160)}` : value === "1" ? "Done — from the next run the cloud writes drafts and waits for you." : "Done — the cloud publishes on its own.");
    }
    if (url.pathname === "/settings" && req.method === "POST") {
      const patch = await body(req);
      const current = JSON.parse(readFileSync(SITE_FILE, "utf8"));
      // The AdSense ID decides who is paid for the paper's ads and the verification code whom Google takes for its
      // owner; both go live at once, so a value in neither form is refused (a pasted meta tag gives up its code).
      if (typeof patch.googleSiteVerification === "string") patch.googleSiteVerification = (patch.googleSiteVerification.match(/content=["']([^"']+)["']/) ?? [])[1] ?? patch.googleSiteVerification;
      const FORMS = { adsenseClient: [/^(?:ca-)?pub-\d{10,20}$/, "AdSense ID (ca-pub- and digits)"], googleSiteVerification: [/^[A-Za-z0-9_-]{10,100}$/, "Google verification code"], contactEmail: [/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/, "contact email"] };
      for (const [key, [form, label]] of Object.entries(FORMS)) {
        if (typeof patch[key] === "string" && patch[key].trim() && !form.test(patch[key].trim())) return text(400, `That ${label} does not look right, so nothing was saved.`);
      }
      for (const key of ["contactEmail", "publisher", "adsenseClient", "googleSiteVerification"]) if (typeof patch[key] === "string") current[key] = patch[key].trim();
      if (typeof patch.private === "boolean") current.private = patch.private;
      await writeFile(SITE_FILE, `${JSON.stringify(current, null, 2)}\n`, "utf8");
      if (job.running) return text(200, "Saved. It goes live with the next publish.");
      commitAndPush("publish settings", ["src/data/site.json"], "settings: from the control room");
      return text(200, "Saved and publishing — live in about a minute.");
    }
    // ---- chat
    if (url.pathname === "/chat/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      chat.clients.add(res);
      for (const turn of chat.turns) res.write(`data: ${JSON.stringify({ t: turn.role === "you" ? "you" : "paper", text: turn.text })}\n\n`);
      req.on("close", () => chat.clients.delete(res));
      return;
    }
    if (url.pathname === "/chat" && req.method === "POST") {
      const { message } = await body(req);
      if (!message || !message.trim()) return text(400, "empty");
      if (chat.running) return text(409, "It is still working on the last thing you asked.");
      await startChat(message.trim());
      return text(200, "started");
    }
    if (url.pathname === "/changes") return json(await siteChanges());
    if (url.pathname === "/publish-changes" && req.method === "POST") {
      const c = await siteChanges();
      if (!c.count) return text(200, "Nothing to publish.");
      // An automatic job runs in the cloud with every key the site has, so a change to one is never published from here.
      const files = c.files.filter((f) => !f.file.startsWith(".github/"));
      if (!files.length) return text(200, "Only a change to an automatic job waits, and those are never published from the desk. Ask Claude Code to look at it.");
      if (job.running) return text(409, `Still busy with "${job.name}".`);
      commitAndPush("publish site changes", files.map((f) => f.file), "site: changes from the control room");
      return text(200, files.length < c.count ? "Publishing — live in about a minute. A change to an automatic job stays unpublished: those never go out from the desk." : "Publishing — live in about a minute.");
    }
    if (url.pathname === "/undo" && req.method === "POST") {
      if (chat.running) return text(409, "It is still working. Press Stop first.");
      if (!chat.touched.length) return text(200, "Nothing to undo from the last chat.");
      const now = await porcelain();
      const tracked = [];
      for (const file of chat.touched) {
        const isNew = (now.get(file) ?? "").includes("?") && !(chat.baseline.get(file) ?? "").includes("?");
        if (isNew) await rm(path.join(root, file), { force: true, recursive: true });
        else tracked.push(file);
      }
      if (tracked.length) await exec("git", ["restore", "--worktree", "--staged", "--", ...tracked]);
      const n = chat.touched.length;
      chat.touched = [];
      return text(200, `Undone: ${n} file(s) put back.`);
    }
    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    res.writeHead(500);
    res.end(String(error.message));
  }
});

// Windows reserves blocks of ports for Hyper-V and WSL, and the blocks move at each restart: on 2026-09-24 the
// range 7722-7821 held 7777, so the control room could not start at all. It tries the usual port, then a few
// others, then any free one, and opens the browser at whichever it got (OPEN_CONTROL_ROOM.cmd no longer guesses).
const TRY_PORTS = [PORT, 4777, 17777, 27777, 0];
function listenOn(i = 0) {
  // One pair of handlers per attempt, each removing the other: a failed attempt's "listening" handler left in
  // place fired again on the next port's success and would open the browser twice.
  const onError = (error) => {
    server.off("listening", onListening);
    if (i + 1 < TRY_PORTS.length && ["EACCES", "EADDRINUSE"].includes(error.code)) return listenOn(i + 1);
    console.error(`The control room could not start: ${error.message}`);
    process.exit(1);
  };
  const onListening = () => {
    server.off("error", onError);
    const activePort = server.address().port;
    const url = `http://127.0.0.1:${activePort}/`;
    console.log(`خازندار control room: ${url}`);
    if (activePort !== 17777) {
      try {
        const redir = http.createServer((req, res) => {
          res.writeHead(302, { Location: `http://127.0.0.1:${activePort}${req.url}` });
          res.end();
        });
        redir.once("error", () => {});
        redir.listen(17777, "127.0.0.1");
      } catch {}
    }
    if (process.env.KHAZENDAR_OPEN_BROWSER === "1") spawn("cmd", ["/c", "start", "", url], { shell: false, windowsHide: true, stdio: "ignore", detached: true }).unref();
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(TRY_PORTS[i], "127.0.0.1");
}
listenOn();
