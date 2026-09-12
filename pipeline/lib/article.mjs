import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { sha1, slugifyLatin, wordCount } from "./util.mjs";

export const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");

export function buildSlug(draft, story) {
  const base = slugifyLatin(draft.slug) || slugifyLatin(story?.headlineHint) || "story";
  const suffix = sha1(`${draft.title}|${new Date().toISOString().slice(0, 10)}`).slice(0, 6);
  return `${base}-${suffix}`;
}

export function readingMinutes(draft) {
  const words = wordCount(`${draft.lede}\n${draft.body}\n${draft.whyItMatters}`);
  return Math.max(1, Math.round(words / 180));
}

/** The kinds of piece the newsroom files: news stories, explainers, house analyses and readings of research papers. */
export const KINDS = new Set(["news", "explainer", "analysis", "paper"]);

/** Serializes an article as Markdown with YAML frontmatter. `kind` is "news" (default), "explainer", "analysis" or "paper". */
export function serializeArticle({ draft, slug, section, sources, image, models, quality, kind = "news", publishedAt }) {
  if (!KINDS.has(kind)) throw new Error(`unknown article kind "${kind}" (${[...KINDS].join(", ")})`);
  const frontmatter = {
    title: draft.title,
    subtitle: draft.subtitle,
    slug,
    section,
    kind,
    publishedAt: publishedAt ?? new Date().toISOString(),
    lede: draft.lede,
    keyFacts: draft.keyFacts,
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
        publishedAt: data.publishedAt,
        lede: data.lede ?? "",
        body: match[2].trim(),
        keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts : [],
        whyItMatters: data.whyItMatters ?? "",
        tags: data.tags ?? [],
        regions: data.regions ?? [],
        imageUrl: data.image?.url ?? null,
        sourceUrls: (data.sources ?? []).map((s) => s.url).filter(Boolean),
      });
    } catch {
      /* ignore malformed file */
    }
  }
  return out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}
