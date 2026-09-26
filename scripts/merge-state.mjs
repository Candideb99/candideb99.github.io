#!/usr/bin/env node
/**
 * The git merge driver for the newsroom's state files (pipeline/state/*.json, named in .gitattributes). Two writers that
 * changed the same file at the same time (the newsroom and the morning round, or a run by hand while a cloud run was
 * working) both keep their records: the two versions are merged entry by entry against their common ancestor, never
 * line by line. Before it (until 2026-09-26) a clash in a hunk kept one side and silently dropped the other: a
 * fact-check verdict, a correction's record or a learned mistake could vanish. Asked for by the owner that day ("fix
 * that path so concurrent runs cannot silently lose fact-check, correction, or learning records").
 *
 *   git config merge.state-json.driver "node scripts/merge-state.mjs %O %A %B"
 *
 * Git passes the ancestor (%O), the current version (%A: the result is written there) and the other version (%B).
 * Rules, key by key: what only one side changed takes that side; what both sides added is kept from both; what one side
 * removed on purpose (a trim, a revert) stays removed unless the other side changed it; records in lists are matched by
 * their id (or story and time) and merged field by field; a number or a date both sides changed takes the larger; any
 * other value both sides changed takes the other version's (%B), the side a rebase replays. A file that is not JSON is
 * left to git as a conflict (exit 1), so nothing is ever merged blind.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);
const read = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const MISSING = Symbol("missing");
const base = read(basePath, {});
const ours = read(oursPath, MISSING);
const theirs = read(theirsPath, MISSING);
if (ours === MISSING || theirs === MISSING) process.exit(1);

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isDate = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x);

/** A record's identity in a list: its id, else its story and time, else its time, else the whole record. */
function keyOf(x) {
  if (!isObject(x)) return `v:${JSON.stringify(x)}`;
  if (x.id !== undefined) return `id:${x.id}`;
  if (x.slug !== undefined && x.at !== undefined) return `sa:${x.slug}|${x.at}`;
  if (x.at !== undefined) return `at:${x.at}`;
  // The week's numbers keep one record a day (quality.json `days`).
  if (x.date !== undefined) return `date:${x.date}`;
  return `j:${JSON.stringify(x)}`;
}

function scalar(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (isDate(a) && isDate(b)) return a > b ? a : b;
  return b;
}

function merge(o, a, b) {
  if (same(a, b)) return a;
  if (o !== undefined && same(a, o)) return b;
  if (o !== undefined && same(b, o)) return a;
  if (isObject(a) && isObject(b)) return mergeObjects(isObject(o) ? o : {}, a, b);
  if (Array.isArray(a) && Array.isArray(b)) return mergeLists(Array.isArray(o) ? o : [], a, b);
  return scalar(a, b);
}

function mergeObjects(o, a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const inA = Object.hasOwn(a, k);
    const inB = Object.hasOwn(b, k);
    const inO = Object.hasOwn(o, k);
    if (inA && inB) out[k] = merge(inO ? o[k] : undefined, a[k], b[k]);
    else if (inA) {
      // Removed by the other side: stays removed unless this side changed it since.
      if (!inO || !same(a[k], o[k])) out[k] = a[k];
    } else if (!inO || !same(b[k], o[k])) out[k] = b[k];
  }
  return out;
}

function mergeLists(o, a, b) {
  const baseByKey = new Map(o.map((x) => [keyOf(x), x]));
  const aKeys = new Set(a.map(keyOf));
  const bByKey = new Map(b.map((x) => [keyOf(x), x]));
  const out = [];
  for (const x of a) {
    const k = keyOf(x);
    if (bByKey.has(k)) out.push(merge(baseByKey.get(k), x, bByKey.get(k)));
    else if (!baseByKey.has(k) || !same(x, baseByKey.get(k))) out.push(x);
  }
  for (const x of b) {
    const k = keyOf(x);
    if (aKeys.has(k)) continue;
    if (!baseByKey.has(k) || !same(x, baseByKey.get(k))) out.push(x);
  }
  // Records that carry a time are kept in time order, as every writer keeps them.
  if (out.length && out.every((x) => isObject(x) && typeof x.at === "string")) out.sort((p, q) => p.at.localeCompare(q.at));
  return out;
}

writeFileSync(oursPath, `${JSON.stringify(merge(base, ours, theirs), null, 2)}\n`);
process.exit(0);
