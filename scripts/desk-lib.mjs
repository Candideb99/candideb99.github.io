/**
 * What the control room reads off a job's log, says about the site's health and saves as the site's settings
 * (scripts/control-room.mjs), kept apart from the server, which starts listening as soon as it is loaded, so that
 * scripts/pipeline-selftest.mjs can run it.
 */
import { spawn } from "node:child_process";

/**
 * Runs a program with its arguments as an array and no shell, and answers whether it succeeded with what it printed:
 * { ok, out }. A program's words are not its verdict. Signed out, gh prints «To get started with GitHub CLI, please
 * run: gh auth login», which holds none of the words the desk looked for («error», «not logged», «could not»), so the
 * desk said «gh is signed in», read its own defaults as the cloud's state and answered «Paused» to a pause that never
 * reached GitHub (2026-11-10). The exit code says it plainly; a program that cannot start has failed too.
 */
export function runProgram(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) => resolve({ ok: false, out: `error: ${error.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, out: out.trim() }));
  });
}

/** A log line without the newsroom's clock («[17:14:06] »). */
const bare = (line) => String(line).replace(/^\[\d\d:\d\d:\d\d\] /, "");
/** The newsroom's lines that mean something to an editor, not to a programmer (pipeline/run.mjs log()). */
const EDITORS_LINES = /^(?:drafted|published|refreshed|reject|skip|held|story failed|deferred|desk |critic|editor|research editor|candidates|precheck|mended|short story|image:|report |section balance|region balance|run budget|daily budget|llm fail|sync:|—)/i;

/**
 * The last lines of a job's log worth showing while it runs. Until 2026-11-10 the words were looked for at the start
 * of the line, where every newsroom line carries its clock, so none ever matched: the box showed only lines that
 * happened to hold a quotation mark, and «starting…» through the minutes a run spends reading its feeds and choosing.
 * A job that prints none of these (the sync, a build) shows its last two lines instead.
 */
export function progressLines(log) {
  const lines = log.filter((l) => l && !/^\$ /.test(l));
  const meaningful = lines.filter((l) => EDITORS_LINES.test(bare(l)));
  return (meaningful.length ? meaningful.slice(-4) : lines.slice(-2)).map((l) => l.slice(0, 180));
}

/** «2 of 4 written · 1 refused», counted from the run's own log lines, so it is never a guess. */
export function jobProgress(log) {
  const written = log.filter((l) => /\] (drafted|published) "/.test(l)).length;
  // Refused, held by the check before publication, failed, or left for the next run: each a story not written (until
  // 2026-10-31 only "reject" and "skip" lines were counted, and the second-pass critic printed none).
  const refused = log.filter((l) => /\] (?:reject|skip|held|story failed) /.test(l) || /\] run budget of .* waits for the next run/.test(l)).length;
  // The run's own command line, not the job's first: since every job opens with the sync (2026-10-31) the first line
  // is the pull, and "1 of 4 written" had become "1 written".
  const m = log.find((l) => /^\$ .*--limit=\d+/.test(l))?.match(/--limit=(\d+)/);
  return { written, refused, target: m ? Number(m[1]) : null };
}

/**
 * The rail's light. `site`: whether the live site (site.json's url, built by Cloudflare Pages from every push) carries
 * the newest story this copy knows the cloud holds: { ok: true | false | null }. `mirror`: the last finished run of
 * deploy.yml, which publishes the GitHub Pages mirror: { ok, stage: "build" | "publish" | undefined, url }.
 *
 * Until 2026-11-10 the light read the mirror's run alone. On that evening GitHub's own publish step stalled («syncing_files»,
 * then "Timeout reached") after a clean build, and the desk said THE SITE IS NOT UPDATING while the live site carried
 * the newest story: the alarm was about a copy no reader is sent to. Now the live site decides, and the mirror is
 * named for what it is.
 */
export function siteLight({ site = null, mirror = null } = {}) {
  const mirrorFailed = Boolean(mirror) && mirror.ok === false;
  const url = mirrorFailed ? mirror.url : undefined;
  // Only GitHub's own publish step, after a clean build, is the mirror's affair alone. A build that failed is the
  // site's: the live site's host builds the same pages, so it stays an alarm even while the newest story this copy
  // knows of is live (a later commit may be the one that broke it; an independent review, 2026-11-11).
  const stalled = mirrorFailed && mirror.stage === "publish";
  const stalledNote = "Its GitHub mirror's last publish failed on GitHub's side; the next deploy tries again.";
  if (site?.ok === false) return { level: "no", alarm: true, text: `THE LIVE SITE IS NOT UPDATING: it does not carry the newest story yet${mirrorFailed ? ", and the last deploy failed" : ""}.`, url };
  if (mirrorFailed && !stalled) return { level: "no", alarm: true, text: `${mirror.stage === "build" ? "THE SITE'S BUILD IS FAILING" : "THE SITE'S LAST DEPLOY FAILED"}${site?.ok === true ? ": the newest story this laptop knows of is live, but a newer one may not be" : ""}.`, url };
  if (site?.ok === true) return stalled ? { level: "warn", text: `The live site is up to date. ${stalledNote}`, url } : { level: "ok", text: "The live site is up to date" };
  // Nothing to ask the live site for (`site` null: every story here is minutes old, or none is in the remote's branch),
  // or it gave no answer (`ok` null).
  const unasked = site ? "The live site did not answer this laptop." : "";
  if (!mirror) return { level: "unknown", text: site ? "Could not check the site: neither it nor GitHub answered this laptop." : "Could not check the site: GitHub did not answer this laptop." };
  if (stalled) return { level: "warn", text: `${unasked} ${stalledNote}`.trim().replace(/^Its GitHub/, "The GitHub"), url };
  return { level: "ok", text: `Last deploy OK${site ? " (the live site itself did not answer this laptop)" : ""}` };
}

const FORMS = {
  adsenseClient: [/^(?:ca-)?pub-\d{10,20}$/, "AdSense ID (ca-pub- and digits)"],
  googleSiteVerification: [/^[A-Za-z0-9_-]{10,100}$/, "Google verification code"],
  contactEmail: [/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/, "contact email"],
};

/**
 * The site's settings with the form's values put in: { next, changed } or { error }. The AdSense ID decides who is paid
 * for the paper's ads and the verification code whom Google takes for its owner; both go live at once, so a value in
 * neither form is refused (a pasted meta tag gives up its code). `changed` false: nothing to publish. Until 2026-11-10
 * a save that changed nothing answered «Saved and publishing» and then failed, since there was nothing to commit.
 */
export function applySettings(current, patch = {}) {
  const given = { ...patch };
  if (typeof given.googleSiteVerification === "string") given.googleSiteVerification = (given.googleSiteVerification.match(/content=["']([^"']+)["']/) ?? [])[1] ?? given.googleSiteVerification;
  for (const [key, [form, label]] of Object.entries(FORMS)) {
    if (typeof given[key] === "string" && given[key].trim() && !form.test(given[key].trim())) return { error: `That ${label} does not look right, so nothing was saved.` };
  }
  const next = { ...current };
  for (const key of ["contactEmail", "publisher", "adsenseClient", "googleSiteVerification"]) if (typeof given[key] === "string") next[key] = given[key].trim();
  if (typeof given.private === "boolean") next.private = given.private;
  return { next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}
