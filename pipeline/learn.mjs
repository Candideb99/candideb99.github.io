#!/usr/bin/env node
/**
 * One learning step for the newsroom (pipeline/lib/lessons.mjs): the mistakes the second look proved and the
 * corrections editor corrected since the last step become lessons the desk notes and the writer read before every
 * story. Runs at the start of every news round, after that round's second look; no new proved mistake, no call.
 *
 *   node pipeline/learn.mjs              learn from what is new, and save
 *   node pipeline/learn.mjs --dry-run    print what would change, save nothing
 *   node pipeline/learn.mjs --print      print the lessons as the writer reads them
 *   node pipeline/learn.mjs --revert     put back the kept version now, by hand (an emergency needs no statistics; a
 *                                        second review of the design, 2026-09-25); no call
 */
import "./lib/env.mjs";
import { appendFile } from "node:fs/promises";
import { activeLessons, learn, lessonsBlock, loadLessons, revert, saveLessons } from "./lib/lessons.mjs";

const args = process.argv.slice(2);
const log = (m) => console.log(`[learn] ${m}`);

if (args.includes("--revert")) {
  const state = await loadLessons();
  if (state.damaged) {
    log(`${state.damaged} cannot be read; nothing is put back until a person has looked at it`);
    process.exit(1);
  }
  const from = state.version;
  revert(state);
  state.tests = [...(state.tests ?? []), { at: new Date().toISOString(), live: from, kept: state.kept?.version ?? 0, decision: "revert", reason: "put back by hand" }].slice(-104);
  await saveLessons(state);
  log(`put back the kept version (${state.kept ? `v${state.kept.version}` : "no lessons"}); ${activeLessons(state).length} lessons active now (version ${state.version})`);
  process.exit(0);
}

if (args.includes("--print")) {
  const state = await loadLessons();
  console.log(lessonsBlock(state) || "(no lessons yet)");
  process.exit(0);
}

try {
  const { state, applied, calls } = await learn({ log, dryRun: args.includes("--dry-run") });
  const active = activeLessons(state);
  const md = `## خازندار lessons (version ${state.version}, ${active.length} active)\n\n${applied.length ? `This round: ${applied.join("; ")}.` : "Nothing new to learn this round."} Claude calls: ${calls}.\n\n${active.map((l) => `- **${l.id}** [${l.class}], seen ${l.seen}: ${l.rule}`).join("\n")}\n`;
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
} catch (error) {
  // Learning never stops a news round: the writer goes on with the lessons it already has.
  log(`failed: ${String(error.message).split("\n")[0]}; the newsroom writes with the lessons it has`);
}
