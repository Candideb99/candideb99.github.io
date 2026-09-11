#!/usr/bin/env node
/**
 * خازندار Control Room — a local page to see what the newsroom did, run it by hand,
 * preview the site, and unpublish a story. Binds to 127.0.0.1 only. No dependencies.
 *
 *   npm run control      →  http://127.0.0.1:7777
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, readdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = process.cwd();
const PORT = Number(process.env.KHAZENDAR_CONTROL_PORT ?? 7777);
const site = JSON.parse(readFileSync(path.join(root, "src", "data", "site.json"), "utf8"));
const LIVE = site.url;
const REPO = "https://github.com/Candideb99/candideb99.github.io";

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

// ---- one job at a time, streamed to every open log pane ----
const job = { running: null, name: "", log: [], clients: new Set(), startedAt: null, exitCode: null };
function broadcast(line) {
  job.log.push(line);
  if (job.log.length > 2000) job.log.shift();
  for (const res of job.clients) res.write(`data: ${JSON.stringify(line)}\n\n`);
}
function runJob(name, command, args, opts = {}) {
  if (job.running) return false;
  job.name = name;
  job.log = [];
  job.startedAt = new Date();
  job.exitCode = null;
  broadcast(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { cwd: root, env: loadEnv(), shell: process.platform === "win32", windowsHide: true, ...opts });
  job.running = child;
  const feed = (chunk) => String(chunk).split(/\r?\n/).filter(Boolean).forEach(broadcast);
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  child.on("close", (code) => {
    job.exitCode = code;
    job.running = null;
    broadcast(`— finished (${name}) with exit code ${code} —`);
  });
  return true;
}

// ---- data ----
async function articles() {
  const dir = path.join(root, "content", "articles");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const out = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    try {
      const d = YAML.parse(fm[1]);
      out.push({ file, slug: d.slug, title: d.title, section: d.section, kind: d.kind, publishedAt: String(d.publishedAt), score: d.quality?.score ?? "", verdict: d.quality?.verdict ?? "", image: d.image ? "photo" : "art", chart: d.chart ? "chart" : "", table: d.table ? "table" : "" });
    } catch {
      /* skip */
    }
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
function nextRuns(count = 3) {
  const out = [];
  const now = new Date();
  for (let h = 0; h <= 24 && out.length < count; h += 1) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + h, 23, 0));
    if (t.getUTCHours() % 3 === 0 && t > now) out.push(t);
  }
  return out;
}
function sh(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim()));
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function page() {
  const list = await articles();
  const run = await latestRun();
  const env = loadEnv();
  const branch = await sh("git rev-parse --abbrev-ref HEAD");
  const dirty = await sh("git status --porcelain");
  const ahead = await sh("git rev-list --count pages/main..HEAD 2>nul || echo 0");
  const provider = env.KHAZENDAR_PROVIDER ?? "openrouter";
  const keyOk = provider === "claude" || Boolean(env.OPENROUTER_API_KEY);
  const rows = list
    .slice(0, 40)
    .map(
      (a) => `<tr>
      <td class="t"><a href="${LIVE}/articles/${esc(a.slug)}/" target="_blank">${esc(a.title)}</a><div class="m">${esc(a.section)} · ${esc(a.kind)} · ${esc(a.publishedAt.slice(0, 16).replace("T", " "))} UTC · ${esc(a.image)} ${esc(a.chart)} ${esc(a.table)}</div></td>
      <td class="s">${esc(a.score)}<div class="m">${esc(a.verdict)}</div></td>
      <td><button class="danger" onclick="unpublish('${esc(a.file)}','${esc(a.title).replace(/'/g, "\\'")}')">Unpublish</button></td>
    </tr>`,
    )
    .join("");
  const report = run
    ? `<p><b>${esc(run.mode)}</b> run at ${esc(run.startedAt?.slice(0, 16).replace("T", " "))} UTC · ${run.published} published · ${run.durationSec}s · LLM calls ${run.llm?.calls ?? 0} ok / ${run.llm?.failures ?? 0} failed</p>
       <table class="rep">${(run.report ?? []).map((r) => `<tr><td>${esc(r.section ?? "")}</td><td>${esc(r.title ?? r.headline ?? "")}</td><td>${esc(r.score ?? "")}</td><td class="${/^published/.test(r.outcome) ? "ok" : "no"}">${esc(r.outcome)}</td></tr>`).join("")}</table>`
    : "<p>No run recorded yet.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>خازندار — Control Room</title>
<style>
body{font:15px/1.5 system-ui,Segoe UI,sans-serif;margin:0;background:#f6f4ee;color:#171512}
header{background:#e5a52b;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
header h1{margin:0;font-size:20px} header a{color:#171512;font-weight:600;margin-inline-start:14px}
main{max-width:1100px;margin:0 auto;padding:18px 24px;display:grid;gap:18px}
section{background:#fff;border:1px solid #ddd;padding:14px 16px}
h2{font-size:15px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em;color:#555}
button{font:inherit;padding:7px 12px;border:1px solid #171512;background:#171512;color:#fff;cursor:pointer;margin:0 6px 6px 0}
button.secondary{background:#fff;color:#171512} button.danger{background:#fff;color:#8c2a14;border-color:#8c2a14;padding:4px 8px;font-size:13px}
button:disabled{opacity:.4;cursor:not-allowed}
select{font:inherit;padding:6px}
pre{background:#171512;color:#e6e2d8;padding:12px;max-height:340px;overflow:auto;font-size:12.5px;white-space:pre-wrap;margin:0}
table{width:100%;border-collapse:collapse} td,th{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;text-align:left}
td.t a{color:#122a70;text-decoration:none;font-weight:600;direction:rtl;display:block;text-align:right} .m{color:#777;font-size:12px}
td.s{font-weight:700;text-align:center} .ok{color:#0a5248} .no{color:#8c2a14}
.rep td{font-size:13px} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.kpi b{display:block;font-size:26px} .warn{background:#fff4d6;border:1px solid #e5a52b;padding:8px 10px}
</style></head><body>
<header><h1>خازندار · Control Room</h1><nav><a href="${LIVE}" target="_blank">Live site ↗</a><a href="${REPO}" target="_blank">GitHub ↗</a><a href="${REPO}/actions" target="_blank">Cloud runs ↗</a><a href="http://127.0.0.1:4325/" target="_blank">Local preview ↗</a></nav></header>
<main>
<section><h2>Status</h2><div class="grid">
 <div class="kpi"><b>${list.length}</b>articles published</div>
 <div class="kpi"><b>${esc(provider)}</b>model provider ${keyOk ? "" : "<span class='no'>(no key in .env)</span>"}</div>
 <div class="kpi"><b>${nextRuns(1)[0]?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "-"}</b>next cloud run (local time)</div>
 <div class="kpi"><b>${esc(branch)}</b>${dirty ? `${dirty.split("\n").length} uncommitted change(s)` : "clean"} · ${esc(ahead)} commit(s) not yet published</div>
</div>
${dirty ? '<p class="warn">Local changes exist (new articles or edits). Click <b>Commit &amp; publish</b> to push them to the live site.</p>' : ""}
</section>
<section><h2>Actions</h2>
 <label>Stories <select id="limit"><option>2</option><option>4</option><option selected>6</option><option>8</option></select></label>
 <button onclick="run('news')">Run newsroom now</button>
 <button onclick="run('explainer')">Write an explainer</button>
 <button onclick="run('analysis')">Write an analysis</button>
 <button class="secondary" onclick="run('dry')">Dry run (no publishing)</button>
 <button class="secondary" onclick="run('build')">Build &amp; preview locally</button>
 <button class="secondary" onclick="run('pull')">Sync from GitHub</button>
 <button onclick="run('publish')">Commit &amp; publish</button>
 <button class="secondary" onclick="run('stop')">Stop current job</button>
 <p class="m">Cloud runs happen automatically every 3 hours; these buttons run the same code on this computer (no GPU involved) and publish through git.</p>
 <pre id="log">${job.log.map(esc).join("\n") || "Idle."}</pre>
</section>
<section><h2>Last run</h2>${report}</section>
<section><h2>Articles</h2><table><tr><th>Story</th><th>Score</th><th></th></tr>${rows}</table></section>
</main>
<script>
const log=document.getElementById('log');
const es=new EventSource('/events');es.onmessage=e=>{log.textContent+= (log.textContent==='Idle.'?'':'\\n')+JSON.parse(e.data);log.scrollTop=log.scrollHeight;if(/^— finished/.test(JSON.parse(e.data)))setTimeout(()=>location.reload(),1200);};
async function run(kind){const limit=document.getElementById('limit').value;const r=await fetch('/run?kind='+kind+'&limit='+limit,{method:'POST'});const t=await r.text();if(!r.ok)alert(t);else log.textContent='';}
async function unpublish(file,title){if(!confirm('Remove this story from the site?\\n\\n'+title))return;const r=await fetch('/unpublish?file='+encodeURIComponent(file),{method:'POST'});alert(await r.text());}
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await page());
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      job.clients.add(res);
      req.on("close", () => job.clients.delete(res));
      return;
    }
    if (url.pathname === "/run" && req.method === "POST") {
      const kind = url.searchParams.get("kind");
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 6, 10));
      if (kind === "stop") {
        if (job.running) job.running.kill();
        res.writeHead(200);
        return res.end("stopping");
      }
      const plans = {
        news: ["newsroom", "node", ["pipeline/run.mjs", `--limit=${limit}`]],
        explainer: ["explainer", "node", ["pipeline/run.mjs", "--mode=explainer"]],
        analysis: ["analysis", "node", ["pipeline/run.mjs", "--mode=analysis"]],
        dry: ["dry run", "node", ["pipeline/run.mjs", "--dry-run", `--limit=${limit}`]],
        build: ["build & preview", "npm", ["run", "build", "&&", "npx", "astro", "preview", "--port", "4325", "--host", "127.0.0.1"]],
        pull: ["sync", "git", ["pull", "--rebase", "pages", "main"]],
        publish: ["publish", "git", ["add", "content", "pipeline/state", "pipeline/runs", "&&", "git", "-c", "user.name=khazendar-control", "-c", "user.email=newsroom@users.noreply.github.com", "commit", "-q", "-m", '"newsroom: local batch"', "||", "echo", "nothing-to-commit", "&&", "git", "pull", "--rebase", "pages", "main", "&&", "git", "push", "pages", "HEAD:main"]],
      };
      const plan = plans[kind];
      if (!plan) {
        res.writeHead(400);
        return res.end("unknown action");
      }
      if (!runJob(plan[0], plan[1], plan[2])) {
        res.writeHead(409);
        return res.end(`A job is already running (${job.name}). Stop it first.`);
      }
      res.writeHead(200);
      return res.end("started");
    }
    if (url.pathname === "/unpublish" && req.method === "POST") {
      const file = path.basename(url.searchParams.get("file") ?? "");
      const target = path.join(root, "content", "articles", file);
      if (!file.endsWith(".md") || !existsSync(target)) {
        res.writeHead(404);
        return res.end("not found");
      }
      await unlink(target);
      const started = runJob("unpublish", "git", ["add", "-A", "content/articles", "&&", "git", "-c", "user.name=khazendar-control", "-c", "user.email=newsroom@users.noreply.github.com", "commit", "-q", "-m", `"unpublish: ${file}"`, "&&", "git", "pull", "--rebase", "pages", "main", "&&", "git", "push", "pages", "HEAD:main"]);
      res.writeHead(200);
      return res.end(started ? "Removed locally; publishing the removal now (watch the log)." : "Removed locally; a job is running, click Commit & publish afterwards.");
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
