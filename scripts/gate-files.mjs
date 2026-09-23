/**
 * The files the site's gate covers, and their fingerprints. Shared by the gate (scripts/gate.mjs), which
 * records them when every check passes, and the Stop hook (scripts/gate-hook.mjs), which compares them.
 *
 * Covered: the site's code (src/, except the data files the pipeline regenerates on every refresh), its
 * build configuration, and the newsroom's and tools' code (pipeline/**, scripts/** .mjs). Not covered:
 * articles, run logs and state, which the newsroom writes all day and the cloud build validates.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const GENERATED = new Set(["src/data/markets.json", "src/data/calendar.json"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".cache", "state", "runs", "fonts"]);

function walk(root, dir, keep, out) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return;
  for (const name of readdirSync(full)) {
    const rel = `${dir}/${name}`;
    const stat = statSync(path.join(root, rel));
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(root, rel, keep, out);
    } else if (keep(rel) && !GENERATED.has(rel)) {
      out.push(rel);
    }
  }
}

/** Project-relative paths (forward slashes) of every file the gate covers. */
export function gateFiles(root) {
  const out = [];
  walk(root, "src", () => true, out);
  walk(root, "pipeline", (f) => f.endsWith(".mjs"), out);
  walk(root, "scripts", (f) => f.endsWith(".mjs"), out);
  for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) if (existsSync(path.join(root, f))) out.push(f);
  return out.sort();
}

/** { path: short content hash } for every covered file. */
export function fingerprints(root) {
  const out = {};
  for (const f of gateFiles(root)) out[f] = createHash("sha1").update(readFileSync(path.join(root, f))).digest("hex").slice(0, 16);
  return out;
}
