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

/** Serializes an article as Markdown with YAML frontmatter. */
export function serializeArticle({ draft, slug, section, sources, image, models, quality, explainer = false, publishedAt }) {
  const frontmatter = {
    title: draft.title,
    subtitle: draft.subtitle,
    slug,
    section,
    kind: explainer ? "explainer" : "news",
    publishedAt: publishedAt ?? new Date().toISOString(),
    lede: draft.lede,
    keyFacts: draft.keyFacts,
    whyItMatters: draft.whyItMatters,
    tags: draft.tags,
    regions: draft.regions,
    readingMinutes: readingMinutes(draft),
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

/** Loads lightweight metadata of existing articles (for dedup, recency, related). */
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
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      const data = YAML.parse(match[1]);
      out.push({
        file,
        slug: data.slug,
        title: data.title,
        section: data.section,
        kind: data.kind ?? "news",
        publishedAt: data.publishedAt,
        tags: data.tags ?? [],
        sourceUrls: (data.sources ?? []).map((s) => s.url).filter(Boolean),
      });
    } catch {
      /* ignore malformed file */
    }
  }
  return out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}
