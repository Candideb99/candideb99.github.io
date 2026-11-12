/**
 * The control room's bookkeeping in git (scripts/control-room.mjs): what a publish commits, and what the chat changed
 * and Undo puts back. Kept apart from the server, which starts listening as soon as it is loaded, so that
 * scripts/pipeline-selftest.mjs can run it in a scratch repository.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * What the newsroom writes and the desk publishes by its own buttons: never listed or undone as the chat's change. A
 * story's evidence and its handout photograph are the newsroom's too (newsroom.yml commits them with the story): until
 * 2026-11-10 a draft written here left them listed under «Site changes not live yet», where «Publish to the live site»
 * would have sent an unapproved draft's files and Undo, after a run during a chat, deleted them.
 */
export const NEWSROOM_FILES = /^(?:content\/articles|pipeline\/state|pipeline\/runs|evidence|public\/photos\/handouts)\//;

function git(root, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: root, shell: false, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
  });
}

/** `git status --porcelain` as file → its two-letter code. `all`: every untracked file, not only its new folder. */
export async function gitStatus(root, { all = false } = {}) {
  // git status --porcelain puts a LEADING SPACE on unstaged changes; never trim its output.
  const out = await git(root, ["status", "--porcelain", ...(all ? ["--untracked-files=all"] : [])]);
  const map = new Map();
  const unquote = (p) => p.replace(/^"|"$/g, "").replace(/\\/g, "/");
  for (const line of out.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const [from, to] = line.slice(3).split(" -> ");
    const file = unquote(to ?? from);
    if (file) map.set(file, code);
    // A staged rename has taken its old path away: listed as that path's staged removal, so publishing carries it.
    if (to !== undefined && code[0] === "R") map.set(unquote(from), "D ");
  }
  return map;
}

/**
 * Stage `paths`, then commit them alone. A plain `git commit` took the whole index, so a file staged by hand or by the
 * chat went live with the next story the desk published (a review of 2026-11-01, reproduced in a scratch repository);
 * `git commit -- <paths>` leaves anything else staged as it was. `paths` may carry `git add` flags (`-A`, which stages a
 * removal); the commit is given the paths alone. `status` (gitStatus()): a path whose removal is already staged ("D ",
 * a rename's old path or a `git rm`) is committed without `git add`, which refuses a path in neither the index nor the
 * working tree.
 */
export function commitSteps(paths, message, identity = [], status = new Map()) {
  const add = paths.filter((p) => status.get(p) !== "D ");
  return [
    ...(add.some((p) => !p.startsWith("-")) ? [["git", ["add", ...add]]] : []),
    ["git", [...identity, "commit", "-q", "-m", message, "--", ...paths.filter((p) => !p.startsWith("-"))]],
  ];
}

const bytesOf = (root, file) => readFile(path.join(root, file)).catch(() => null);

/** The working tree as a chat found it: each changed file's code and its bytes (null when absent), the newsroom's left out. */
export async function snapshot(root) {
  const codes = await gitStatus(root, { all: true });
  const bytes = new Map();
  for (const file of codes.keys()) if (!NEWSROOM_FILES.test(file)) bytes.set(file, await bytesOf(root, file));
  return { codes, bytes };
}

/**
 * The files changed since `before`, compared by their bytes. Status codes alone missed a file already changed before
 * the chat and changed again by it (" M" before and after), which Undo then never put back (a review of 2026-11-01).
 * The newsroom's files are left out: a run can write them while the chat works, and the desk never lists them.
 */
export async function changedSince(root, before) {
  const now = await gitStatus(root, { all: true });
  const touched = [];
  for (const file of new Set([...before.codes.keys(), ...now.keys()])) {
    if (NEWSROOM_FILES.test(file)) continue;
    if (!before.codes.has(file)) {
      touched.push(file);
      continue;
    }
    const was = before.bytes.get(file) ?? null;
    const is = await bytesOf(root, file);
    if (was === null ? is !== null : is === null || !was.equals(is)) touched.push(file);
  }
  return touched;
}

/**
 * Puts back what `changedSince()` found: a file that was already changed gets its earlier bytes again (or goes, when it
 * was absent), never HEAD's version, which threw away work done before the chat; a file the chat created goes; any
 * other file returns to HEAD's version, staged and unstaged. Returns how many files were put back.
 */
export async function undoChanges(root, before, touched) {
  const now = await gitStatus(root, { all: true });
  const toHead = [];
  for (const file of touched) {
    const full = path.join(root, file);
    if (before.codes.has(file)) {
      const was = before.bytes.get(file) ?? null;
      if (was === null) await rm(full, { force: true, recursive: true });
      else {
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, was);
      }
    } else if ((now.get(file) ?? "").includes("?")) await rm(full, { force: true, recursive: true });
    else toHead.push(file);
  }
  if (toHead.length) await git(root, ["restore", "--worktree", "--staged", "--", ...toHead]);
  return touched.length;
}
