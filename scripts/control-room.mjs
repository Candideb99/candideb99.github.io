#!/usr/bin/env node
/**
 * خازندار Control Room — the editor's desk.
 *
 * Built around one workflow and nothing else:
 *
 *   get material  →  read it  →  approve or discard  →  it goes live  →  (unpublish later if needed)
 *
 * Every run from this desk writes DRAFTS (`draft: true`), which the site ignores. Nothing reaches
 * readers until the editor presses Publish on that article. Owner's words, 2026-09-21: "i just
 * want to click grab news/articles/reportage/research etc then view before publish, approve
 * publish, view sources, unpublish."
 *
 * Tabs: Desk (default) · Settings · Change the site (a chat for design/rule changes, kept apart
 * from running the paper). Binds to 127.0.0.1 only. No dependencies beyond the project's own.
 *
 *   npm run control      →  http://127.0.0.1:7777
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
const site = JSON.parse(readFileSync(SITE_FILE, "utf8"));
const LIVE = site.url;
const REPO = "Candideb99/candideb99.github.io";
const REPO_URL = `https://github.com/${REPO}`;
const GIT_ID = ["-c", "user.name=khazendar-control", "-c", "user.email=newsroom@users.noreply.github.com"];

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
/** A secret goes to GitHub over stdin, never as an argument, so it is never visible in a process list. */
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
/** Kill a job and everything it spawned. `child.kill()` alone leaves node→shell→node grandchildren alive on Windows. */
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
    const gitCode = status.get(`content/articles/${file}`) ?? "";
    const untracked = gitCode.includes("?");
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
      warnings: d.quality?.warnings ?? [],
      critic: d.quality?.criticSummary ?? "",
      image: d.image?.url ?? null,
      imageAlt: d.image?.alt ?? "",
      sources: (d.sources ?? []).map((s) => ({ name: s.name, nameEn: s.nameEn, title: s.title, url: s.url })),
      hasChart: Boolean(d.chart),
      hasTable: Boolean(d.table),
      models: d.models ?? {},
      // A draft is what the pipeline flagged as one, or a brand-new file git has never seen (the
      // desk's own runs, and older local runs from before the flag existed).
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
/** Flip a draft to live in place: drop the `draft: true` line and stamp the moment it went out. */
async function markPublished(file) {
  const full = path.join(ARTICLES, file);
  let raw = await readFile(full, "utf8");
  raw = raw.replace(/^draft:\s*true\r?\n/m, "");
  raw = raw.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, (m, head, tail) => `${head}\nupdatedAt: ${new Date().toISOString()}${tail}`);
  await writeFile(full, raw, "utf8");
}
/** A discarded story must not come back on the next run: mark its items as a final decision. */
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
    /* the state file is optional for this */
  }
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
      const inner = esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\r?\n/g, "<br>");
      return `<p>${inner}</p>`;
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
  // The site's last deploy. From 2026-09-20 16:07 to 2026-09-21 21:09 every deploy failed on one
  // article and the paper sat frozen on Sunday's edition; nothing on this page said so. Now it does.
  let deploy = null;
  if (ghOk) {
    const d = await sh(`gh run list --repo ${REPO} --workflow deploy.yml -L 1 --json conclusion,createdAt,headSha,url 2>&1`);
    try {
      const [r] = JSON.parse(d);
      if (r) deploy = { ok: r.conclusion === "success", when: r.createdAt, sha: (r.headSha ?? "").slice(0, 7), url: r.url };
    } catch {
      /* no deploys yet */
    }
    const last = await sh(`gh run list --repo ${REPO} --workflow editor.yml -L 1 --json startedAt,updatedAt,conclusion 2>&1`);
    try {
      const [r] = JSON.parse(last);
      if (r) {
        const s = (new Date(r.updatedAt) - new Date(r.startedAt)) / 1000;
        editorReal = { seconds: Math.round(s), working: s > 90 };
      }
    } catch {
      /* no runs */
    }
  }
  return {
    ghOk,
    cloud: {
      openrouter: /OPENROUTER_API_KEY/.test(secrets),
      anthropic: /ANTHROPIC_API_KEY/.test(secrets),
      oauth: /CLAUDE_CODE_OAUTH_TOKEN/.test(secrets),
      editorOn: /KHAZENDAR_EDITOR\s+1/.test(vars),
      provider: (vars.match(/KHAZENDAR_PROVIDER\s+(\S+)/) ?? [])[1] ?? "openrouter",
      review: /KHAZENDAR_REVIEW\s+1/.test(vars),
    },
    local: {
      openrouter: Boolean(local.OPENROUTER_API_KEY),
      anthropic: Boolean(local.ANTHROPIC_API_KEY),
      oauth: Boolean(local.CLAUDE_CODE_OAUTH_TOKEN),
    },
    editorReal,
    deploy,
    chatReady: Boolean(CLI_JS) && Boolean(local.CLAUDE_CODE_OAUTH_TOKEN || local.ANTHROPIC_API_KEY),
  };
}

// ------------------------------------------------- the chat ("Change the site")
// Claude Code itself, spawned through node + cli.js so no shell can mangle an Arabic message.
// It may change anything and may never publish: git write commands are blocked at the tool level.
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
the newsroom, reviewing and publishing stories are done from the Desk tab, not here; if he asks for
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
/** Site changes waiting to go out — articles are handled on the Desk, so they are left out here. */
async function siteChanges() {
  const map = await porcelain();
  const files = [...map.entries()]
    .filter(([f]) => !f.startsWith("content/articles/") && !f.startsWith("pipeline/state/") && !f.startsWith("pipeline/runs/"))
    .map(([file, code]) => ({ file, what: describe(file), how: code.includes("?") ? "new" : code.includes("D") ? "removed" : "changed" }));
  return { files, count: files.length };
}

// ------------------------------------------------------------------------ page
function page() {
  const current = JSON.parse(readFileSync(SITE_FILE, "utf8"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>خازندار — Control Room</title>
<style>
:root{--ink:#171512;--paper:#f6f4ee;--gold:#e5a52b;--green:#0a5248;--red:#8c2a14;--line:#ddd;--muted:#777}
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,"Segoe UI",sans-serif;margin:0;background:var(--paper);color:var(--ink)}
header{background:var(--gold);padding:12px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
header h1{margin:0;font-size:20px} header nav a{color:var(--ink);font-weight:600;margin-inline-start:14px;text-decoration:none;border-bottom:1px solid rgba(0,0,0,.25)}
nav.tabs{background:var(--ink);padding:0 24px;display:flex;gap:2px}
nav.tabs button{background:none;border:0;color:#bdb8ad;font:600 14px/1 system-ui;padding:13px 20px;cursor:pointer;border-bottom:3px solid transparent;margin:0}
nav.tabs button.on{color:#fff;border-bottom-color:var(--gold)}
main{max-width:1100px;margin:0 auto;padding:18px 24px}
.pane{display:none} .pane.on{display:grid;gap:16px}
section{background:#fff;border:1px solid var(--line);padding:14px 16px}
h2{font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:#555}
h2 .n{background:var(--ink);color:#fff;border-radius:10px;padding:1px 8px;font-size:12px;margin-inline-start:6px}
button{font:inherit;padding:8px 14px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer;margin:0 6px 6px 0;border-radius:3px}
button.secondary{background:#fff;color:var(--ink)} button.go{background:var(--green);border-color:var(--green);font-weight:600}
button.danger{background:#fff;color:var(--red);border-color:var(--red)} button.small{padding:4px 10px;font-size:13px}
button:disabled{opacity:.4;cursor:not-allowed}
select,input[type=text],input[type=email],input[type=password],textarea{font:inherit;padding:7px;border:1px solid #bbb;background:#fff;border-radius:3px}
.m{color:var(--muted);font-size:12.5px}
.status{display:flex;gap:26px;flex-wrap:wrap} .status b{display:block;font-size:22px;line-height:1.1} .status span{font-size:12.5px;color:var(--muted)}
.get{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.get button{font-size:15px;padding:12px 18px} .get label{margin-inline-start:auto;font-size:13px;color:var(--muted)}
.running{background:#fff8e6;border-color:var(--gold)}
.running .lines{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;white-space:pre-wrap;color:#444;margin:6px 0}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--gold);border-top-color:transparent;border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px;margin-inline-end:6px}
@keyframes s{to{transform:rotate(360deg)}}
pre{background:var(--ink);color:#e6e2d8;padding:12px;max-height:300px;overflow:auto;font-size:12px;white-space:pre-wrap;margin:8px 0 0}
.cards{display:grid;gap:12px}
.card{display:grid;grid-template-columns:140px 1fr auto;gap:14px;border:1px solid var(--line);padding:12px;background:#fff}
.card img{width:140px;height:94px;object-fit:cover;background:#eee} .card .noimg{width:140px;height:94px;background:#eee;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px}
.card .t{direction:rtl;text-align:right} .card .t h3{margin:0 0 4px;font-size:17px;line-height:1.35} .card .t p{margin:0 0 6px;color:#444;font-size:14px}
.card .k{font-size:12px;color:var(--muted);direction:ltr;text-align:left}
.card .acts{display:flex;flex-direction:column;gap:4px;align-items:stretch} .card .acts button{margin:0}
.score{display:inline-block;min-width:26px;text-align:center;padding:1px 6px;border-radius:3px;font-weight:700;font-size:12.5px;background:#eee}
.score.hi{background:#dff2ea;color:var(--green)} .score.lo{background:#f7e3dd;color:var(--red)}
.empty{color:var(--muted);padding:14px 0;text-align:center}
table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid #eee;vertical-align:top;text-align:left;font-size:14px}
td.t a{color:#122a70;text-decoration:none;font-weight:600;direction:rtl;display:block;text-align:right}
details summary{cursor:pointer;color:#122a70;font-size:13px} .src{font-size:13px;margin:4px 0 0 0;padding-inline-start:18px} .src a{color:#122a70}
.rej td{font-size:13px;color:#444} .rej .why{color:var(--red);direction:rtl;text-align:right}
/* preview */
#overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;z-index:9}
#overlay.on{display:block}
#preview{position:fixed;top:0;right:0;bottom:0;width:min(760px,96vw);background:#fff;overflow:auto;padding:24px 28px;box-shadow:-8px 0 30px rgba(0,0,0,.25)}
#preview .bar{display:flex;gap:8px;align-items:center;margin-bottom:14px;position:sticky;top:-24px;background:#fff;padding:10px 0;border-bottom:1px solid var(--line)}
#preview .bar .x{margin-inline-start:auto}
#preview article{direction:rtl;text-align:right;font-family:"Noto Naskh Arabic","Amiri",serif;font-size:17px;line-height:1.9}
#preview article h1{font-size:26px;line-height:1.35;margin:0 0 6px} #preview article .sub{font-size:18px;color:#444;margin:0 0 12px}
#preview article img{width:100%;height:auto;margin:8px 0 2px} #preview article .credit{font-size:12px;color:var(--muted);font-family:system-ui}
#preview article .lede{font-weight:600} #preview article .facts{background:#f6f4ee;padding:10px 14px;margin:12px 0} #preview article .facts li{margin:2px 0}
#preview article .why{border-top:2px solid var(--green);border-bottom:1px solid var(--line);padding:10px 0;margin:14px 0}
#preview .meta{direction:ltr;text-align:left;font-family:system-ui;font-size:13px;color:#444;border-top:1px solid var(--line);margin-top:18px;padding-top:12px}
/* settings */
.set label{display:block;margin:0 0 12px} .set label span{display:block;font-weight:600;margin-bottom:3px} .set .m{font-weight:400}
.set input{width:100%} .set select{width:100%}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:7px} .dot.y{background:var(--green)} .dot.n{background:var(--red)} .dot.q{background:#c9a227}
.keyrow{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
code{background:#f0ede6;padding:2px 6px;font-size:13px}
/* chat */
#thread{display:flex;flex-direction:column;gap:12px;min-height:200px;max-height:50vh;overflow:auto;padding:4px 2px}
.bub{max-width:82%;padding:10px 13px;border:1px solid var(--line);white-space:pre-wrap;word-wrap:break-word}
.bub.you{align-self:flex-end;background:#eef2f6;border-color:#c9d6e2} .bub.paper{align-self:flex-start;background:#fff} .bub.rtl{direction:rtl;text-align:right}
.step{align-self:flex-start;color:#8a857c;font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
.ask{display:flex;gap:8px;align-items:flex-end;margin-top:12px} .ask textarea{flex:1;resize:vertical;min-height:52px}
.chg{background:#f3f7f4;border-color:var(--green)}
</style></head><body>
<header><h1>خازندار · Control Room</h1><nav><a href="${LIVE}" target="_blank">Live site ↗</a><a href="${REPO_URL}/actions" target="_blank">Cloud runs ↗</a><a href="http://127.0.0.1:4325/" target="_blank">Local preview ↗</a></nav></header>
<nav class="tabs">
  <button class="on" data-tab="desk">Desk</button>
  <button data-tab="set">Settings</button>
  <button data-tab="chat">Change the site</button>
</nav>
<main>

<!-- ================================ DESK ================================ -->
<div class="pane on" id="pane-desk">
<section><div class="status" id="status">loading…</div><div id="deploy-note" class="m" style="margin-top:8px"></div></section>

<section>
 <h2>Get new material</h2>
 <div class="get">
  <button onclick="run('news')">📰 News stories</button>
  <button onclick="run('explainer')">📘 An explainer</button>
  <button onclick="run('analysis')">📈 An analysis</button>
  <button onclick="run('paper')">🔬 A research paper</button>
  <button onclick="run('weekly')">🗓 The week's review</button>
  <label>How many news stories <select id="limit"><option>2</option><option selected>4</option><option>6</option><option>8</option></select></label>
 </div>
 <p class="m">Each button writes <b>drafts</b>. Nothing goes on the site until you press Publish on it below. A news run takes about 8–10 minutes for four stories; the others take 3–5 minutes.</p>
</section>

<section class="running" id="running" style="display:none">
 <h2><span class="spin"></span><span id="running-name">Working</span> <span class="m" id="running-time"></span></h2>
 <div class="lines" id="running-lines"></div>
 <button class="danger small" onclick="stopJob()">Stop</button>
 <details><summary>Show every line</summary><pre id="log"></pre></details>
</section>

<section>
 <h2>Waiting for your approval <span class="n" id="n-drafts">0</span></h2>
 <div id="drafts" class="cards"><div class="empty">Nothing is waiting. Press a button above to get new material.</div></div>
 <div id="drafts-all" style="display:none;margin-top:10px"><button class="go" onclick="publishAll()">Publish everything above</button></div>
</section>

<section id="rejected-box" style="display:none">
 <details><summary id="rejected-sum">Refused by the copy desk in the last run</summary>
 <table class="rej" id="rejected"></table>
 <p class="m">These were written, then refused by the checks or the critic, and were not saved. The reason is what the desk found. A source that keeps failing is worth telling the chat about.</p>
 </details>
</section>

<section>
 <h2>Live on the site <span class="n" id="n-live">0</span></h2>
 <table id="live"><tr><th>Story</th><th>Score</th><th>Sources</th><th></th></tr></table>
</section>
</div>

<!-- ============================== SETTINGS ============================== -->
<div class="pane" id="pane-set">
<section class="set">
 <h2>Who writes, and with which key</h2>
 <p class="m">There are three different kinds of key and they are not interchangeable. You need <b>one</b> of the Claude ones, or none at all if you are happy with the free models.</p>
 <div id="keystatus" class="m" style="margin-bottom:10px">checking…</div>
 <div class="keyrow"><label><span>OpenRouter key <span class="m">— free models; starts with <code>sk-or-</code></span></span><input type="password" id="k_or" placeholder="paste to replace the saved one" autocomplete="off"></label><button class="secondary" onclick="saveKey('OPENROUTER_API_KEY','k_or')">Save</button></div>
 <div class="keyrow"><label><span>Claude API key <span class="m">— pay-per-use from console.anthropic.com; starts with <code>sk-ant-</code></span></span><input type="password" id="k_ant" placeholder="paste here" autocomplete="off"></label><button class="secondary" onclick="saveKey('ANTHROPIC_API_KEY','k_ant')">Save</button></div>
 <div class="keyrow"><label><span>Claude subscription token <span class="m">— uses your Claude plan, no per-message cost; the long string printed by <code>claude setup-token</code></span></span><input type="password" id="k_oauth" placeholder="paste here" autocomplete="off"></label><button class="secondary" onclick="saveKey('CLAUDE_CODE_OAUTH_TOKEN','k_oauth')">Save</button></div>
 <p><label style="font-weight:400"><input type="checkbox" id="k_gh" checked style="width:auto"> Also send it to GitHub, so the cloud runs and the daily editor can use it</label> <span class="m" id="k_note"></span></p>
 <label><span>Model provider for the articles</span>
  <select id="providerSel"><option value="openrouter">Free models on OpenRouter — costs nothing, lower quality</option><option value="claude">Claude — the single biggest quality gain available</option></select></label>
 <button class="go" onclick="saveProvider()">Apply in the cloud</button> <span class="m" id="provsaved"></span>
</section>

<section class="set">
 <h2>Who decides what goes live</h2>
 <label><span>The automatic runs in the cloud (every 3 hours)</span>
  <select id="reviewSel">
   <option value="0">Publish on their own, as now — the paper never waits for me</option>
   <option value="1">Write drafts and wait for me — I approve every story from this desk</option>
  </select></label>
 <button class="go" onclick="saveReview()">Apply in the cloud</button> <span class="m" id="reviewsaved"></span>
 <p class="m">Runs from this desk always wait for you. This switch is only about the cloud. If you choose "wait for me", press <b>Sync from GitHub</b> on the Desk to fetch the cloud's drafts.</p>
</section>

<section class="set">
 <h2>The newspaper</h2>
 <label><span>Contact email <span class="m">— AdSense will not approve the site without one</span></span><input type="email" id="contactEmail" value="${esc(current.contactEmail)}"></label>
 <label><span>Publisher name</span><input type="text" id="publisher" value="${esc(current.publisher)}"></label>
 <label><span>AdSense publisher id <span class="m">— looks like ca-pub-1234567890</span></span><input type="text" id="adsenseClient" value="${esc(current.adsenseClient)}"></label>
 <label><span>Google verification code</span><input type="text" id="googleSiteVerification" value="${esc(current.googleSiteVerification)}"></label>
 <label><span>Visible to search engines?</span>
  <select id="private"><option value="true"${current.private ? " selected" : ""}>No — keep it unlisted (before launch)</option><option value="false"${current.private ? "" : " selected"}>Yes — ask Google and Bing to list it (launch)</option></select></label>
 <button class="go" onclick="saveSettings()">Save and publish</button> <span class="m" id="saved"></span>
</section>

<section><h2>Is everything switched on?</h2><div id="switches" class="m">checking…</div></section>
</div>

<!-- ================================ CHAT ================================ -->
<div class="pane" id="pane-chat">
<section>
 <h2>Change the site</h2>
 <p class="m">This is for changing how the paper <b>looks and works</b> — the design, a page, the newsroom's rules, its sources. Running the paper is done on the Desk. Type in Arabic or English: <i>"الخط صغير في الموبايل"</i>, <i>"add the Saudi central bank feed"</i>, <i>"why does the copy desk keep refusing Al Jazeera stories?"</i></p>
 <div id="thread"></div>
 <div class="ask"><textarea id="msg" placeholder="Type here, then press Enter…"></textarea><button class="go" id="send" onclick="ask()">Send</button></div>
</section>
<section class="chg" id="changes" style="display:none">
 <h2>Site changes not live yet — your call</h2>
 <div id="changes-body"></div>
 <button class="go" onclick="publishChanges()">Publish to the live site</button>
 <button class="secondary" onclick="run('build')">Preview locally first</button>
 <button class="danger" onclick="undoChanges()">Undo the last change</button>
</section>
</div>
</main>

<div id="overlay" onclick="if(event.target===this)closePreview()"><div id="preview"></div></div>

<script>
// ---- tabs
document.querySelectorAll('nav.tabs button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('nav.tabs button').forEach(function(x){x.classList.toggle('on',x===b)});
  document.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+b.dataset.tab)});
  location.hash=b.dataset.tab;
  if(b.dataset.tab==='chat')document.getElementById('msg').focus();
}});
if(location.hash){var tb=document.querySelector('nav.tabs button[data-tab="'+location.hash.slice(1)+'"]');if(tb)tb.click();}

var rtl=function(s){return /[\\u0600-\\u06FF]/.test(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var post=function(url,body){return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined})};
var KIND={news:'news',explainer:'explainer',analysis:'analysis',paper:'paper reading',weekly:'weekly review'};
var SECTION={economy:'الاقتصاد',markets:'الأسواق',energy:'الطاقة',companies:'الشركات',technology:'التكنولوجيا',defense:'دفاع',analysis:'تحليل',explainers:'مدخل'};

// ---- desk: state polling
var wasRunning=false;
function fmtTime(iso){if(!iso)return '-';var d=new Date(iso);return d.toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})}
function scoreTag(s){if(s==null||s==='')return '<span class="score">–</span>';var c=s>=8?'hi':(s<=5?'lo':'');return '<span class="score '+c+'">'+s+'</span>'}
function srcList(list){return '<details><summary>'+list.length+' source'+(list.length===1?'':'s')+'</summary><ul class="src">'+list.map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul></details>'}
function card(a){
  return '<div class="card">'+
    (a.image?'<img src="'+esc(a.image)+'" alt="">':'<div class="noimg">no photo</div>')+
    '<div><div class="t"><h3>'+esc(a.title)+'</h3><p>'+esc(a.subtitle)+'</p></div>'+
    '<div class="k">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+scoreTag(a.score)+' '+esc(a.verdict)+
    (a.hasChart?' · chart':'')+(a.hasTable?' · table':'')+(a.committed?' · <span title="written by a cloud run">from the cloud</span>':'')+'</div>'+
    srcList(a.sources)+'</div>'+
    '<div class="acts"><button class="secondary small" onclick="openPreview(\\''+esc(a.file)+'\\')">Read it</button>'+
    '<button class="go small" onclick="publish(\\''+esc(a.file)+'\\')">Publish</button>'+
    '<button class="danger small" onclick="discard(\\''+esc(a.file)+'\\',\\''+esc(a.slug)+'\\')">Discard</button></div></div>';
}
function render(s){
  var st=document.getElementById('status');
  st.innerHTML='<div><b>'+s.live.length+'</b><span>stories live</span></div>'+
    '<div><b>'+s.drafts.length+'</b><span>waiting for you</span></div>'+
    '<div><b>'+fmtTime(s.nextCloudRun)+'</b><span>next automatic run</span></div>'+
    '<div><b>'+(s.lastRun?esc(s.lastRun.mode)+' · '+s.lastRun.published+' written':'–')+'</b><span>last run · '+(s.lastRun?fmtTime(s.lastRun.startedAt):'')+'</span></div>'+
    '<div style="margin-inline-start:auto"><button class="secondary small" onclick="run(\\'pull\\')">Sync from GitHub</button></div>';
  var r=document.getElementById('running'); r.style.display=s.job.running?'block':'none';
  if(s.job.running){
    document.getElementById('running-name').textContent='Working: '+s.job.name;
    document.getElementById('running-time').textContent=Math.round((Date.now()-s.job.startedAt)/1000)+'s';
    document.getElementById('running-lines').textContent=s.job.progress.join('\\n')||'starting…';
    document.getElementById('log').textContent=s.job.log.join('\\n');
  } else if(wasRunning){ /* a job just ended: say so once, in the status area */
    var note=s.job.exitCode===0?'Finished: '+s.job.name+'.':'Stopped or failed: '+s.job.name+' (see Cloud runs for cloud jobs, or press Show every line).';
    st.insertAdjacentHTML('beforeend','<div style="flex-basis:100%"><span class="m">'+esc(note)+'</span></div>');
  }
  wasRunning=Boolean(s.job.running);
  document.getElementById('n-drafts').textContent=s.drafts.length;
  document.getElementById('drafts').innerHTML=s.drafts.length?s.drafts.map(card).join(''):'<div class="empty">Nothing is waiting. Press a button above to get new material.</div>';
  document.getElementById('drafts-all').style.display=s.drafts.length>1?'block':'none';
  var rej=(s.lastRun&&s.lastRun.report||[]).filter(function(x){return /^rejected|^skip/.test(x.outcome||'')});
  document.getElementById('rejected-box').style.display=rej.length?'block':'none';
  document.getElementById('rejected-sum').textContent='Refused by the copy desk in the last run ('+rej.length+')';
  document.getElementById('rejected').innerHTML=rej.map(function(x){return '<tr><td>'+esc(x.section||'')+'</td><td class="why">'+esc(x.title||x.headline||'')+'</td><td>'+esc((x.outcome||'').replace(/^rejected (after revision|by critic after revision \\(\\d+\\)): /,'').slice(0,240))+'</td></tr>'}).join('');
  document.getElementById('n-live').textContent=s.live.length;
  document.getElementById('live').innerHTML='<tr><th>Story</th><th>Score</th><th>Sources</th><th></th></tr>'+s.live.slice(0,60).map(function(a){
    return '<tr><td class="t"><a href="'+LIVE_URL+'/articles/'+esc(a.slug)+'/" target="_blank">'+esc(a.title)+'</a><div class="m" style="direction:ltr;text-align:left">'+esc(SECTION[a.section]||a.section)+' · '+esc(KIND[a.kind]||a.kind)+' · '+esc(a.publishedAt.slice(0,16).replace('T',' '))+' UTC</div></td>'+
      '<td>'+scoreTag(a.score)+'</td><td>'+srcList(a.sources)+'</td><td><button class="danger small" onclick="unpublish(\\''+esc(a.file)+'\\',\\''+esc(a.title).replace(/'/g,'’')+'\\')">Unpublish</button></td></tr>'}).join('');
}
var LIVE_URL=${JSON.stringify(LIVE)};
var timer=null;
function refresh(){fetch('/api/state').then(function(r){return r.json()}).then(function(s){render(s);clearTimeout(timer);timer=setTimeout(refresh,s.job.running?3000:20000)}).catch(function(){timer=setTimeout(refresh,5000)})}
refresh();

// ---- desk: actions
function run(kind){var limit=document.getElementById('limit').value;post('/run?kind='+kind+'&limit='+limit).then(function(r){return r.text()}).then(function(t){if(!/^started/.test(t))alert(t);refresh()})}
function stopJob(){post('/stop').then(refresh)}
function publish(file){post('/publish?file='+encodeURIComponent(file)).then(function(r){return r.text()}).then(function(t){if(!/^Publishing/.test(t))alert(t);closePreview();refresh()})}
function publishAll(){if(!confirm('Publish every waiting story to the live site?'))return;post('/publish-all').then(function(r){return r.text()}).then(function(t){if(!/^Publishing/.test(t))alert(t);refresh()})}
function discard(file,slug){if(!confirm('Throw this draft away? It will not come back on the next run.'))return;post('/discard?file='+encodeURIComponent(file)+'&slug='+encodeURIComponent(slug)).then(function(r){return r.text()}).then(function(t){closePreview();refresh()})}
function unpublish(file,title){if(!confirm('Remove this story from the live site?\\n\\n'+title))return;post('/unpublish?file='+encodeURIComponent(file)).then(function(r){return r.text()}).then(function(t){alert(t);refresh()})}

// ---- preview
function openPreview(file){
  var box=document.getElementById('preview');box.innerHTML='<p class="m">loading…</p>';document.getElementById('overlay').classList.add('on');
  fetch('/draft?file='+encodeURIComponent(file)).then(function(r){return r.json()}).then(function(a){
    var d=a.data;
    box.innerHTML='<div class="bar"><button class="go" onclick="publish(\\''+esc(file)+'\\')">Publish this</button><button class="danger" onclick="discard(\\''+esc(file)+'\\',\\''+esc(d.slug)+'\\')">Discard</button><button class="secondary x" onclick="closePreview()">Close ✕</button></div>'+
      '<article><h1>'+esc(d.title)+'</h1><p class="sub">'+esc(d.subtitle)+'</p>'+
      (d.image?'<img src="'+esc(d.image.url)+'" alt="'+esc(d.image.alt)+'"><div class="credit">'+esc(d.image.credit||'')+'</div>':'')+
      '<p class="lede">'+esc(d.lede)+'</p>'+
      ((d.keyFacts||[]).length?'<div class="facts"><ul>'+d.keyFacts.map(function(f){return '<li>'+(f.label?'<b>'+esc(f.label)+':</b> ':'')+esc(f.value)+'</li>'}).join('')+'</ul></div>':'')+
      a.bodyHtml+
      (d.whyItMatters?'<div class="why"><b>لماذا يهم؟</b> '+esc(d.whyItMatters)+'</div>':'')+
      (d.chart?'<p class="m" style="direction:ltr;text-align:left">This story carries a chart ('+esc(d.chart.title||d.chart.type)+'); it renders on the site.</p>':'')+
      (d.table?'<p class="m" style="direction:ltr;text-align:left">This story carries a table ('+esc(d.table.title||'')+'); it renders on the site.</p>':'')+
      '</article>'+
      '<div class="meta"><b>Sources</b><ul class="src">'+(d.sources||[]).map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank">'+esc(s.nameEn||s.name)+'</a> — '+esc(s.title)+'</li>'}).join('')+'</ul>'+
      '<b>Quality</b> '+scoreTag(d.quality&&d.quality.score)+' '+esc(d.quality&&d.quality.verdict||'')+(d.quality&&d.quality.criticSummary?'<div class="m" style="direction:rtl;text-align:right">'+esc(d.quality.criticSummary)+'</div>':'')+
      ((d.quality&&d.quality.warnings||[]).length?'<div class="m">Warnings: '+esc(d.quality.warnings.join(' | '))+'</div>':'')+
      '<div class="m" style="margin-top:6px">Written by '+esc((d.models&&d.models.writer)||'?')+' · checked by '+esc((d.models&&d.models.critic)||'?')+'</div></div>';
  });
}
function closePreview(){document.getElementById('overlay').classList.remove('on')}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closePreview()});

// ---- settings
function dot(ok,label,note){return '<p><span class="dot '+(ok===null?'q':ok?'y':'n')+'"></span><b>'+label+'</b>'+(note?' <span class="m">— '+note+'</span>':'')+'</p>'}
function loadHealth(){
  fetch('/health').then(function(r){return r.json()}).then(function(h){
    var inUse=h.cloud.provider==='claude'?(h.cloud.oauth?'Claude, on your subscription token':h.cloud.anthropic?'Claude, on your pay-per-use API key':'Claude is selected but NO Claude key is on GitHub — runs will fall back or fail'):'the free OpenRouter models';
    document.getElementById('keystatus').innerHTML=
      dot(h.local.openrouter,'OpenRouter key on this laptop',h.local.openrouter?'saved':'missing')+
      dot(h.local.anthropic||h.local.oauth,'A Claude key on this laptop',h.local.oauth?'subscription token saved':h.local.anthropic?'API key saved':'none saved')+
      dot(h.cloud.anthropic||h.cloud.oauth||h.cloud.provider!=='claude','A Claude key on GitHub',h.cloud.oauth?'subscription token':h.cloud.anthropic?'API key':'none')+
      '<p><b>The cloud is writing articles with:</b> '+inUse+'</p>';
    document.getElementById('providerSel').value=h.cloud.provider;
    document.getElementById('reviewSel').value=h.cloud.review?'1':'0';
    var dep=h.deploy?(h.deploy.ok?'<span class="ok">Site deploy OK</span> · '+fmtTime(h.deploy.when):'<span class="no"><b>THE SITE IS NOT UPDATING</b> — the last deploy failed ('+fmtTime(h.deploy.when)+'). Readers see an older edition. <a href="'+esc(h.deploy.url)+'" target="_blank">See why ↗</a></span>'):'';
    var depBox=document.getElementById('deploy-note');if(depBox)depBox.innerHTML=dep;
    document.getElementById('switches').innerHTML=
      (h.deploy?dot(h.deploy.ok,'The site\\'s last deploy',h.deploy.ok?'succeeded · '+fmtTime(h.deploy.when):'FAILED · '+fmtTime(h.deploy.when)+' — readers see an older edition until this is fixed'):'')+
      dot(h.ghOk,'This laptop can talk to GitHub',h.ghOk?'gh is signed in':'run: gh auth login')+
      dot(h.cloud.editorOn&&(h.cloud.anthropic||h.cloud.oauth),'The daily editor',!h.cloud.editorOn?'switched off (KHAZENDAR_EDITOR is not 1)':(h.cloud.anthropic||h.cloud.oauth)?'switched on with a key':'switched on but has no key, so it skips every morning')+
      (h.editorReal?dot(h.editorReal.working,'The daily editor is actually doing work','its last run took '+h.editorReal.seconds+'s'+(h.editorReal.working?'':' — a real round takes minutes; it is skipping')):'')+
      dot(h.chatReady,'The "Change the site" tab',h.chatReady?'ready':'needs a Claude key above');
  });
}
loadHealth();
function saveKey(name,inputId){
  var v=document.getElementById(inputId).value.trim();if(!v)return;
  var note=document.getElementById('k_note');note.textContent='saving…';
  post('/keys',{name:name,value:v,github:document.getElementById('k_gh').checked}).then(function(r){return r.text()}).then(function(t){note.textContent=t;document.getElementById(inputId).value='';loadHealth()});
}
function saveProvider(){document.getElementById('provsaved').textContent='applying…';post('/provider?value='+document.getElementById('providerSel').value).then(function(r){return r.text()}).then(function(t){document.getElementById('provsaved').textContent=t;loadHealth()})}
function saveReview(){document.getElementById('reviewsaved').textContent='applying…';post('/review?value='+document.getElementById('reviewSel').value).then(function(r){return r.text()}).then(function(t){document.getElementById('reviewsaved').textContent=t;loadHealth()})}
function saveSettings(){
  var body={contactEmail:contactEmail.value,publisher:publisher.value,adsenseClient:adsenseClient.value,googleSiteVerification:googleSiteVerification.value,private:document.getElementById('private').value==='true'};
  post('/settings',body).then(function(r){return r.text()}).then(function(t){document.getElementById('saved').textContent=t});
}

// ---- chat
var thread=document.getElementById('thread');
function bubble(cls,text){var d=document.createElement('div');d.className='bub '+cls+(rtl(text)?' rtl':'');d.textContent=text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight;return d}
function step(text){var d=document.createElement('div');d.className='step';d.textContent='· '+text;thread.appendChild(d);thread.scrollTop=thread.scrollHeight}
var busy=null;
var ce=new EventSource('/chat/events');
ce.onmessage=function(e){var ev=JSON.parse(e.data);
  if(ev.t==='you')bubble('you',ev.text);
  if(ev.t==='paper'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}
  if(ev.t==='step')step(ev.text);
  if(ev.t==='busy')busy=bubble('paper','…');
  if(ev.t==='error'){if(busy){busy.remove();busy=null}bubble('paper',ev.text)}
  if(ev.t==='done'){if(busy){busy.remove();busy=null}document.getElementById('send').disabled=false;document.getElementById('msg').disabled=false;step('finished in '+ev.seconds+'s')}
  if(ev.t==='changes')renderChanges(ev.changes)};
function ask(){var box=document.getElementById('msg');var text=box.value.trim();if(!text)return;box.value='';box.disabled=true;document.getElementById('send').disabled=true;
  post('/chat',{message:text}).then(function(r){if(!r.ok){r.text().then(alert);box.disabled=false;document.getElementById('send').disabled=false}})}
document.getElementById('msg').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
function renderChanges(c){var box=document.getElementById('changes');if(!c||!c.count){box.style.display='none';return}box.style.display='block';
  var seen={};c.files.forEach(function(f){var k=f.what+' — '+f.how;seen[k]=(seen[k]||0)+1});
  document.getElementById('changes-body').innerHTML='<p>'+c.count+' file'+(c.count>1?'s':'')+' changed.</p><ul>'+Object.keys(seen).map(function(k){return '<li>'+esc(k)+(seen[k]>1?' ('+seen[k]+' files)':'')+'</li>'}).join('')+'</ul>'}
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
// --autostash: the "Change the site" tab leaves edits uncommitted on purpose, and a plain rebase refuses
// to run over them ("Please commit or stash them" — the first publish from this desk failed exactly so).
// -X theirs: the cloud commits pipeline/state on every run; when both sides touched it, keep the local
// hunk, as newsroom.yml itself does, instead of stopping on a conflict nobody is there to resolve.
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
    if (url.pathname === "/api/state") {
      const arts = await allArticles();
      return json({
        job: { running: Boolean(job.running), name: job.name, kind: job.kind, startedAt: job.startedAt, exitCode: job.exitCode, finishedAt: job.finishedAt, progress: job.running ? progressLines() : [], log: job.log.slice(-400) },
        drafts: arts.filter((a) => a.isDraft),
        live: arts.filter((a) => !a.isDraft),
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
        build: ["build & local preview", "npm", ["run", "build", "&&", "npx", "astro", "preview", "--port", "4325", "--host", "127.0.0.1"], { env: { KHAZENDAR_SHOW_DRAFTS: "1" } }],
        pull: ["sync from GitHub", "git", ["pull", "--rebase", "pages", "main"]],
      };
      const plan = plans[kind];
      if (!plan) return text(400, "unknown action");
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
      // A draft the cloud already committed has to be removed from the repository too, not just from this disk.
      if (tracked && !job.running) commitAndPush("discard a cloud draft", ["-A", `content/articles/${file}`, "pipeline/state"], `newsroom: discard ${file.replace(/\.md$/, "")}`);
      return text(200, "discarded");
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
    if (url.pathname === "/keys" && req.method === "POST") {
      const { name, value, github } = await body(req);
      const v = String(value ?? "").trim();
      if (!["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].includes(name)) return text(400, "unknown key");
      if (!v || /\s/.test(v)) return text(400, "That does not look like a key — it should be one unbroken string.");
      const looks = { OPENROUTER_API_KEY: /^sk-or-/, ANTHROPIC_API_KEY: /^sk-ant-/, CLAUDE_CODE_OAUTH_TOKEN: /^(sk-ant-oat|eyJ|[A-Za-z0-9_-]{40,})/ };
      if (name === "ANTHROPIC_API_KEY" && /^sk-ant-oat/.test(v)) return text(400, "That is a subscription token, not an API key — paste it in the box below instead.");
      if (name === "OPENROUTER_API_KEY" && !looks.OPENROUTER_API_KEY.test(v)) return text(400, "An OpenRouter key starts with sk-or-. This one does not.");
      if (name === "ANTHROPIC_API_KEY" && !looks.ANTHROPIC_API_KEY.test(v)) return text(400, "A Claude API key starts with sk-ant-. This one does not.");
      await setEnvKey(name, v);
      let note = "Saved on this laptop.";
      if (github) {
        const r = ghSecret(name, v);
        note += r === "ok" ? " Sent to GitHub too." : ` GitHub refused it: ${r}`;
      }
      return text(200, note);
    }
    if (url.pathname === "/provider" && req.method === "POST") {
      const value = url.searchParams.get("value") === "claude" ? "claude" : "openrouter";
      const out = await sh(`gh variable set KHAZENDAR_PROVIDER --repo ${REPO} --body ${value} 2>&1`);
      return text(200, /error|not logged|could not/i.test(out) ? `Could not: ${out.slice(0, 160)}` : `Done — the cloud now writes with ${value}, from the next run.`);
    }
    if (url.pathname === "/review" && req.method === "POST") {
      const value = url.searchParams.get("value") === "1" ? "1" : "0";
      const out = await sh(`gh variable set KHAZENDAR_REVIEW --repo ${REPO} --body ${value} 2>&1`);
      return text(200, /error|not logged|could not/i.test(out) ? `Could not: ${out.slice(0, 160)}` : value === "1" ? "Done — from the next run the cloud writes drafts and waits for you." : "Done — the cloud publishes on its own again.");
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`خازندار control room: http://127.0.0.1:${PORT}`);
});
