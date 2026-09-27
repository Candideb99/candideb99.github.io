#!/usr/bin/env node
/**
 * Holds the published stories to the rules a new story meets where its draft is normalised (lib/write.mjs), so that
 * nothing on the site sits under a label it does not match (the owner, 2026-09-27: "posting info that does not match
 * category/title"):
 *
 * - the key-facts box (lib/keyfacts.mjs): figures only under «الأرقام»; an explainer's glossary is left alone;
 * - the tags (lib/tags.mjs): one spelling per tag, and only tags the story's own text carries;
 * - the regions (lib/regions.mjs): an Arab desk only when the headline, dek or lede names one of its places.
 *
 * Code only, no model. Only those three blocks of the front matter change, and every other field is checked to read
 * back unchanged. No correction note and no update stamp: no fact of the story changes. Run it after any change to
 * those rules, and after a correction takes a pasted item out of a story (its tags go with it).
 *
 *   node pipeline/tidy.mjs [--dry-run] [--slugs=a,b]
 */
import { isDeepStrictEqual } from "node:util";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { boxFacts, isDateValue } from "./lib/keyfacts.mjs";
import { cleanTags, storyText } from "./lib/tags.mjs";
import { groundedRegions } from "./lib/regions.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = new Set((args.find((a) => a.startsWith("--slugs="))?.slice(8) ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const dir = path.join(process.cwd(), "content", "articles");

/** The front matter with one top-level key's block replaced (a list in block or flow form, or a scalar). */
function replaceBlock(front, key, value) {
  const block = front.match(new RegExp(`^${key}:(?: .*)?\\n(?: {2}.*\\n)*`, "m"));
  // Replacer functions, so a "$" in a value is never read as a replacement pattern.
  const text = YAML.stringify({ [key]: value }, { lineWidth: 0 });
  return block ? front.replace(block[0], () => text) : `${front.endsWith("\n") ? front : `${front}\n`}${text}`;
}

const counts = { stories: 0, facts: 0, tags: 0, respelled: 0, regions: 0, refused: 0 };
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md")).sort()) {
  if (ONLY.size && !ONLY.has(file.replace(/\.md$/, ""))) continue;
  const full = path.join(dir, file);
  const raw = (await readFile(full, "utf8")).replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) continue;
  const data = YAML.parse(match[1]);
  const kind = data.kind ?? "news";
  const facts = Array.isArray(data.keyFacts) ? data.keyFacts : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const regions = Array.isArray(data.regions) ? data.regions : [];
  const nextFacts = boxFacts(facts, kind);
  const nextTags = cleanTags(tags, storyText({ ...data, body: match[2] }));
  const nextRegions = groundedRegions(regions, data);
  const changes = [];
  let front = `${match[1]}\n`;
  if (nextFacts.length !== facts.length) {
    const out = facts.filter((f) => !nextFacts.includes(f));
    counts.facts += out.length;
    changes.push(`box −${out.map((f) => `«${f.label}: ${f.value}» (${isDateValue(f.value, f.label) ? "a date" : "not a figure"})`).join("، ")}`);
    front = replaceBlock(front, "keyFacts", nextFacts);
  }
  if (!isDeepStrictEqual(nextTags, tags)) {
    const gone = tags.filter((t) => !nextTags.includes(t));
    const added = nextTags.filter((t) => !tags.includes(t));
    counts.tags += Math.max(0, gone.length - added.length);
    counts.respelled += added.length;
    changes.push(`tags ${tags.join("، ")} → ${nextTags.join("، ") || "none"}`);
    front = replaceBlock(front, "tags", nextTags);
  }
  if (!isDeepStrictEqual(nextRegions, regions)) {
    counts.regions += 1;
    changes.push(`regions ${regions.join("، ") || "none"} → ${nextRegions.join("، ") || "none"}`);
    front = replaceBlock(front, "regions", nextRegions);
  }
  if (!changes.length) continue;
  const reread = YAML.parse(front);
  const same = (d) => ({ ...d, keyFacts: null, tags: null, regions: null });
  if (!isDeepStrictEqual(same(reread), same(data)) || !isDeepStrictEqual(reread.keyFacts ?? [], nextFacts) || !isDeepStrictEqual(reread.tags ?? [], nextTags) || !isDeepStrictEqual(reread.regions ?? [], nextRegions)) {
    counts.refused += 1;
    console.log(`${file}: the rewritten front matter does not read back as expected; left for a person`);
    continue;
  }
  counts.stories += 1;
  console.log(`${file} (${kind}):\n  ${changes.join("\n  ")}`);
  if (!DRY) await writeFile(full, raw.replace(match[1], () => front.replace(/\n$/, "")), "utf8");
}
console.log(`${DRY ? "would change" : "changed"} ${counts.stories} stories: ${counts.facts} box value(s) out, ${counts.tags} tag(s) out, ${counts.respelled} tag(s) respelled, ${counts.regions} region list(s) held to the story${counts.refused ? `; ${counts.refused} left for a person` : ""}`);
