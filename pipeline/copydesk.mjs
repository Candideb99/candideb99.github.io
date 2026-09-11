/**
 * Runs the Arabic copy desk over published articles.
 *
 *   node pipeline/copydesk.mjs                       every article, headline + dek + lede
 *   node pipeline/copydesk.mjs --dry-run             show what would change, write nothing
 *   node pipeline/copydesk.mjs --limit=10            the ten newest only
 *   node pipeline/copydesk.mjs --slugs=a,b           named articles only
 *   node pipeline/copydesk.mjs --body                the body text too (slower; guarded the same way)
 *   node pipeline/copydesk.mjs --flagged             only articles still carrying a banned phrase
 *
 * Nothing is edited by hand: the desk model proposes, the guard in pipeline/lib/copydesk.mjs keeps
 * every number, date and Latin token intact or throws the proposal away, and the file is rewritten
 * through the YAML document so every other field keeps its formatting. A report goes to pipeline/runs.
 */
import "./lib/env.mjs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { copyEdit, bannedIn } from "./lib/copydesk.mjs";
import { ARTICLES_DIR } from "./lib/article.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DRY = flag("dry-run");
const BODY = flag("body");
const FLAGGED = flag("flagged");
const LIMIT = Number(option("limit", "0")) || 0;
const SLUGS = option("slugs", "").split(",").map((s) => s.trim()).filter(Boolean);

const log = (line) => console.log(`[desk] ${line}`);

const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"));
const articles = [];
for (const file of files) {
  const raw = await readFile(path.join(ARTICLES_DIR, file), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const doc = YAML.parseDocument(match[1]);
  const slug = String(doc.get("slug") ?? file.replace(/\.md$/, ""));
  if (SLUGS.length && !SLUGS.includes(slug)) continue;
  articles.push({ file, raw, doc, slug, body: match[2].trim(), publishedAt: String(doc.get("publishedAt") ?? "") });
}
articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const wanted = FLAGGED
  ? articles.filter((a) => bannedIn({ title: a.doc.get("title"), subtitle: a.doc.get("subtitle"), lede: a.doc.get("lede"), body: a.body }).length > 0)
  : articles;
const queue = LIMIT ? wanted.slice(0, LIMIT) : wanted;
log(`${queue.length} article(s) to read${DRY ? " (dry run)" : ""}${BODY ? ", body included" : ""}`);

const report = { startedAt: new Date().toISOString(), dryRun: DRY, body: BODY, items: [] };
let changedCount = 0;
for (const a of queue) {
  const draft = {
    title: String(a.doc.get("title") ?? ""),
    subtitle: String(a.doc.get("subtitle") ?? ""),
    lede: String(a.doc.get("lede") ?? ""),
    body: a.body,
  };
  let result;
  try {
    result = await copyEdit({ draft, includeBody: BODY, log });
  } catch (error) {
    log(`${a.slug}: desk failed: ${String(error.message).slice(0, 160)}`);
    report.items.push({ slug: a.slug, error: String(error.message).slice(0, 300) });
    continue;
  }
  const item = { slug: a.slug, applied: result.applied, rejected: result.rejected, changes: result.changes, model: result.model };
  for (const f of result.applied) if (f !== "body") item[f] = { before: draft[f], after: result.draft[f] };
  report.items.push(item);
  if (!result.changed) {
    log(`${a.slug}: clean`);
    continue;
  }
  changedCount += 1;
  for (const f of result.applied) {
    if (f === "body") log(`${a.slug}: body rewritten (${draft.body.length} → ${result.draft.body.length} chars)`);
    else log(`${a.slug}: ${f}\n    قبل: ${draft[f]}\n    بعد: ${result.draft[f]}`);
  }
  for (const r of result.rejected) log(`${a.slug}: ${r.field} rejected (${r.reason})`);
  if (DRY) continue;
  for (const f of result.applied) if (f !== "body") a.doc.set(f, result.draft[f]);
  const body = result.applied.includes("body") ? result.draft.body : a.body;
  const front = a.doc.toString({ lineWidth: 0 }).trimEnd();
  await writeFile(path.join(ARTICLES_DIR, a.file), `---\n${front}\n---\n\n${body}\n`);
}

report.finishedAt = new Date().toISOString();
report.changed = changedCount;
await mkdir(path.join(process.cwd(), "pipeline", "runs"), { recursive: true });
const reportFile = path.join(process.cwd(), "pipeline", "runs", `copydesk-${report.startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(reportFile, JSON.stringify(report, null, 2));
log(`done: ${changedCount} of ${queue.length} changed${DRY ? " (nothing written)" : ""}; report ${path.relative(process.cwd(), reportFile)}`);
