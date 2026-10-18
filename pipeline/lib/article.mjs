import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { boxFacts } from "./keyfacts.mjs";
import { sha1, slugifyLatin, wordCount } from "./util.mjs";

export const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");

/** A fully rechecked style refresh keeps the original address/date; its reason stays in the run audit. */
export function mergeNewsRefresh(original, generated, { note, at = new Date().toISOString() }) {
  const split = (raw) => String(raw).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const oldParts = split(original), newParts = split(generated);
  if (!oldParts || !newParts || !String(note ?? "").trim()) throw new Error("refresh requires two valid articles and an editorial note");
  const old = YAML.parse(oldParts[1]), fresh = YAML.parse(newParts[1]);
  if (old.kind !== "news" || fresh.kind !== "news" || old.slug !== fresh.slug || old.section !== fresh.section) throw new Error("refresh must keep the news article's identity and section");
  const data = { ...old, ...fresh, slug: old.slug, publishedAt: old.publishedAt, updatedAt: at,
    image: old.image ?? null, corrections: old.corrections ?? [] };
  delete data.updates;
  if (data.models && old.models) data.models.vision = old.models.vision ?? null;
  // A refresh cannot turn a live story into a draft or change an editor's cover choice.
  for (const key of ["draft", "featured"]) {
    if (Object.hasOwn(old, key)) data[key] = old[key]; else delete data[key];
  }
  return `---\n${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${newParts[2].trim()}\n`;
}

export function buildSlug(draft, story) {
  const base = slugifyLatin(draft.slug) || slugifyLatin(story?.headlineHint) || "story";
  const suffix = sha1(`${draft.title}|${new Date().toISOString().slice(0, 10)}`).slice(0, 6);
  const slug = `${base}-${suffix}`;
  // Never overwrite a published file: two pieces with one title on one day get numbered.
  let out = slug;
  for (let n = 2; existsSync(path.join(ARTICLES_DIR, `${out}.md`)); n += 1) out = `${slug}-${n}`;
  return out;
}

export function readingMinutes(draft) {
  const words = wordCount(`${draft.lede}\n${draft.body}\n${draft.whyItMatters}`);
  return Math.max(1, Math.round(words / 180));
}

/** The kinds of piece the newsroom files: news stories, explainers, house analyses and readings of research papers. */
// «في العمق» (feature) joined on 2026-09-24; its first test run was lost at this very line, after passing every check.
export const KINDS = new Set(["news", "explainer", "analysis", "paper", "weekly", "feature"]);

/** Serializes an article as Markdown with YAML frontmatter. `kind` is "news" (default), "explainer", "analysis" or "paper". */
/** `pending: true` writes the article as a draft: it stays out of the built site until the editor publishes it. */
export function serializeArticle({ draft, slug, section, sources, image, models, quality, kind = "news", publishedAt, pending = false, deskedAt = null, format = "full" }) {
  if (!KINDS.has(kind)) throw new Error(`unknown article kind "${kind}" (${[...KINDS].join(", ")})`);
  const frontmatter = {
    title: draft.title,
    subtitle: draft.subtitle,
    slug,
    section,
    kind,
    // "short": a short story (lib/editorial.mjs SHORT_STORY), never the cover's lead; a developed report has no field.
    ...(format === "short" ? { format } : {}),
    publishedAt: publishedAt ?? new Date().toISOString(),
    lede: draft.lede,
    // The last word on the box, whatever path the draft came by (a repair, a revision): figures only under «الأرقام».
    keyFacts: boxFacts(draft.keyFacts, kind),
    whyItMatters: draft.whyItMatters,
    tags: draft.tags,
    regions: draft.regions,
    readingMinutes: readingMinutes(draft),
    chart: draft.chart ?? null,
    table: draft.table ?? null,
    image: image
      ? {
          url: image.url,
          width: image.width,
          height: image.height,
          alt: image.alt,
          credit: image.credit,
          license: image.license,
          licenseUrl: image.licenseUrl || undefined,
          pageUrl: image.pageUrl,
          // A handout (lib/images.mjs): the report it was found in, kept for the record and never printed.
          foundOn: image.foundOn || undefined,
        }
      : null,
    sources: sources.map((s) => ({
      name: s.sourceName,
      nameEn: s.sourceNameEn,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt ?? undefined,
      lang: s.lang,
    })),
    models,
    quality,
    ai: true,
  };
  // The copy desk edited this story on its way in, so no later sweep sends it to the desk again.
  if (deskedAt) frontmatter.deskedAt = deskedAt;
  if (pending) frontmatter.draft = true;
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${draft.body.trim()}\n`;
}

/**
 * Loads the metadata and text of existing articles (for dedup, recency, related pieces, and as the
 * material an analysis draws on). `kind` is news, explainer, analysis or paper; `body` is the Markdown text.
 */
export async function loadExistingArticles() {
  let files = [];
  try {
    files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(ARTICLES_DIR, file), "utf8");
      const match = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) continue;
      const data = YAML.parse(match[1]);
      out.push({
        file,
        slug: data.slug,
        title: data.title,
        subtitle: data.subtitle ?? "",
        section: data.section,
        kind: data.kind ?? "news",
        format: data.format === "short" ? "short" : "full",
        publishedAt: data.publishedAt,
        lede: data.lede ?? "",
        body: match[2].trim(),
        keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts : [],
        whyItMatters: data.whyItMatters ?? "",
        tags: data.tags ?? [],
        regions: data.regions ?? [],
        imageUrl: data.image?.url ?? null,
        sourceUrls: (data.sources ?? []).map((s) => s.url).filter(Boolean),
        quality: data.quality && typeof data.quality === "object" ? data.quality : null,
      });
    } catch {
      /* ignore malformed file */
    }
  }
  return out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}
