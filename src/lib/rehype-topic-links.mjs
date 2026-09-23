/**
 * rehype plugin: link the first mention of a story's own tags in its text to the tag's file page
 * (/tags/{tag}/), as Al Jazeera, the BBC and Asharq Al-Awsat link the people, places and topics in their
 * copy (2026-09-23, from a comparison of their article pages). A reader who meets «مضيق هرمز» in a story
 * can follow the whole file from there.
 *
 * Only a tag that has at least one other story is linked (a page holding just this story is a dead
 * end), each at its first mention in a paragraph, at most four links a story; never inside a link, a
 * heading, a quotation mark pair or a figure. Arabic joins و، ف، ب، ك، ل to a word, so the tag is found
 * behind them and the letter stays outside the link («وأوبك» links «أوبك»). The story's tags come from its
 * frontmatter, which Astro hands to the plugin.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MAX_LINKS = 4;
const SKIP = new Set(["a", "h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "bdi", "script", "style", "svg", "blockquote", "figcaption", "table"]);

let counts = null;
/** How many published stories carry each tag (read once per build from content/articles). */
function tagCounts() {
  if (counts) return counts;
  counts = new Map();
  const dir = path.join(process.cwd(), "content", "articles");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return counts;
  }
  for (const f of files) {
    const raw = readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const front = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!front) continue;
    let data;
    try {
      data = YAML.parse(front[1]);
    } catch {
      continue;
    }
    if (data?.draft) continue;
    for (const tag of new Set((data?.tags ?? []).map((t) => String(t).trim()).filter(Boolean))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The tag as a whole word behind the letters Arabic joins to it; group 1 is the joined letters, group 2 the tag. */
const tagPattern = (tag) => new RegExp(`(?<![\\p{L}\\p{M}])((?:[وف])?(?:[بكل])?)(${escape(tag)})(?![\\p{L}\\p{M}])`, "u");

export default function rehypeTopicLinks() {
  return (tree, file) => {
    const front = file?.data?.astro?.frontmatter ?? {};
    const all = tagCounts();
    const tags = [...new Set((front.tags ?? []).map((t) => String(t).trim()))]
      .filter((t) => t.length >= 3 && (all.get(t) ?? 0) >= 2)
      // Longer tags first, so «النفط الخام» is linked before «النفط» can claim the same words.
      .sort((a, b) => b.length - a.length);
    if (!tags.length) return;
    const pending = new Map(tags.map((t) => [t, tagPattern(t)]));
    let linked = 0;

    function visit(node, inParagraph) {
      if (!node.children || linked >= MAX_LINKS) return;
      const next = [];
      for (const child of node.children) {
        if (linked >= MAX_LINKS || child.type !== "text" || !inParagraph || !pending.size) {
          if (child.type === "element" && !SKIP.has(child.tagName)) visit(child, inParagraph || child.tagName === "p");
          next.push(child);
          continue;
        }
        let text = child.value;
        const out = [];
        // Link at most one tag per text run per pass; loop while the run still holds an unlinked tag.
        for (;;) {
          let best = null;
          for (const [tag, re] of pending) {
            const m = re.exec(text);
            if (m && (!best || m.index < best.m.index)) best = { tag, m };
          }
          // «» marks a name or a quotation: a tag inside one is left as written.
          if (!best || /«[^»]*$/.test(text.slice(0, best.m.index)) || linked >= MAX_LINKS) break;
          const { tag, m } = best;
          const start = m.index + m[1].length;
          out.push({ type: "text", value: text.slice(0, start) });
          out.push({ type: "element", tagName: "a", properties: { href: `/tags/${encodeURIComponent(tag)}/`, className: ["topic-link"] }, children: [{ type: "text", value: m[2] }] });
          text = text.slice(start + m[2].length);
          pending.delete(tag);
          linked += 1;
        }
        if (!out.length) {
          next.push(child);
          continue;
        }
        if (text) out.push({ type: "text", value: text });
        next.push(...out);
      }
      node.children = next;
    }
    visit(tree, false);
  };
}
