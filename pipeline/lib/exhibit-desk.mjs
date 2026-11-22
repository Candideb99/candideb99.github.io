/**
 * The newsroom's own «من زمن الفكرة» (the owner, 2026-11-22: "we do not have to add drawings everyhwere, only if it would
 * fit or make sense and we should let claude/news room judge that by itself, no?", then "Yes, ideas only"). For a
 * «الفكر الاقتصادي» piece whose idea has no drawing in the catalogue (pipeline/lib/exhibits.mjs), the desk judges whether a
 * drawing of the idea's own time would show the reader something the piece explains, and most weeks answers no. When it
 * says yes it searches Wikimedia Commons for period cartoons and engravings, looks at them, and keeps one with a caption
 * saying what it shows.
 *
 * What a model is not trusted with stays in code, read from each file's record before any model sees it:
 * - **copyright**: published 95 years before this year began, and its artist dead 70 full years (a death year read from
 *   the record); an artist named without a death year only for a drawing 150 years old, an unsigned one 120;
 * - **a people, a race or a religion drawn as a joke**: the period's cartoons are full of them (Puck's «free trade» wall of
 *   1882 is an anti-Chinese caricature), so a file whose title, description or categories name such a subject never
 *   reaches the judge, who is told to refuse the rest (a people drawn as apes, features exaggerated);
 * - **a drawing**: a cartoon, a caricature, an engraving, a lithograph; never a photograph.
 *
 * Two calls when it looks (the plan, then the judge with the caption), one when it does not; never more than three. A
 * failure anywhere gives no drawing, never a lost piece.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chat } from "./llm.mjs";
import { claudeEffort } from "./claude-effort.mjs";
import { inlineImage } from "./images.mjs";
import { fixNames } from "./spellings.mjs";
import { USER_AGENT, fetchWithTimeout, stripHtml } from "./util.mjs";
import { exhibitOf, printable, PD_PUBLISHED_YEARS } from "./exhibits.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
/** An artist named without a death year: only a drawing this old is surely free (an artist of 20 then is dead 70 years). */
export const NAMED_UNDATED_YEARS = 150;
const PER_SEARCH = 12;
const LOOK = 6;
const LOOKS = 2;

/** A people, a race, a nation's minority or a religion as the subject: never shown to the judge. */
export const OFFENCE = /racis|antisemit|anti-?(?:chinese|irish|semit|catholic|jewish|black|japanese|immigra|italian|mexican|mormon|arab|muslim|turk)|stereotyp|blackface|minstrel|yellow peril|jim crow|\bcoons?\b|\bdark(?:e)?ys?\b|\bnegro|\bsambo|chinam[ae]n|\bjaps?\b|\bsavages?\b|cannibal|lynch|nativis|ku klux|\bkkk\b|slaver|\b(?:jews?|jewish|judaism|muslims?|islam|mohammed|mahomet|arabs?|turks?|ottoman|semitic|chinese|irish|african[- ]americans?|native americans?|immigrants?|hindus?)\b/i;
/** What a period drawing is called on its record. */
const DRAWING = /cartoon|caricature|lithograph|engraving|etching|woodcut|wood cut|illustration|drawing|\bprints?\b|\bpuck\b|\bpunch\b|\bjudge\b|harper'?s|frank leslie|satir/i;
const PHOTOGRAPH = /\bphotographs?\b|\bphoto\b|daguerreotype|glass negative|film negative|\bnegatives?\b/i;
const INSTITUTION = /library of congress|miscellaneous items|\bppoc\b|unknown|anonymous|lithographic company|lith\.? co\b|\bcompany\b|publisher|\bfile author\b/i;

/** The latest year a record's date names (a range or «c1883» read at its end), or null. */
export function publishedYear(dateText) {
  const years = [...stripHtml(String(dateText ?? "")).matchAll(/(?<!\d)(1[5-9]\d\d)(?!\d)/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

/** The latest death year among the record's artists («Gillam, Bernhard, 1856-1896, artist»), or null. */
export function deathYear(artistText) {
  const years = [...stripHtml(String(artistText ?? "")).matchAll(/(?<!\d)1[5-9]\d\d\s*[-–]\s*(1[5-9]\d\d)(?!\d)|\bd\.\s*(1[5-9]\d\d)\b/g)].map((m) => Number(m[1] ?? m[2]));
  return years.length ? Math.max(...years) : null;
}

/** «Gillam, Bernhard, 1856-1896, artist» → «Bernhard Gillam»; «Pughe, J. S. (John S.), 1870-1909» → «J. S. Pughe». */
export function artistName(artistText) {
  const text = stripHtml(String(artistText ?? ""));
  for (const part of text.split(";")) {
    const m = part.match(/^\s*([^,]+?),\s*([^,(]+?)\s*(?:\([^)]*\))?\s*,\s*1[5-9]\d\d\s*[-–]\s*1[5-9]\d\d/);
    if (m) return `${m[2].trim()} ${m[1].trim()}`;
  }
  const plain = text.split(/[;,]/)[0].trim();
  return plain && !INSTITUTION.test(plain) && plain.length <= 40 ? plain : "";
}

/**
 * Why a Commons record may not run, or "": not a JPEG, not free, a photograph, no drawing, a subject never drawn here,
 * too new, its artist not long enough dead, too small. `year` is this year.
 */
export function drawingFault(record, year = new Date().getUTCFullYear()) {
  const words = `${record.title} ${record.description} ${record.categories}`;
  if (!/^image\/jpeg$/i.test(record.mime ?? "")) return "not a JPEG";
  if (!/public domain|^pd\b|cc0|no restrictions/i.test(record.license ?? "") || /\bnc\b|\bnd\b|non-?commercial|no ?deriv/i.test(record.license ?? "")) return `licence ${record.license || "none"}`;
  if (PHOTOGRAPH.test(words)) return "a photograph";
  if (!DRAWING.test(words)) return "not a drawing by its record";
  if (OFFENCE.test(words)) return "a people, a race or a religion as its subject";
  const published = publishedYear(record.date) ?? publishedYear(record.title);
  if (!published) return "no year of publication";
  if (published > year - PD_PUBLISHED_YEARS) return `published ${published}`;
  const died = deathYear(record.artist);
  if (died != null) {
    if (died > year - 71) return `its artist died in ${died}`;
  } else if (artistName(record.artist) && published > year - NAMED_UNDATED_YEARS) return `its artist's death unknown (${published})`;
  else if (published > year - 120) return `unsigned, published ${published}`;
  if ((record.width ?? 0) < 700 || (record.height ?? 0) < 450) return "too small";
  const ratio = record.width / record.height;
  if (ratio < 0.5 || ratio > 2.3) return "an odd shape";
  return "";
}

/** A search without its years and with its first four words at most: «minimum wage cartoon 1913» → «minimum wage cartoon». */
export function plainerSearch(query) {
  return String(query ?? "").replace(/\b(?:1[5-9]\d\ds?|\d{1,2}(?:st|nd|rd|th))\b/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
}

/** A crop the judge proposes (fractions trimmed off each edge), or null when it would cut more than the frame's borders. */
export function cropBox(crop) {
  if (!crop || typeof crop !== "object") return null;
  const v = ["left", "top", "right", "bottom"].map((k) => Number(crop[k] ?? 0));
  if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 0.25)) return null;
  const [l, t, r, b] = v;
  if ((1 - l - r) * (1 - t - b) < 0.6) return null;
  return v.every((x) => x < 0.005) ? null : { left: l, top: t, right: r, bottom: b };
}

const IMAGE_INFO = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "960", iiextmetadatafilter: "LicenseShortName|Artist|DateTimeOriginal|ImageDescription|Categories" };

async function searchDrawings(query, log) {
  const params = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `filetype:bitmap ${query}`, gsrnamespace: "6", gsrlimit: String(PER_SEARCH), ...IMAGE_INFO });
  return records(params, `commons "${query}"`, log);
}

/**
 * The files of a Commons category the plan names («Corn Laws», «Puck (magazine) covers»): period cartoons are filed under
 * the magazine and the subject far more than their titles say them, so a word search finds few. The category is the first
 * whose name carries every word asked; its newest 40 files.
 */
async function browseCategory(name, log) {
  const words = String(name ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  if (!words.length) return [];
  try {
    const find = new URLSearchParams({ action: "query", format: "json", list: "search", srsearch: name, srnamespace: "14", srlimit: "8" });
    const found = await fetchWithTimeout(`${API}?${find}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!found.ok) return [];
    const titles = ((await found.json())?.query?.search ?? []).map((hit) => String(hit.title ?? ""));
    const category = titles.find((t) => words.every((w) => t.toLowerCase().includes(w)));
    if (!category) {
      log(`exhibit: commons category "${name}": none carries its name`);
      return [];
    }
    const params = new URLSearchParams({ action: "query", format: "json", generator: "categorymembers", gcmtitle: category, gcmtype: "file", gcmlimit: "40", ...IMAGE_INFO });
    return records(params, `commons ${category}`, log);
  } catch (error) {
    log(`exhibit: commons category "${name}": ${error.message}`);
    return [];
  }
}

async function records(params, what, log) {
  try {
    const response = await fetchWithTimeout(`${API}?${params}`, { headers: { "user-agent": USER_AGENT } }, 20000);
    if (!response.ok) {
      log(`exhibit: ${what} HTTP ${response.status}`);
      return [];
    }
    const pages = Object.values((await response.json())?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.flatMap((page) => {
      const info = page.imageinfo?.[0];
      if (!info) return [];
      const meta = info.extmetadata ?? {};
      const title = String(page.title ?? "");
      return [{
        title: title.replace(/^File:/, ""),
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        thumb: String(info.thumburl ?? "").replace(/\?.*$/, ""),
        mime: info.mime,
        width: info.width,
        height: info.height,
        license: stripHtml(meta.LicenseShortName?.value ?? ""),
        artist: stripHtml(meta.Artist?.value ?? ""),
        date: stripHtml(meta.DateTimeOriginal?.value ?? ""),
        description: stripHtml(meta.ImageDescription?.value ?? "").slice(0, 400),
        categories: stripHtml(meta.Categories?.value ?? "").slice(0, 600),
      }];
    });
  } catch (error) {
    log(`exhibit: ${what}: ${error.message}`);
    return [];
  }
}

async function fetchBytes(url) {
  const response = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT } }, 30000);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The calls the desk makes to the world, replaced by the self-test (scripts/exhibits-selftest.mjs). */
export const outside = {
  chat: (options) => chat(options),
  search: searchDrawings,
  browse: browseCategory,
  inline: (url, log) => inlineImage(url, log, { maxWidth: 800 }),
  fetchBytes,
};

const pieceText = (draft) => [draft.lede, draft.body].filter(Boolean).join("\n\n").slice(0, 2400);

function planPrompt(draft, idea) {
  const who = (idea.economists ?? []).map((e) => e.en).join(", ");
  return `A piece of «الفكر الاقتصادي», the economic-thought column of an Arabic economics news website, explains one economist's idea with a story of this week.
The idea: ${who} (${idea.year}), ${idea.work}. ${idea.idea ?? ""}
The piece's headline: ${draft.title}
Its dek: ${draft.subtitle ?? ""}
Its text (Arabic):
${pieceText(draft)}

The page may print, inside the text, one drawing made at the time (a newspaper or magazine cartoon, a caricature, an engraving of a scene), published in 1930 or earlier: a document of the debate the idea answered or of the thing it explains, as people saw it then. Most pieces should print none. Say yes only when such a drawing would show the reader something this piece explains, about the idea itself and not about this week's news. A portrait of the economist, a title page, a chart or a scene that only shares a word with the idea is not a reason.
If yes, say in one English sentence what the drawing should show, and give 2 to 4 English searches of 2 to 5 words for Wikimedia Commons, which files such drawings under the archive's own title, the magazine or newspaper that printed them, and their subject (no years or case names: every word must be in a file's record), and up to 2 Commons category names where such drawings are filed (the subject's category, or the magazine's cartoons on it).
Return JSON: {"fits":true|false,"show":"...","searches":["..."],"categories":["..."]}`;
}

function judgePrompt(draft, idea, show, shown) {
  return `You are the picture editor of an Arabic economics news website. A «الفكر الاقتصادي» piece on ${(idea.economists ?? []).map((e) => e.en).join(", ")}'s idea (${idea.work}) may print one drawing of the idea's own time inside its text.
The piece's headline: ${draft.title}
What the drawing should show: ${show}

The ${shown.length} attached drawings, in this order, with what their archive records say:
${shown.map((r, i) => `${i + 1}. «${r.title}», ${r.date || "date unknown"}${r.artist ? `, ${r.artist}` : ""}. ${r.description}`).join("\n")}

Choose the one that shows what is asked plainly enough to read on a page 640 pixels wide, or none (0). Refuse, whatever it shows: a people, a race, a nation or a religion drawn as a joke (features exaggerated, people drawn as animals), a scene of cruelty, death or violence, nudity, and a drawing whose point the reader cannot see without reading long English text in it. A drawing that only shares a word with the idea is not chosen; when none fits, answer 0.
For the one you choose write, in Arabic as an Arab economics desk writes a caption:
- "caption_ar": one or two sentences saying what the drawing shows, as the record dates it and names where it was printed; its title translated in «» when it has one. Say what it shows, never what it proves; name a person only when the drawing labels him or the record names him. Western digits.
- "alt_ar": what is in the picture in under 15 words, for a reader who cannot see it.
- "crop": the fractions of the frame to trim off each edge so that only the drawing and its own title remain (an archive's colour bar, a book's edge, the page around it), or null; never more than a quarter from any edge.
Return JSON: {"choice":<n or 0>,"why":"...","caption_ar":"...","alt_ar":"...","crop":{"left":0,"top":0,"right":0,"bottom":0}|null}`;
}

/**
 * The drawing for an idea piece, or null. `dir`: where its copy is kept (public/photos/exhibits; null in a dry run, which
 * keeps nothing). `slug` names the copy. `year`: this year.
 */
export async function findExhibit({ draft, idea, slug, dir = null, log = () => {}, year = new Date().getUTCFullYear() }) {
  if (!idea?.id) return null;
  if (exhibitOf(idea.id, { year })) {
    log(`exhibit: [${idea.id}] has the catalogue's drawing; no search`);
    return null;
  }
  try {
    const { data: plan } = await outside.chat({
      role: "editor",
      system: "You are the picture editor of an Arabic economics news website. Reply with one JSON object only.",
      user: planPrompt(draft, idea),
      temperature: 0.1,
      maxTokens: 600,
      timeoutMs: 120000,
      log,
      validate: (d) => {
        if (typeof d?.fits !== "boolean") throw new Error("fits missing");
        if (d.fits && (!String(d.show ?? "").trim() || !Array.isArray(d.searches) || !d.searches.length)) throw new Error("show or searches missing");
      },
    });
    if (!plan.fits) {
      log(`exhibit: [${idea.id}] no drawing would show what the piece explains`);
      return null;
    }
    const searches = plan.searches.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
    const categories = (Array.isArray(plan.categories) ? plan.categories : []).map((s) => String(s).replace(/^Category:/i, "").trim()).filter(Boolean).slice(0, 2);
    log(`exhibit: [${idea.id}] looking for: ${plan.show} (${searches.join(" | ")}${categories.length ? `; categories ${categories.join(" | ")}` : ""})`);
    const seen = new Set();
    const fit = [];
    const refused = {};
    const take = (record) => {
      if (seen.has(record.pageUrl)) return;
      seen.add(record.pageUrl);
      const fault = drawingFault(record, year);
      if (fault) refused[fault.replace(/\d{4}/g, "…")] = (refused[fault.replace(/\d{4}/g, "…")] ?? 0) + 1;
      else fit.push(record);
    };
    for (const name of categories) for (const record of await outside.browse(name, log)) take(record);
    for (const query of searches) {
      // Commons matches every word: a year or a case name in the phrase finds almost nothing (the live try of 2026-11-22,
      // four searches with «1913» and «Adkins» found one file), so a search that finds little is asked again without them.
      let records = await outside.search(query, log);
      const plain = plainerSearch(query);
      if (records.length < 4 && plain && plain !== query) records = [...records, ...(await outside.search(plain, log))];
      for (const record of records) take(record);
    }
    log(`exhibit: ${fit.length} of ${seen.size} drawings may run${Object.keys(refused).length ? `; refused: ${Object.entries(refused).map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}`);
    for (let look = 0; look < LOOKS && look * LOOK < fit.length; look += 1) {
      const batch = fit.slice(look * LOOK, look * LOOK + LOOK);
      const images = [];
      const shown = [];
      for (const record of batch) {
        const data = await outside.inline(record.thumb, log);
        if (data) {
          images.push(data);
          shown.push(record);
        }
      }
      if (!shown.length) continue;
      const { data: verdict } = await outside.chat({
        role: "vision",
        effort: claudeEffort(),
        system: "You are the picture editor of an Arabic economics news website. Reply with one JSON object only.",
        user: judgePrompt(draft, idea, plan.show, shown),
        images,
        temperature: 0.1,
        maxTokens: 1200,
        timeoutMs: 180000,
        log,
        validate: (d) => {
          const n = Number(d?.choice);
          if (!Number.isInteger(n) || n < 0 || n > shown.length) throw new Error("choice out of range");
          if (n && (!String(d.caption_ar ?? "").trim() || !String(d.alt_ar ?? "").trim())) throw new Error("caption or alt missing");
        },
      });
      const n = Number(verdict.choice);
      if (!n) {
        log(`exhibit: look ${look + 1}: none (${String(verdict.why ?? "").slice(0, 160)})`);
        continue;
      }
      const record = shown[n - 1];
      const exhibit = await keep(record, verdict, { slug, dir, year, log });
      if (exhibit) return exhibit;
    }
    log(`exhibit: [${idea.id}] nothing fit`);
    return null;
  } catch (error) {
    log(`exhibit: [${idea.id}] not looked for to the end: ${String(error.message).slice(0, 160)}`);
    return null;
  }
}

async function keep(record, verdict, { slug, dir, year, log }) {
  const published = publishedYear(record.date) ?? publishedYear(record.title);
  const died = deathYear(record.artist);
  const artist = artistName(record.artist);
  const holder = /images from the library of congress/i.test(record.categories) ? "مكتبة الكونغرس" : "ويكيميديا كومنز";
  const file = `/photos/exhibits/${String(slug).replace(/[^a-z0-9-]/gi, "").toLowerCase()}.jpg`;
  let width = Math.min(960, record.width);
  let height = Math.round(width * (record.height / record.width));
  if (dir) {
    const sharp = (await import("sharp")).default;
    const bytes = await outside.fetchBytes(record.thumb);
    let image = sharp(bytes);
    const meta = await image.metadata();
    const box = cropBox(verdict.crop);
    if (box) {
      const left = Math.round(meta.width * box.left);
      const top = Math.round(meta.height * box.top);
      image = image.extract({ left, top, width: Math.round(meta.width * (1 - box.left - box.right)), height: Math.round(meta.height * (1 - box.top - box.bottom)) });
    }
    let out = await image.resize({ width: 960, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length > 280 * 1024) out = await sharp(out.data).jpeg({ quality: 70, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, path.basename(file)), out.data);
    ({ width, height } = out.info);
  }
  const exhibit = {
    file,
    width,
    height,
    kind: /cartoon|caricature|puck|punch|judge|satir/i.test(`${record.title} ${record.categories}`) ? "cartoon" : "engraving",
    title: record.title.replace(/\.jpe?g$/i, ""),
    ...(artist ? { artist } : {}),
    ...(died != null ? { artistDied: died } : {}),
    published,
    source: record.pageUrl,
    alt: fixNames(String(verdict.alt_ar).trim()),
    caption: fixNames(String(verdict.caption_ar).trim()),
    credit: `${artist || `رسم من عام ${published}`} · ملكية عامة · ${holder}`,
    chosenBy: "newsroom",
  };
  if (!printable(exhibit, year)) {
    log(`exhibit: «${record.title}» chosen but its record cannot print`);
    return null;
  }
  log(`exhibit: «${record.title}» (${published}${died ? `, artist d. ${died}` : ""})${dir ? ` kept as ${file}` : " (dry run: not kept)"}: ${exhibit.caption}`);
  return exhibit;
}
