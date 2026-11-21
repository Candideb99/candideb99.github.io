/**
 * Which files the files index (/tags/) names, and in what order (2026-11-21, the owner: "is this part redundant? is it
 * useful? what would happen after one year of running the website if this part still exists?").
 *
 * The index had named every file of two stories or more: the nine largest as cells, then the rest «أبجدياً». At 704
 * stories that was 244 names, half of them files of two, and it grew by about 0.4 a story: a year of the newsroom's pace
 * would have made it some 1,500-2,000 names, a wall of 14,000px on a laptop and 75,000px on a phone, most of them on
 * stories nothing had been added to for months. The cells were ranked by size with at most three points for freshness,
 * so «مضيق هرمز» and «الاحتياطي الفيدرالي» would have led for the year. And the list was cut at 400 by its caller
 * without a word, about a month away. A reader reaches a file from a story's chip, its label, the links in its text
 * and the search; the index is for what is running now.
 *
 * Now the index names a bounded set however large the archive grows: the files most written about in the last two weeks
 * (as cells, then a list), and the largest of the rest. "Now" is the newest story on the site, not the hour of the build,
 * so a pause in the newsroom leaves the index on the stories it was last following rather than empty. Plain JavaScript,
 * so the self-test reads it.
 */

/** The window a file must have been written about in to count as running. */
export const RUNNING_DAYS = 14;
/** A file named in the list after the cells has at least this many stories in the window: one event told twice is not
 * a running story («جنسن هوانغ», two stories of one Nvidia evening). Measured over the archive at four dates from
 * 2 to 21 November: 19 to 39 files. */
export const RUNNING_MIN = 3;
/** The cells. */
export const LEAD_FILES = 9;
/** The list after the cells, at most, the most written about first. */
export const RUNNING_MAX = 36;
/** The largest files not named above. */
export const LARGEST = 12;
/** The most file names the index can print. */
export const INDEX_MAX = LEAD_FILES + RUNNING_MAX + LARGEST;

const DAY = 86_400_000;

/**
 * `files`: every file with a page, as `{ tag, times }` (each story's publication time in milliseconds); `now`: the newest
 * story on the site. Returns `{ lead, running, largest }`, each a list of `{ tag, size, recent, latest }`, no file twice:
 * `lead` the files most written about in the window (the count in it, then the newest), `running` the next ones with
 * `RUNNING_MIN` stories in it, alphabetical, and `largest` the largest of the others, largest first.
 * @typedef {{ tag: string, size: number, recent: number, latest: number }} IndexedFile
 * @param {{ tag: string, times: number[] }[]} files
 * @param {number} now
 * @returns {{ lead: IndexedFile[], running: IndexedFile[], largest: IndexedFile[] }}
 */
export function filesIndex(files, now) {
  const all = files.map(({ tag, times }) => ({
    tag,
    size: times.length,
    recent: times.filter((t) => t <= now && now - t <= RUNNING_DAYS * DAY).length,
    latest: Math.max(...times),
  }));
  const active = all.filter((f) => f.recent > 0).sort((a, b) => b.recent - a.recent || b.latest - a.latest || a.tag.localeCompare(b.tag, "ar"));
  const lead = active.slice(0, LEAD_FILES);
  const running = active
    .slice(LEAD_FILES)
    .filter((f) => f.recent >= RUNNING_MIN)
    .slice(0, RUNNING_MAX)
    .sort((a, b) => a.tag.localeCompare(b.tag, "ar"));
  const shown = new Set([...lead, ...running].map((f) => f.tag));
  const largest = all
    .filter((f) => !shown.has(f.tag))
    .sort((a, b) => b.size - a.size || b.latest - a.latest || a.tag.localeCompare(b.tag, "ar"))
    .slice(0, LARGEST);
  return { lead, running, largest };
}
