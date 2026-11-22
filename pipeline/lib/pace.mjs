/**
 * The news pace: how often a news round starts by day and how many news stories 24 hours may hold. One setting,
 * `pace` in src/data/site.json, saved from the control room (Settings → Publishing), read by the clock
 * (scripts/news-clock.mjs) and by the newsroom's daily cap (pipeline/run.mjs).
 *
 * The owner, 2026-11-22, after the big desks' rates were measured (their economy pages run 11 to 22 stories a day,
 * something new every 20 to 35 minutes; ours 11.7 a day in bursts of two or three with a median wait of six hours):
 * "we should aim for maybe 15 article a day, spread across time", then "cost-optimization is what matters the most",
 * then, told that a story is about $3.50 of spend and a round's own cost $0.75, so that 15 a day is about 40% more news
 * spend and buys nothing while the site is private: "do what is best, but maybe add this as visible alert in the news
 * room so i do not forget". So `standard` is the pace of November, and `launch` is his to switch on when the site
 * opens; the control room reminds him while it is off.
 *
 * `launch`: a round every 2.5 hours by day in place of 4.5, and a cap of 15 so the faster clock stops there. Simulated
 * with the clock's own decide() over 21 days of GitHub's late firings (delays of 4, 9 and 12 hours; the session's
 * pacesim.mjs): standard 4.2 news rounds a day with a longest daytime wait of 5.8 hours (4.1 measured in November);
 * a gap of 3 hours gave 5.5 rounds, 2.5 hours 6.3 rounds with a longest wait of 3.7 hours, 2 hours 7.2. A round writes
 * 2.6 stories on average, so 2.5 hours reaches the 15 and the cap holds it there. The timed pieces (explainer, analysis, reading, idea, the
 * week's review) keep their own times and are not counted. No imports beyond Node's own, so the clock's job, which
 * installs nothing, can read it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const PACES = {
  standard: { gapDay: 4.5, dailyCap: 20, about: 11 },
  launch: { gapDay: 2.5, dailyCap: 15, about: 15 },
};

/** The pace a site's settings name; anything else is the standard one. */
export const paceName = (site) => (Object.hasOwn(PACES, site?.pace) ? site.pace : "standard");

export const paceOf = (site) => PACES[paceName(site)];

/** The pace saved in this checkout's src/data/site.json; the standard one when the file cannot be read. */
export function readPace(root = process.cwd()) {
  try {
    return paceOf(JSON.parse(readFileSync(path.join(root, "src", "data", "site.json"), "utf8")));
  } catch {
    return PACES.standard;
  }
}
