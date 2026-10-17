#!/usr/bin/env node
/** Opt-in live calibration, not a publisher or a claim that the writer has improved. */
import "../pipeline/lib/env.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { critique } from "../pipeline/lib/verify.mjs";
import { getActiveModel, getActiveProvider, usage } from "../pipeline/lib/llm.mjs";
import { editorialCases } from "./fixtures/editorial-cases.mjs";

const args = process.argv.slice(2);
const selected = args.find((a) => a.startsWith("--case="))?.slice(7);
const ids = selected?.split(",");
const unknown = ids?.filter((id) => !editorialCases.some((c) => c.id === id));
if (unknown?.length) throw new Error(`Unknown editorial case: ${unknown.join(", ")}`);
const cases = ids ? editorialCases.filter((c) => ids.includes(c.id)) : editorialCases;
if (!args.includes("--live")) {
  console.log("No model calls. Add --live to run the configured critic; this uses its normal allowance.");
  for (const c of cases) console.log(`${c.id}: ${c.expected}${c.area ? ` (${c.area})` : ""}`);
} else {
  const inputs = Object.fromEntries(["../pipeline/lib/editorial.mjs", "../pipeline/lib/verify.mjs", "./fixtures/editorial-cases.mjs"].map((file) => [file, createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex")]));
  const report = { at: new Date().toISOString(), provider: getActiveProvider(), model: getActiveModel(), inputs, complete: false, results: [], usage: null };
  const output = path.join(os.tmpdir(), `khazendar-editorial-eval-${Date.now()}.json`);
  try {
    for (const c of cases) {
      // Expectations, case ID and diagnosis are deliberately not supplied to the model.
      const result = await critique({ draft: c.draft, sources: c.sources, log: (message) => console.log(message) });
      const pass = c.expected === "publish"
        ? result.verdict === "publish" && result.issues.length === 0
        : result.verdict !== "publish" && (!c.area || result.readerCheck?.[c.area]?.status === "revise");
      report.results.push({ id: c.id, expected: c.expected, area: c.area, diagnosis: c.diagnosis, pass, result });
      console.log(`${pass ? "PASS" : "REVIEW"} ${c.id}: ${result.verdict}, score ${result.score}`);
      writeFileSync(output, JSON.stringify(report, null, 2));
    }
    report.complete = true;
    if (report.results.some((r) => !r.pass)) process.exitCode = 1;
  } catch (error) {
    // Do not run every case into the same exhausted quota, or use a different paid provider.
    report.error = String(error.message).split("\n")[0];
    console.log(`INCOMPLETE: ${report.error}`);
    process.exitCode = 2;
  } finally {
    report.usage = usage;
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`Report: ${output}`);
    console.log("This checks the critic on curated cases. Read unexpected verdicts; it is not a measure of overall prose quality.");
  }
}
