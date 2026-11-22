/**
 * Codex's second review of 2026-11-22: seventeen newsroom faults, each held here on its known case. No network and no
 * model: stand-ins answer for both. Every case fails on the code before (most of the functions it names did not exist,
 * or answered the other way).
 */
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { quoteFound, verifyStory } from "../pipeline/lib/factcheck.mjs";
import { loadSnapshot, saveSnapshot, snapshotSource, QUOTE_FOUND } from "../pipeline/lib/snapshots.mjs";
import { precheck, repair } from "../pipeline/lib/precheck.mjs";
import { ungroundedNumbers, scaledCounts } from "../pipeline/lib/util.mjs";
import { judgeRewrite } from "../pipeline/lib/copydesk.mjs";
import { silentFeeds } from "../pipeline/lib/health.mjs";
import { selectStories } from "../pipeline/lib/select.mjs";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(want)})`}`);
}
const source = (file) => readFileSync(file, "utf8");
const dir = mkdtempSync(path.join(os.tmpdir(), "khz-codex-"));

try {
  // 1. A quote the check could not find in its source is no part of that source's saved copy.
  const page = "The company reported a profit of 4.2 billion riyals for the quarter. Its board met on Tuesday.";
  const invented = "The board approved a dividend of two riyals a share for the year";
  const checks = [
    { field: "body", sentence: "بلغت الأرباح 4.2 مليار ريال.", verdict: "supported", status: "supported", sourceN: 1, quote: "The company reported a profit of 4.2 billion riyals for the quarter." },
    { field: "body", sentence: "وأقر المجلس توزيع ريالين للسهم.", verdict: "supported", status: "no-evidence", sourceN: 1, quote: invented },
  ];
  await saveSnapshot({ slug: "a-story", title: "t", sources: [{ url: "https://example.com/a", text: page }], checks, storyText: "4.2", dir });
  const copy = loadSnapshot("a-story", { dir });
  check("a quote the check never found in the source is not saved as the source's words, and reading the copy back does not find it",
    [copy.sources[0].passages.includes("dividend"), quoteFound(invented, snapshotSource(copy, "https://example.com/a").text), copy.sources[0].passages.includes("4.2 billion"), QUOTE_FOUND.has("no-evidence"), QUOTE_FOUND.has("unverified")],
    [false, false, true, false, false]);
  // …and a copy saved before the fix, which holds such a quote as a loose passage, gives it up when read.
  const { gzipSync } = await import("node:zlib");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(dir, "old-story.json.gz"), gzipSync(Buffer.from(JSON.stringify({ slug: "old-story", sources: [{ url: "https://example.com/o", passages: `${page} ${invented}` }], claims: [{ status: "no-evidence", source: 1, quote: invented }, { status: "supported", source: 1, quote: "Its board met on Tuesday." }] }))));
  const old = loadSnapshot("old-story", { dir });
  check("an older copy's unfound quote is left out as the copy is read, its found quotes kept", [old.sources[0].passages.includes("dividend"), old.sources[0].passages.includes("Its board met on Tuesday.")], [false, true]);

  // 3. A refreshed story's evidence is its refresh's.
  await saveSnapshot({ slug: "a-story-refresh-1700000000000", title: "t2", sources: [{ url: "https://example.com/a", text: page }, { url: "https://example.com/b", text: page }], checks: [], storyText: "", dir });
  await saveSnapshot({ slug: "a-story-refresh-1800000000000", title: "t3", sources: [{ url: "https://example.com/a", text: page }, { url: "https://example.com/b", text: page }, { url: "https://example.com/c", text: page }], checks: [], storyText: "", dir });
  check("a refreshed story is read against its newest refresh's evidence, another story's stays its own", [loadSnapshot("a-story", { dir }).title, loadSnapshot("a-story", { dir }).sources.length, loadSnapshot("old-story", { dir }).slug], ["t3", 3, "old-story"]);

  // 2. A sentence the check calls supported on a quote code cannot find gets the last reading.
  const draft = { title: "عنوان", subtitle: "عنوان فرعي للخبر.", lede: "أعلنت الشركة أرباحها الفصلية.", body: "بلغت الأرباح 4.2 مليار ريال.\n\nوأقر المجلس توزيع ريالين للسهم عن العام." };
  let judged = [];
  const result = await precheck({
    draft, sources: [{ url: "https://example.com/a", title: "Profit", text: page }], unsourced: true,
    verify: async () => ({ counts: {}, checks: [{ id: 5, field: "body", verdict: "supported", status: "no-evidence", sentence: "وأقر المجلس توزيع ريالين للسهم عن العام.", quote: invented, source: 1 }] }),
    judgeWith: async ({ sentences }) => { judged = sentences.map((s) => s.id); return { answers: sentences.map((s) => ({ id: s.id, verdict: "unsourced" })) }; },
  });
  check("a «supported» sentence whose quote code cannot find is read again, and cut when nothing bears it out", [judged, result.ok, result.trimmed, /ريالين/.test(result.draft.body)], [[5], true, 1, false]);

  // 4. A quotation that drops a negation is not the source's.
  const refusal = "وأعلنت الهيئة عدم الموافقة على تنفيذ المشروع في المنطقة الصناعية الجديدة هذا العام";
  check("a quotation that loses «عدم» is not found in a source that says it, the same words with it are, and a dropped plain word still is",
    [quoteFound("وأعلنت الهيئة الموافقة على تنفيذ المشروع في المنطقة الصناعية الجديدة هذا العام", refusal), quoteFound(refusal, `قالت مصادر. ${refusal}.`), quoteFound("وأعلنت الهيئة عدم الموافقة على تنفيذ المشروع في المنطقة الجديدة هذا العام", refusal)],
    [false, true, true]);
  check("the desk notes keep a quotation only when the whole of it stands in its source", [/flat\(texts\[n - 1\]\)\.includes\(flat\(text\)\)/.test(source("pipeline/lib/write.mjs")), /text\.slice\(0, 40\)/.test(source("pipeline/lib/write.mjs"))], [true, false]);

  // 5. A count's rounding keeps its scale.
  const src = ["The offering drew 455,758 investors, and the fund holds $1.9bn."];
  check("455,758 is «456 ألف», never «456 مليون»; a figure the source gives as written keeps its own unit",
    [ungroundedNumbers("شارك نحو 456 ألف مستثمر", src), ungroundedNumbers("شارك نحو 456 مليون مستثمر", src), ungroundedNumbers("يدير الصندوق 1.9 مليار دولار", src), ungroundedNumbers("أصول بقيمة 4.5 مليار دولار", ["assets of $4,500m"]), scaledCounts("نحو 456 ألف مستثمر").map((c) => [c.value, c.scale])],
    [[], ["456"], [], [], [[456, 1000]]]);
  const story = { title: "طرح يجذب المستثمرين", subtitle: "", lede: "شارك 455758 مستثمراً في الطرح.", body: "شارك 455758 مستثمراً في الطرح الذي أُغلق أمس.", keyFacts: [], whyItMatters: "" };
  const desk = (lede) => judgeRewrite(story, { lede }, ["lede"]);
  check("the copy desk takes the rounding with its own scale word and refuses it with another",
    [Object.keys(desk("شارك نحو 456 ألف مستثمر في الطرح.").accepted), desk("شارك نحو 456 مليون مستثمر في الطرح.").rejected.map((r) => r.field)], [["lede"], ["lede"]]);

  // …and what a review of that first version found the same day: true figures refused, real text cut, forms missed.
  check("a source's short scale forms, a table stated in thousands and the desks' own cuts are the same figure",
    [ungroundedNumbers("12.3 مليار دولار", ["revenue of $12,345m"]), ungroundedNumbers("455.8 مليون ريال", ["Net profit (SAR thousands): 455,758"]), ungroundedNumbers("123.5 تريليون ين", ["¥123,456bn"]), ungroundedNumbers("نحو 455 ألف مستثمر", ["455,758 investors"]), ungroundedNumbers("2.68 مليون برميل", ["2,675,000 barrels"])],
    [[], [], [], [], []]);
  check("a zero in a chart is no figure to find", ungroundedNumbers("0 3 4", ["growth of 3% and 4%"], { ignoreYears: false, everyFigure: true }), []);
  writeFileSync(path.join(dir, "short-quote.json.gz"), gzipSync(Buffer.from(JSON.stringify({ slug: "short-quote", sources: [{ url: "https://example.com/s", passages: "The Fed held rates steady on Wednesday. Powell said inflation remains elevated." }], claims: [{ status: "no-evidence", source: 1, quote: "held rates steady" }, { status: "not_found", source: 1, quote: "Powell said inflation remains elevated." }] }))));
  check("a quote too short to be looked for, or one never tested, stays in the copy: it may be the page's own words", loadSnapshot("short-quote", { dir }).sources[0].passages, "The Fed held rates steady on Wednesday. Powell said inflation remains elevated.");
  check("a near match keeps «won't», «ألا» and an attached «ولن» too",
    [quoteFound("the company said it will cut jobs across its European plants this year", "the company said it won't cut jobs across its European plants this year"), quoteFound("وقالت الوزارة إنها قررت أن ترفع أسعار الوقود في الربع المقبل من العام", "وقالت الوزارة إنها قررت ألا ترفع أسعار الوقود في الربع المقبل من العام"), quoteFound("وقالت الشركة إنها تغير خطتها الاستثمارية في المنطقة هذا العام", "وقالت الشركة إنها ولن تغير خطتها الاستثمارية في المنطقة هذا العام")],
    [false, false, false]);
  const { roundupFrame } = await import("../pipeline/lib/select.mjs");
  check("«بين الأكثر تداولاً وسط…» is one event, a market set between two things still a roundup", [roundupFrame("أسهم أرامكو بين الأكثر تداولاً وسط ارتفاع النفط"), roundupFrame("النفط بين مخاوف الإمدادات وضعف الطلب")], [false, true]);

  // 6. A chart's values are all figures.
  check("a chart's small whole values are held to the sources like any figure",
    [ungroundedNumbers("12 27", ["The share rose to 40%."], { ignoreYears: false }), ungroundedNumbers("12 27", ["The share rose to 40%."], { ignoreYears: false, everyFigure: true }), ungroundedNumbers("40", ["The share rose to 40%."], { ignoreYears: false, everyFigure: true }), /everyFigure: true/.test(source("pipeline/lib/verify.mjs"))],
    [[], ["12", "27"], [], true]);

  // 7. The repair may correct a table's cell, and only a cell.
  const tabled = { title: "ع", subtitle: "ف.", lede: "ل.", whyItMatters: "", keyFacts: [], body: "نص الخبر كما هو.", table: { columns: ["المنطقة", "النسبة"], rows: [["الشمال", "45%"], ["الجنوب", "45%"]] } };
  const found = [{ id: 9, field: "table", sentence: "المنطقة: الشمال · النسبة: 45%", quote: "North 40%, South 45%.", correction: "North is 40%", sourceName: "S", class: "figure" }];
  const answer = (table) => async ({ validate }) => { const data = { title: "ع", subtitle: "ف.", lede: "ل.", whyItMatters: "", keyFacts: [], body: "نص الخبر كما هو.", table }; validate(data); return { data, model: "stand-in" }; };
  const sources = [{ n: 1, name: "S", title: "Regions", text: "North 40%, South 45%." }];
  const fixed = await repair({ draft: tabled, sources, found, refusal: "", log: () => {}, chatWith: answer({ columns: tabled.table.columns, rows: [["الشمال", "40%"], ["الجنوب", "45%"]] }) });
  const reshaped = await repair({ draft: tabled, sources, found, refusal: "", log: () => {}, chatWith: answer({ columns: tabled.table.columns, rows: [["الشمال", "40%"]] }) });
  const made = await repair({ draft: tabled, sources, found, refusal: "", log: () => {}, chatWith: answer({ columns: tabled.table.columns, rows: [["الشمال", "38%"], ["الجنوب", "45%"]] }) });
  check("a wrong cell is corrected; a table that loses a row, or a cell no source carries, is refused",
    [fixed.draft?.table.rows[0][1], fixed.problems, reshaped.draft, made.draft, made.problems.some((p) => /stand in no source/.test(p))], ["40%", [], null, null, true]);

  // 8, 12. No notes, no story; a refused login is the newsroom's fault.
  const run = source("pipeline/run.mjs");
  const llm = source("pipeline/lib/llm.mjs");
  check("a story whose desk notes fail is not written from the raw sources", [/if \(!notes\) \{\s*entry\.outcome = "skipped: the desk notes could not be taken";/.test(run), /the writer works from the sources alone/.test(source("pipeline/lib/write.mjs"))], [true, false]);
  check("a refused login keeps its mark to the caller, which defers the stories unmarked",
    [/refused \? \{ status: 401 \} : \{\}/.test(llm), /if \(error\.meta\?\.status === 401\) \{\s*\/\/ So is a refused login/.test(run), /error\.meta\?\.quota \|\| error\.meta\?\.status === 401\) throw error/.test(source("pipeline/lib/write.mjs"))], [true, true, true]);

  // 9. A feed item dated days ahead is not fresh.
  const feeds = source("pipeline/lib/feeds.mjs");
  check("a feed item dated more than six hours ahead is offered to no one", [/kept\.filter\(\(item\) => !ahead\(item\)\)\.filter\(/.test(feeds)], [true]);

  // 10. A feed that stops answering stays on the list.
  const now = Date.parse("2026-11-22T12:00:00Z");
  const ago = (h) => new Date(now - h * 36e5).toISOString();
  const outlets = [{ id: "dark", kind: "news" }, { id: "still", kind: "news" }, { id: "fine", kind: "news" }, { id: "empty", kind: "news" }, { id: "unasked", kind: "news" }];
  const heard = { dark: { triedAt: ago(2), readAt: ago(120), newestAt: ago(125) }, still: { triedAt: ago(2), readAt: ago(2), newestAt: ago(100) }, fine: { triedAt: ago(2), readAt: ago(2), newestAt: ago(5) }, empty: { triedAt: ago(2), readAt: ago(2), newestAt: ago(90) }, unasked: { readAt: ago(200), newestAt: ago(300) } };
  check("a feed unanswered for five days is listed with the one that answers with nothing new; one not asked lately is not", silentFeeds(outlets, heard, now).map((s) => s.id), ["dark", "still", "empty"]);
  check("a reading with no dated item keeps the feed's last known date", [/newestAt: now\.newestAt \?\? old\.newestAt \?\? null/.test(run), /heard\[source\.id\] = \{ triedAt: isoNow\(\) \}/.test(run)], [true, true]);

  // 11. A score outside 1 to 10 is no score.
  const picked = await selectStories({
    candidates: ["c1", "c2"].map((id) => ({ id, title: id, sourceNameEn: "BBC", reliability: 2, kind: "news", lang: "en", publishedAt: new Date().toISOString() })),
    recentTitles: [], sections: JSON.parse(source("src/data/sections.json")), limit: 1, log: () => {},
    chatWith: async () => ({ data: { stories: [{ ids: ["c1"], section: "economy", importance: 100, headline_hint: "خبر بدرجة خاطئة" }, { ids: ["c2"], section: "economy", importance: 9, headline_hint: "خبر مهم" }] }, model: "stand-in" }),
  });
  check("a story scored 100 does not lead one scored 9", picked.stories.map((s) => [s.headlineHint, s.importance]), [["خبر مهم", 9], ["خبر بدرجة خاطئة", 0]]);

  // 13, 14, 15. The picture desk.
  const images = source("pipeline/lib/images.mjs");
  const libs = source("pipeline/lib/photolibs.mjs");
  check("after the allowance is refused once the picture desk asks the model no more in that search", [/if \(failed\?\.spent\) throw failed\.spent;/.test(images), /if \(failed && error\?\.meta\?\.quota\) failed\.spent = error;/.test(images)], [true, true]);
  check("candidates no judge could be shown count as a search cut short", [/if \(!list\.length && unseen\) failures\.getStore\(\)\?\.push\(/.test(images)], [true]);
  check("Openverse's «wait N seconds» rests it for those seconds", [/openverseRestUntil = Math\.max\(openverseRestUntil, Date\.now\(\) \+ Math\.max\(1, wait\) \* 1000\)/.test(libs)], [true]);

  // 16, 17. The model call.
  check("an answer cut at the token limit is tried again with twice the room, or not at all", [/if \(error\.meta\?\.truncated\) \{\s*if \(!maxTokens\) break;\s*maxTokens \*= 2;/.test(llm), /\{ truncated: true \}/.test(llm)], [true, true]);
  check("the Claude API path reports its tokens to the per-desk count, cached reads apart", [/const tokens = \{ in: \(used\.input_tokens \?\? 0\) \+ \(used\.cache_creation_input_tokens \?\? 0\), read: used\.cache_read_input_tokens \?\? 0/.test(llm), /usage\.cacheReadTokens \+= used\.cache_read_input_tokens \?\? 0;/.test(llm)], [true, true]);

  // The check itself: a «supported» verdict on a quote the source does not hold is "no-evidence", as before.
  const v = await verifyStory({ story: { title: "عنوان الخبر", body: "وأقر المجلس توزيع ريالين للسهم عن العام." }, sources: [{ n: 1, name: "S", title: "Profit", text: page }], chatWith: async ({ validate }) => { const data = { checks: [{ id: 1, verdict: "not_found" }, { id: 2, verdict: "supported", source: 1, quote: invented }] }; validate(data); return { data, model: "stand-in" }; } });
  check("the check still calls such a sentence «no-evidence»", v.checks.map((c) => c.status), ["not_found", "no-evidence"]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log("\nCodex's review of 22 November: every case holds.");
