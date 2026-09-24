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
import { readFile, readdir, unlink, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import YAML from "yaml";

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
const NEWS_SECTIONS = ["economy", "markets", "energy", "companies", "technology", "defense"];
const SECTION_NAME = { economy: "الاقتصاد", markets: "الأسواق", energy: "الطاقة", companies: "الشركات", technology: "التكنولوجيا", defense: "الدفاع", analysis: "تحليلات", explainers: "مدخل إلى الاقتصاد" };
/** What the cloud runs on its own (newsroom.yml). UTC; the page shows it in the owner's local time. */
const SCHEDULE = [
  { what: "News stories", when: "every 3 hours, at :23", utc: null },
  { what: "An explainer", when: "daily", utc: "05:41" },
  { what: "An analysis", when: "daily", utc: "14:07" },
  { what: "A research paper", when: "Tuesdays and Fridays", utc: "09:31" },
  { what: "The week's review", when: "Fridays", utc: "15:37" },
  { what: "Defence and geopolitics reading", when: "Saturdays", utc: "10:07" },
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
  const file = path.join(root, ".env");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !new RegExp(`^\\s*${name}\\s*=`).test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (value) kept.push(`${name}=${value}`);
  kept.push("");
  await writeFile(file, kept.join("\n"), "utf8");
}
/** A secret goes to GitHub over stdin, never as an argument, so it never shows in a process list. */
function ghSecret(name, value) {
  const r = spawnSync("gh", ["secret", "set", name, "--repo", REPO], { input: value, encoding: "utf8", shell: process.platform === "win32", windowsHide: true });
  return r.status === 0 ? "ok" : (r.stderr || r.stdout || "gh failed").slice(0, 200);
}

// --------------------------------------------------------------------- shell
function sh(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim()));
  });
}
/** git status --porcelain puts a LEADING SPACE on unstaged changes; never trim its output. */
function shRaw(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out));
  });
}
async function porcelain() {
  const out = await shRaw("git status --porcelain");
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
const job = { running: null, name: "", kind: "", log: [], startedAt: null, exitCode: null, finishedAt: null };
function pushLog(line) {
  job.log.push(line);
  if (job.log.length > 3000) job.log.shift();
}
function runJob(name, kind, command, args, opts = {}) {
  if (job.running) return false;
  Object.assign(job, { name, kind, log: [], startedAt: Date.now(), exitCode: null, finishedAt: null });
  pushLog(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { cwd: root, env: { ...loadEnv(), ...(opts.env ?? {}) }, shell: process.platform === "win32", windowsHide: true });
  job.running = child;
  const feed = (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach(pushLog);
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  child.on("close", (code) => {
    job.exitCode = code;
    job.running = null;
    job.finishedAt = Date.now();
    pushLog(`— finished (${name}) with exit code ${code} —`);
  });
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

// --------------------------------------------------------------------- health
async function health() {
  const secrets = await sh(`gh secret list --repo ${REPO} 2>&1`);
  const vars = await sh(`gh variable list --repo ${REPO} 2>&1`);
  const ghOk = !/not logged|not recognized|command not found|could not|error/i.test(secrets);
  const local = envFileKeys();
  let editorReal = null;
  let deploy = null;
  if (ghOk) {
    const d = await sh(`gh run list --repo ${REPO} --workflow deploy.yml -L 1 --json conclusion,createdAt,headSha,url 2>&1`);
    try {
      const [r] = JSON.parse(d);
      if (r) deploy = { ok: r.conclusion === "success", when: r.createdAt, sha: (r.headSha ?? "").slice(0, 7), url: r.url };
    } catch {
      /* none yet */
    }
    const last = await sh(`gh run list --repo ${REPO} --workflow editor.yml -L 1 --json startedAt,updatedAt,conclusion 2>&1`);
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
  return {
    ghOk,
    cloud: {
      anthropic: /ANTHROPIC_API_KEY/.test(secrets),
      oauth: /CLAUDE_CODE_OAUTH_TOKEN/.test(secrets),
      editorOn: /KHAZENDAR_EDITOR\s+1/.test(vars),
      review: /KHAZENDAR_REVIEW\s+1/.test(vars),
      paused: /KHAZENDAR_PAUSED\s+1/.test(vars),
      newsroomModel: (vars.match(/KHAZENDAR_CLAUDE_MODEL\s+(\S+)/) ?? [])[1] ?? "opus",
    },
    local: { anthropic: Boolean(local.ANTHROPIC_API_KEY), oauth: Boolean(local.CLAUDE_CODE_OAUTH_TOKEN) },
    chatModel: local.KHAZENDAR_CHAT_MODEL || "default",
    editorReal,
    deploy,
    chatReady: Boolean(CLI_JS) && Boolean(local.CLAUDE_CODE_OAUTH_TOKEN || local.ANTHROPIC_API_KEY),
  };
}

// ------------------------------------------------- the chat ("Change the site")
const CLI_JS = [
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  path.join(process.env.HOME ?? "", ".npm-global", "lib", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
].find((p) => p && existsSync(p));

function chatEnv() {
  const env = loadEnv();
  const oauth = env.CLAUDE_CODE_OAUTH_TOKEN;
  const apiKey = env.ANTHROPIC_API_KEY;
  for (const key of Object.keys(env)) {
    if (/^CLAUDECODE$|^CLAUDE_/.test(key) || key === "ANTHROPIC_BASE_URL" || key === "ANTHROPIC_AUTH_TOKEN") delete env[key];
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
const BLOCKED_TOOLS = ["Bash(git commit:*)", "Bash(git push:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(git restore:*)", "Bash(git clean:*)", "Bash(git stash:*)", "Bash(git rebase:*)"];
const chat = { running: null, sessionId: null, clients: new Set(), turns: [], baseline: null, touched: [] };
function chatSend(event) {
  for (const res of chat.clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function startChat(message) {
  if (chat.running) return false;
  if (!CLI_JS) {
    chatSend({ t: "error", text: "Claude Code is not installed on this laptop, so this tab cannot run. Install it with: npm install -g @anthropic-ai/claude-code" });
    return true;
  }
  const keys = envFileKeys();
  if (!keys.CLAUDE_CODE_OAUTH_TOKEN && !keys.ANTHROPIC_API_KEY) {
    chatSend({ t: "error", text: "No Claude key is saved yet. Open Settings and fill either the subscription token or the API key." });
    return true;
  }
  chat.baseline = await porcelain();
  chat.touched = [];
  chat.turns.push({ role: "you", text: message });
  chatSend({ t: "you", text: message });
  const args = [CLI_JS, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--append-system-prompt", CHAT_RULES];
  if (keys.KHAZENDAR_CHAT_MODEL) args.push("--model", keys.KHAZENDAR_CHAT_MODEL);
  if (chat.sessionId) args.push("--resume", chat.sessionId);
  else {
    chat.sessionId = randomUUID();
    args.push("--session-id", chat.sessionId);
  }
  args.push("--disallowed-tools", ...BLOCKED_TOOLS);
  const child = spawn(process.execPath, args, { cwd: root, env: chatEnv(), windowsHide: true });
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

  <p class="m" id="models-used" style="margin:10px 0 0"></p>
  <h2>Every part of the paper</h2>
  <div class="cov" id="cov"></div>
  <div class="hubs" id="hubs"></div>

  <h2>Latest on the site <a href="#stories" class="m" style="font-weight:400;margin-inline-start:10px">all 126 stories, with search →</a></h2>
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
        <div class="row"><button class="quiet" onclick="run('news')">News stories</button><label>in <select id="newsSection"><option value="">all sections</option><option value="economy">الاقتصاد</option><option value="markets">الأسواق</option><option value="energy">الطاقة</option><option value="companies">الشركات</option><option value="technology">التكنولوجيا</option><option value="defense">الدفاع</option></select></label><label><select id="limit"><option>2</option><option selected>4</option><option>6</option><option>8</option></select> stories</label></div>
        <div class="row"><button class="quiet" onclick="run('explainer')">An explainer</button><button class="quiet" onclick="run('analysis')">An analysis</button><label>of <select id="analysisSection"><option value="">the week</option><option value="defense">defence only</option><option value="economy">الاقتصاد only</option><option value="markets">الأسواق only</option><option value="energy">الطاقة only</option></select></label></div>
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
    <select id="f-section" onchange="renderLive()"><option value="">every section</option><option value="economy">الاقتصاد</option><option value="markets">الأسواق</option><option value="energy">الطاقة</option><option value="companies">الشركات</option><option value="technology">التكنولوجيا</option><option value="defense">الدفاع</option><option value="analysis">تحليلات</option><option value="explainers">مدخل</option></select>
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

      <h2>Who writes</h2>
      <p class="m">Every job (choosing the stories, writing, the copy desk, the fact check and the photo check) runs on Claude, on your subscription. The free models were dropped on 24 September 2026 at your request, so there is no backup: if your subscription lapses or a limit is hit, the newsroom waits until Claude answers again.</p>
      <label><span>Claude model for the newsroom</span>
        <select id="newsroomModel"><option value="sonnet">Sonnet — fast, uses little of your plan</option><option value="opus">Opus — strongest, uses much more of your plan</option><option value="haiku">Haiku — cheapest, weakest</option></select></label>
      <label><span>Claude model for the "Change the site" chat</span>
        <select id="chatModel"><option value="">Claude Code's default</option><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select></label>
      <button class="go" onclick="saveWriters()">Apply</button> <span class="m" id="writersaved"></span>
      <p class="m">The newsroom model applies in the cloud from the next run; the chat model applies here at once.</p>

      <h2>Keys</h2>
      <div id="keystatus" style="display:none"></div>
      <p style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 6px"><span><b>Claude subscription token</b> <span class="m">— from <code>claude setup-token</code> · starts with <code>sk-ant-oat</code></span><br><span id="ks_oauth">checking…</span></span><button class="quiet sm" onclick="reveal('k_oauth')">Replace</button></p>
      <div class="keyrow" id="w_k_oauth" style="display:none"><label><input type="password" id="k_oauth" placeholder="paste the new token" autocomplete="off"></label><button class="quiet" onclick="saveKey('CLAUDE_CODE_OAUTH_TOKEN','k_oauth')">Save</button></div>
      <p style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 6px"><span><b>Claude API key</b> <span class="m">— pay per use · starts with <code>sk-ant-api</code></span><br><span id="ks_ant">checking…</span></span><button class="quiet sm" onclick="reveal('k_ant')">Add</button></p>
      <div class="keyrow" id="w_k_ant" style="display:none"><label><input type="password" id="k_ant" placeholder="paste the key" autocomplete="off"></label><button class="quiet" onclick="saveKey('ANTHROPIC_API_KEY','k_ant')">Save</button></div>
      <p><label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" id="k_gh" checked style="width:auto;margin:0"> Also send it to GitHub, so the cloud can use it</label> <span class="m" id="k_note"></span></p>
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
function refresh(){fetch('/api/state').then(function(r){return r.json()}).then(function(s){render(s);clearTimeout(timer);timer=setTimeout(refresh,s.job.running?3000:20000)}).catch(function(){timer=setTimeout(refresh,5000)})}
function scoreTag(s){if(s==null||s==='')return '<span class="score">–</span>';var c=s>=8?'hi':(s<=5?'lo':'');return '<span class="score '+c+'">'+s+'</span>'}
function srcList(list){return '<details><summary>'+list.length+' source'+(list.length===1?'':'s')+'</summary><ul>'+list.map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul></details>'}
function render(s){
  document.getElementById('b-next').innerHTML=esc(fmtWhen(s.nextCloudRun));
  document.getElementById('b-last').innerHTML=s.lastRun?esc(KIND[s.lastRun.mode]||s.lastRun.mode)+' <small>· '+s.lastRun.published+' written · '+esc(ago(s.lastRun.startedAt))+'</small>':'–';
  document.getElementById('b-live').textContent=s.live.length+' stories';
  document.getElementById('b-wait').innerHTML=s.drafts.length?'<span class="ok">'+s.drafts.length+' draft'+(s.drafts.length>1?'s':'')+'</span>':'<span style="font-weight:400;color:var(--ink-3)">nothing</span>';
  var used=document.getElementById('models-used');if(used)used.innerHTML=s.modelsUsed.length?'Wrote the last 24 h: '+s.modelsUsed.map(function(m){return '<code>'+esc(m.id.replace(/^claude-cli\\//,'Claude ').replace(/:free$/,''))+'</code> ×'+m.n}).join(' · '):'';
  var quietCut=Date.now()-72*36e5;
  var NEWS=['economy','markets','energy','companies','technology','defense'];
  document.getElementById('cov').innerHTML=s.coverage.filter(function(c){return NEWS.indexOf(c.id)>=0}).map(function(c){var q=!c.last||Date.parse(c.last)<quietCut;return '<div class="'+(q?'quiet':'')+'"><div class="s">'+esc(c.name)+'</div><div class="c"><b>'+c.day+'</b> today · <b>'+c.week+'</b> this week<br>'+(c.last?'last '+esc(ago(c.last)):'nothing yet')+(q&&c.last?' · due for one':'')+'</div></div>'}).join('');
  document.getElementById('hubs').innerHTML=s.coverage.filter(function(c){return NEWS.indexOf(c.id)<0}).map(function(c){return '<span><b>'+esc(c.name)+'</b> · '+c.week+' this week · last '+esc(ago(c.last))+'</span>'}).join('');
  document.getElementById('sched').innerHTML=s.schedule.map(function(x){return '<li><span>'+esc(x.what)+'</span><span>'+esc(x.when)+(x.utc?' at '+utcToLocal(x.utc):'')+'</span></li>'}).join('');
  var r=document.getElementById('running');r.style.display=s.job.running?'grid':'none';
  if(s.job.running){document.getElementById('running-name').textContent='Working: '+s.job.name;var secs=Math.round((Date.now()-s.job.startedAt)/1000);document.getElementById('running-time').textContent=Math.floor(secs/60)+'m '+(secs%60)+'s';var c=s.job.counts;document.getElementById('running-count').textContent=c&&s.job.kind==='news'?'· '+c.written+(c.target?' of '+c.target:'')+' written'+(c.refused?' · '+c.refused+' refused':''):'';document.getElementById('running-lines').textContent=s.job.progress.join('\\n')||'starting…';document.getElementById('log').textContent=s.job.log.join('\\n')}
  else if(wasRunning){document.getElementById('auto-note').textContent=s.job.exitCode===0?'Finished: '+s.job.name+'.':'Stopped or failed: '+s.job.name+'.'}
  wasRunning=Boolean(s.job.running);
  document.getElementById('n-drafts').textContent=s.drafts.length;
  document.getElementById('drafts').innerHTML=s.drafts.length?s.drafts.map(draft).join(''):'<div class="empty">Nothing waits for you. The newsroom is publishing on its own; anything you ask for on the right appears here for approval first.</div>';
  document.getElementById('drafts-all').style.display=s.drafts.length>1?'block':'none';
  var rej=(s.lastRun&&s.lastRun.report||[]).filter(function(x){return /^rejected|^skip/.test(x.outcome||'')});
  document.getElementById('rejected-box').style.display=rej.length?'block':'none';
  document.getElementById('rejected').innerHTML=rej.map(function(x){return '<p><span class="ar" style="display:block;font-size:15px;color:var(--ink)">'+esc(x.title||x.headline||'')+'</span>'+esc((x.outcome||'').replace(/^rejected (after revision|by critic after revision \\(\\d+\\)): /,'').slice(0,200))+'</p>'}).join('');
  LIVE=s.live;var months=[];LIVE.forEach(function(a){var m=a.publishedAt.slice(0,7);if(months.indexOf(m)<0)months.push(m)});
  var msel=document.getElementById('f-month');var cur=msel.value;msel.innerHTML='<option value="">any month</option>'+months.map(function(m){return '<option value="'+m+'"'+(m===cur?' selected':'')+'>'+m+'</option>'}).join('');
  document.getElementById('latest').innerHTML=LIVE.slice(0,10).map(rowHtml).join('');
  var cl=s.modelsUsed.filter(function(m){return /^claude/.test(m.id)}).reduce(function(n,m){return n+m.n},0);
  var mu=document.getElementById('models-used');if(mu&&cl)mu.innerHTML+=' · <b>Claude wrote '+cl+' of them</b> — how much of your plan is left is shown only in the Claude app (Settings → Usage, or /usage in Claude Code); no script can read it.';
  renderLive();
}
function draft(a){return '<div class="draft">'+(a.image?'<img src="'+esc(a.image)+'" alt="">':'<div class="noimg">no photo</div>')+'<div><h3>'+esc(a.title)+'</h3><p>'+esc(a.subtitle)+'</p><div class="meta">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+scoreTag(a.score)+' '+esc(a.verdict)+(a.hasChart?' · chart':'')+(a.hasTable?' · table':'')+' · '+a.sources.length+' sources'+(a.committed?' · from the cloud':'')+'</div><div class="acts"><button class="quiet sm" onclick="openPreview(\\''+esc(a.file)+'\\')">Read it</button><button class="go sm" onclick="publish(\\''+esc(a.file)+'\\')">Publish</button><button class="danger sm" onclick="discard(\\''+esc(a.file)+'\\',\\''+esc(a.slug)+'\\')">Discard</button></div></div></div>'}
function renderLive(){
  var sec=document.getElementById('f-section').value,kind=document.getElementById('f-kind').value,month=document.getElementById('f-month').value,where=document.getElementById('f-where').value,q=document.getElementById('f-q').value.trim().toLowerCase();
  var rows=LIVE.filter(function(a){var front=a.where!=='section'&&a.where!=='hub';return (!sec||a.section===sec)&&(!kind||a.kind===kind)&&(!month||a.publishedAt.slice(0,7)===month)&&(!where||(where==='front'?front:!front))&&(!q||(a.title+' '+a.subtitle).toLowerCase().indexOf(q)>=0)});
  document.getElementById('f-count').textContent=rows.length===LIVE.length?LIVE.length+' stories':rows.length+' of '+LIVE.length;
  document.getElementById('live').innerHTML=rows.slice(0,200).map(rowHtml).join('');
}
function rowHtml(a){var front=a.where!=='section'&&a.where!=='hub';
    return '<tr><td class="t"><a href="'+LIVE_URL+'/articles/'+esc(a.slug)+'/" target="_blank">'+esc(a.title)+'</a><div class="meta">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+esc(fmtWhen(a.publishedAt))+(a.featured?' · ★ featured':'')+'</div></td>'+
      '<td><span class="chip'+(front?' front':'')+'">'+esc(WHERE[a.where]||a.where)+'</span></td><td>'+scoreTag(a.score)+'</td><td class="src">'+srcList(a.sources)+'</td>'+
      '<td><details class="menu"><summary aria-label="Actions">'+DOTS+'</summary><div class="pop">'+
      '<a href="'+LIVE_URL+'/articles/'+esc(a.slug)+'/" target="_blank">Open on the site</a>'+
      (a.kind==='news'?(a.featured?'<button onclick="feature(\\''+esc(a.file)+'\\',false)">Take it off the lead</button>':'<button onclick="feature(\\''+esc(a.file)+'\\',true)">Make it the lead (48 h)</button>')+'<div class="sep"></div><div class="lbl">Move to</div><div class="secs">'+['economy','markets','energy','companies','technology','defense'].filter(function(s){return s!==a.section}).map(function(s){return '<button onclick="moveTo(\\''+esc(a.file)+'\\',\\''+s+'\\')">'+esc(SECTION[s])+'</button>'}).join('')+'</div>':'')+
      '<div class="sep"></div><button class="d" onclick="unpublish(\\''+esc(a.file)+'\\',\\''+esc(a.title).replace(/'/g,'’')+'\\')">Unpublish</button></div></details></td></tr>'}
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
    box.innerHTML='<div class="bar"><button class="go" onclick="publish(\\''+esc(file)+'\\')">Publish this</button><button class="danger" onclick="discard(\\''+esc(file)+'\\',\\''+esc(d.slug)+'\\')">Discard</button><button class="quiet x" onclick="closePreview()">Close</button></div>'+
      '<article><h1>'+esc(d.title)+'</h1><p class="sub">'+esc(d.subtitle)+'</p>'+(d.image?'<img src="'+esc(d.image.url)+'" alt="'+esc(d.image.alt)+'"><div class="credit">'+esc(d.image.credit||'')+'</div>':'')+'<p class="lede">'+esc(d.lede)+'</p>'+
      ((d.keyFacts||[]).length?'<div class="facts"><ul>'+d.keyFacts.map(function(f){return '<li>'+(f.label?'<b>'+esc(f.label)+':</b> ':'')+esc(f.value)+'</li>'}).join('')+'</ul></div>':'')+a.bodyHtml+(d.whyItMatters?'<div class="why"><b>لماذا يهم؟</b> '+esc(d.whyItMatters)+'</div>':'')+
      (d.chart?'<p class="m" style="direction:ltr;text-align:left">Carries a chart ('+esc(d.chart.title||d.chart.type)+'); it renders on the site.</p>':'')+(d.table?'<p class="m" style="direction:ltr;text-align:left">Carries a table; it renders on the site.</p>':'')+'</article>'+
      '<div class="meta"><b>Sources</b><ul>'+(d.sources||[]).map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul><b>Quality</b> '+scoreTag(d.quality&&d.quality.score)+' '+esc(d.quality&&d.quality.verdict||'')+(d.quality&&d.quality.criticSummary?'<div class="ar m" style="margin-top:4px">'+esc(d.quality.criticSummary)+'</div>':'')+'<div class="m" style="margin-top:6px">Written by '+esc((d.models&&d.models.writer)||'?')+' · checked by '+esc((d.models&&d.models.critic)||'?')+'</div></div>'})}
function closePreview(){document.getElementById('overlay').classList.remove('on')}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closePreview()});

// ---- health / settings
function dot(ok,label,note){return '<p><span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:8px;background:'+(ok===null?'#c9a227':ok?'var(--green)':'var(--red)')+'"></span><b>'+label+'</b>'+(note?' <span class="m">— '+note+'</span>':'')+'</p>'}
function loadHealth(){fetch('/health').then(function(r){return r.json()}).then(function(h){
  PAUSED=Boolean(h.cloud.paused);
  var auto=document.getElementById('auto');auto.className='auto'+((h.cloud.review||PAUSED)?' off':'');auto.innerHTML='<i></i><span>'+(PAUSED?'PAUSED — nothing is being written or published':h.cloud.review?'Waits for your approval':'Publishes on its own')+'</span>';
  document.getElementById('auto-note').textContent='written by Claude ('+h.cloud.newsroomModel+')';
  var pb=document.getElementById('pauseBtn');pb.style.display='inline-block';pb.textContent=PAUSED?'Resume':'Pause everything';pb.className=PAUSED?'go sm':'danger sm';
  document.getElementById('now').innerHTML=
    '<p><b>Articles are written by</b> Claude ('+h.cloud.newsroomModel+'), on your subscription.</p>'+
    '<p><b>The cloud runs</b> '+(PAUSED?'are <span class="no">paused</span>':h.cloud.review?'write drafts and wait for you':'publish on their own')+'.</p>'+
    '<p><b>The chat</b> uses '+(h.chatModel==='default'?'Claude Code\\'s default model':'Claude '+h.chatModel)+'.</p>'+
    '<p><b>Keys saved:</b> Claude subscription token '+(h.local.oauth?'✓'+(h.cloud.oauth?' (laptop and GitHub)':' (laptop only)'):'✗')+' · Claude API key '+(h.local.anthropic?'✓':'not set (not needed)')+'.</p>';
  document.getElementById('ks_oauth').innerHTML=h.local.oauth?'<span class="ok">Saved'+(h.cloud.oauth?', and on GitHub':'')+'</span>':'<span class="no">Not saved</span>';
  document.getElementById('ks_ant').innerHTML=h.local.anthropic?'<span class="ok">Saved</span>':'<span class="m">Not set — only needed if you have no subscription</span>';
  var dl=document.getElementById('deploy-light');if(h.deploy){dl.className='light '+(h.deploy.ok?'ok':'no');dl.innerHTML='<i></i><span>'+(h.deploy.ok?'Site deploy OK · '+esc(fmtWhen(h.deploy.when)):'<b>THE SITE IS NOT UPDATING</b> — last deploy failed. <a href="'+esc(h.deploy.url)+'" target="_blank">See why</a>')+'</span>'}
  var inUse=h.cloud.oauth?'Claude on your subscription token':h.cloud.anthropic?'Claude on your pay-per-use key':'nothing: NO Claude key is on GitHub, so the cloud cannot write';
  document.getElementById('keystatus').innerHTML=dot(h.local.oauth||h.local.anthropic,'A Claude key on this laptop',h.local.oauth?'subscription token':h.local.anthropic?'API key':'none')+dot(h.cloud.oauth||h.cloud.anthropic,'A Claude key on GitHub',h.cloud.oauth?'subscription token':h.cloud.anthropic?'API key':'none')+'<p><b>The cloud writes with:</b> '+inUse+'</p>';
  document.getElementById('newsroomModel').value=h.cloud.newsroomModel;document.getElementById('chatModel').value=h.chatModel==='default'?'':h.chatModel;document.getElementById('reviewSel').value=h.cloud.review?'1':'0';
  document.getElementById('switches').innerHTML=(h.deploy?dot(h.deploy.ok,'The site\\'s last deploy',h.deploy.ok?'succeeded · '+fmtWhen(h.deploy.when):'FAILED — readers see an older edition'):'')+dot(h.ghOk,'This laptop can talk to GitHub',h.ghOk?'gh is signed in':'run: gh auth login')+dot(h.cloud.editorOn&&(h.cloud.oauth||h.cloud.anthropic),'The daily editor',!h.cloud.editorOn?'switched off':(h.cloud.oauth||h.cloud.anthropic)?'switched on with a key':'switched on but has no key, so it skips')+(h.editorReal?dot(h.editorReal.working,'The daily editor is actually doing work','its last run took '+h.editorReal.seconds+'s'+(h.editorReal.working?'':' — a real round takes minutes')):'')+dot(h.chatReady,'The "Change the site" tab',h.chatReady?'ready':'needs a Claude key');
})}
loadHealth();
function saveKey(name,id){var v=document.getElementById(id).value.trim();if(!v)return;var n=document.getElementById('k_note');n.textContent='saving…';post('/keys',{name:name,value:v,github:document.getElementById('k_gh').checked}).then(function(r){return r.text()}).then(function(t){n.textContent=t;document.getElementById(id).value='';loadHealth()})}
function saveWriters(){var n=document.getElementById('writersaved');n.textContent='applying…';post('/writers',{newsroomModel:document.getElementById('newsroomModel').value,chatModel:document.getElementById('chatModel').value}).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()})}
var PAUSED=false;
function togglePause(){if(!PAUSED&&!confirm('Pause everything? The cloud will stop writing and publishing until you press Resume. Stories already live stay live.'))return;post('/pause?value='+(PAUSED?0:1)).then(function(r){return r.text()}).then(function(t){alert(t);loadHealth()})}
function reveal(id){var w=document.getElementById('w_'+id);w.style.display=w.style.display==='none'?'grid':'none';if(w.style.display==='grid')document.getElementById(id).focus()}
function saveReview(){var n=document.getElementById('reviewsaved');n.textContent='applying…';post('/review?value='+document.getElementById('reviewSel').value).then(function(r){return r.text()}).then(function(t){n.textContent=t;loadHealth()})}
function saveSettings(){var body={contactEmail:contactEmail.value,publisher:publisher.value,adsenseClient:adsenseClient.value,googleSiteVerification:googleSiteVerification.value,private:document.getElementById('private').value==='true'};post('/settings',body).then(function(r){return r.text()}).then(function(t){document.getElementById('saved').textContent=t})}

// ---- chat
var thread=document.getElementById('thread');
function bubble(cls,text){var e=document.getElementById('thread-empty');if(e)e.remove();var d=document.createElement('div');d.className='bub '+cls+(rtl(text)?' rtl':'');d.textContent=text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight;return d}
function step(text){var d=document.createElement('div');d.className='step';d.textContent='· '+text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight}
var busy=null;var ce=new EventSource('/chat/events');
ce.onmessage=function(e){var ev=JSON.parse(e.data);if(ev.t==='you')bubble('you',ev.text);if(ev.t==='paper'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}if(ev.t==='step')step(ev.text);if(ev.t==='busy')busy=bubble('paper','…');if(ev.t==='error'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}if(ev.t==='done'){if(busy){busy.remove();busy=null}document.getElementById('send').disabled=false;document.getElementById('msg').disabled=false;step('finished in '+ev.seconds+'s')}if(ev.t==='changes')renderChanges(ev.changes)};
function ask(){var box=document.getElementById('msg');var text=box.value.trim();if(!text)return;box.value='';box.disabled=true;document.getElementById('send').disabled=true;post('/chat',{message:text}).then(function(r){if(!r.ok){r.text().then(alert);box.disabled=false;document.getElementById('send').disabled=false}})}
document.getElementById('msg').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
function renderChanges(c){var box=document.getElementById('changes');if(!c||!c.count){box.style.display='none';return}box.style.display='block';var seen={};c.files.forEach(function(f){var k=f.what+' — '+f.how;seen[k]=(seen[k]||0)+1});document.getElementById('changes-body').innerHTML='<ul>'+Object.keys(seen).map(function(k){return '<li>'+esc(k)+(seen[k]>1?' ('+seen[k]+' files)':'')+'</li>'}).join('')+'</ul>'}
function publishChanges(){if(!confirm('Publish these site changes?'))return;post('/publish-changes').then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}
function undoChanges(){if(!confirm('Undo the last change the chat made?'))return;post('/undo').then(function(r){return r.text()}).then(function(t){alert(t);location.reload()})}
fetch('/changes').then(function(r){return r.json()}).then(renderChanges);
</script></body></html>`;
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
const PUSH = ["&&", "git", "pull", "--rebase", "--autostash", "-X", "theirs", "pages", "main", "&&", "git", "push", "pages", "HEAD:main"];
function commitAndPush(name, paths, message) {
  return runJob(name, "publish", "git", ["add", ...paths, "&&", "git", ...GIT_ID, "commit", "-q", "-m", `"${message}"`, ...PUSH]);
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
  try {
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
        news: ["news stories", "node", ["pipeline/run.mjs", "--draft", `--limit=${limit}`]],
        explainer: ["an explainer", "node", ["pipeline/run.mjs", "--draft", "--mode=explainer"]],
        analysis: ["an analysis", "node", ["pipeline/run.mjs", "--draft", "--mode=analysis"]],
        paper: ["a research paper", "node", ["pipeline/run.mjs", "--draft", "--mode=paper"]],
        weekly: ["the week's review", "node", ["pipeline/run.mjs", "--draft", "--mode=weekly"]],
        feature: ["an in-depth piece (في العمق)", "node", ["pipeline/run.mjs", "--draft", "--mode=feature"]],
        build: ["build & local preview", "npm", ["run", "build", "&&", "npx", "astro", "preview", "--port", "4325", "--host", "127.0.0.1"], { env: { KHAZENDAR_SHOW_DRAFTS: "1" } }],
        pull: ["sync from GitHub", "git", ["pull", "--rebase", "--autostash", "-X", "theirs", "pages", "main"]],
      };
      const plan = plans[kind];
      if (!plan) return text(400, "unknown action");
      const sections = (url.searchParams.get("sections") ?? "").replace(/[^a-z,]/g, "");
      if (sections && (kind === "news" || kind === "analysis")) {
        plan[2].push(`--sections=${sections}`);
        plan[0] += ` (${sections})`;
      }
      if (!runJob(plan[0], kind, plan[1], plan[2], plan[3])) return text(409, `Still busy with "${job.name}". Wait for it to finish, or press Stop.`);
      return text(200, "started");
    }
    if (url.pathname === "/stop" && req.method === "POST") {
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
    if (url.pathname === "/writers" && req.method === "POST") {
      // Claude is the only provider since 2026-09-24 (the owner: «abandon free models and use claude only»); only the model is chosen.
      const { newsroomModel, chatModel } = await body(req);
      const nm = ["sonnet", "opus", "haiku"].includes(newsroomModel) ? newsroomModel : "opus";
      const cm = ["", "sonnet", "opus", "haiku"].includes(chatModel) ? chatModel : "";
      await setEnvKey("KHAZENDAR_CLAUDE_MODEL", nm);
      await setEnvKey("KHAZENDAR_CHAT_MODEL", cm);
      const b = await sh(`gh variable set KHAZENDAR_CLAUDE_MODEL --repo ${REPO} --body ${nm} 2>&1`);
      const bad = /error|not logged|could not/i.test(b) ? b : null;
      return text(200, bad ? `Saved here; the cloud refused: ${bad.slice(0, 120)}` : `Done — the cloud writes with Claude (${nm}) from the next run; the chat uses ${cm || "Claude Code's default"}.`);
    }
    if (url.pathname === "/keys" && req.method === "POST") {
      const { name, value, github } = await body(req);
      const v = String(value ?? "").trim();
      if (!["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].includes(name)) return text(400, "unknown key");
      if (!v || /\s/.test(v)) return text(400, "That does not look like a key — it should be one unbroken string.");
      if (name === "ANTHROPIC_API_KEY" && /^sk-ant-oat/.test(v)) return text(400, "That is a subscription token (sk-ant-oat…), not an API key — paste it in the token box instead.");
      if (name === "CLAUDE_CODE_OAUTH_TOKEN" && /^sk-ant-api/.test(v)) return text(400, "That is an API key (sk-ant-api…), not a subscription token — paste it in the API key box instead.");
      if (name === "ANTHROPIC_API_KEY" && !/^sk-ant-/.test(v)) return text(400, "A Claude API key starts with sk-ant-. This one does not.");
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
      const out = await sh(`gh variable set KHAZENDAR_PAUSED --repo ${REPO} --body ${value} 2>&1`);
      if (/error|not logged|could not/i.test(out)) return text(200, `Could not: ${out.slice(0, 160)}`);
      return text(200, value === "1" ? "Paused — nothing will be written or published until you press Resume. Stories already live stay live." : "Resumed — the next scheduled run goes ahead.");
    }
    if (url.pathname === "/review" && req.method === "POST") {
      const value = url.searchParams.get("value") === "1" ? "1" : "0";
      const out = await sh(`gh variable set KHAZENDAR_REVIEW --repo ${REPO} --body ${value} 2>&1`);
      return text(200, /error|not logged|could not/i.test(out) ? `Could not: ${out.slice(0, 160)}` : value === "1" ? "Done — from the next run the cloud writes drafts and waits for you." : "Done — the cloud publishes on its own.");
    }
    if (url.pathname === "/settings" && req.method === "POST") {
      const patch = await body(req);
      const current = JSON.parse(readFileSync(SITE_FILE, "utf8"));
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
      if (job.running) return text(409, `Still busy with "${job.name}".`);
      commitAndPush("publish site changes", c.files.map((f) => f.file), "site: changes from the control room");
      return text(200, "Publishing — live in about a minute.");
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
      if (tracked.length) await sh(`git restore --worktree --staged -- ${tracked.map((f) => `"${f}"`).join(" ")}`);
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
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`خازندار control room: ${url}`);
    if (process.env.KHAZENDAR_OPEN_BROWSER === "1") spawn("cmd", ["/c", "start", "", url], { shell: false, windowsHide: true, stdio: "ignore", detached: true }).unref();
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(TRY_PORTS[i], "127.0.0.1");
}
listenOn();
