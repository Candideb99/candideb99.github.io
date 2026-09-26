# خازندار: how it runs on its own

The operational handoff of 26 September 2026. Everything below runs as GitHub Actions in the cloud: none of it needs
this chat, the control room or your laptop to be open. Times are UTC.

## The jobs and when they run

| job | when | what it does |
|---|---|---|
| Newsroom: news | every 3 hours at :23 | 1. Second look: reads the earlier rounds' stories against their sources (the saved evidence when a page has changed or gone), corrects what the sources prove, and reads every correction once more. 2. Learns lessons from proved mistakes. 3. Picks up to 4 stories, writes them, runs the critic. 4. Checks each final text against its sources before publication: an error is repaired and the text checked again (3 tries at most); a story still wrong is held and retried later. 5. Saves each published story's source evidence. 6. Commits and deploys. |
| Newsroom: explainer | daily 05:41 | One explainer, same checks. |
| Newsroom: analysis | daily 14:07 | One analysis. |
| Newsroom: research-paper reading | Tue and Fri 09:31 | One reading of an open-access paper. |
| Newsroom: week's review | Fri 15:37 | حصاد الأسبوع. |
| Newsroom: defence analysis | Sat 10:07 | The defence and geopolitics reading. |
| Newsroom: في العمق | Sun 07:47 | The in-depth piece. |
| Newsroom: lessons test | Mon 06:13 | Tests the fact-checker on planted errors, then keeps, approves or reverts the live lessons by the rule in `pipeline/lib/evidence.mjs`. |
| Editor: morning round | daily 07:17 | Free checks: failed runs, type check and build, the reader's view of the built site, the same event filed twice, stale quotes or calendar, missing or lost photos, the live site. Claude is called only for what it finds, and publishes its fixes only through the gate. |
| Deploy | every push to main, and every 2 hours at :19 | Refreshes market quotes, builds the site and publishes the GitHub Pages mirror. The live site, khazendar.pages.dev, is built by Cloudflare Pages from every push to GitHub. |

Newsroom runs never overlap: the workflow's concurrency group queues them. Anything else that saves the same state
files at the same moment (the morning round, or a run by hand) is merged entry by entry, so no record is lost.

## What happens when something fails, without you

| failure | what happens by itself | when it reaches you |
|---|---|---|
| A story fails the check before publication | Repaired and checked again, up to 3 times; if still wrong, held (not published) and retried after 12 hours, once more, then dropped after three weeks. The rest of the round goes on. | Never; it is listed on the Desk as held. |
| The fact-check cannot run (a Claude error) | The story is held, not published unchecked, and retried later. A second-look check that fails is tried twice. | Never. |
| A correction is refused or fails | Tried once more 12 hours later, with a fresh reading. | One issue listing published stories that still carry a proved error, opened once. |
| A correction leaves the error standing | Recorded; never corrected again by another guess. A new error the re-reading finds elsewhere is corrected once. | The same single issue. |
| A source page changes or disappears | The second look and the corrections editor read the copy saved at publication. | Never. |
| A newsroom run fails, or the built site has a fault | The morning round wakes the daily editor, at most once in 3 days per fault. Its fixes to the pipeline, the scripts and the site's code (`src/`) publish themselves once the gate passes. | If the fault is still there after 2 of the editor's tries: one issue, then no more wake-ups for it. |
| Claude refuses the token, or the live site stops updating | Nothing can mend these without you. | One issue each, with what to do. |

An issue is never opened twice while it is open. Close it when mended.

## What still needs you

- The issues above.
- The editor's pull requests for anything outside `pipeline/`, `scripts/` and `src/`: articles, `public/`, the docs. A workflow change is never published by the editor.
- Your own decisions: new sections, design changes, launch (`site.json` `private`), spending, credentials.
- To stop everything: "Pause everything" in the control room. It sets `KHAZENDAR_PAUSED=1`, and nothing is written or published until it is cleared.

## Where to look

| what | where |
|---|---|
| This week at a glance: fixed and verified, flagged and not fixed | the Desk's "Daily checks" line; `pipeline/state/quality.json` |
| Stories checked before publication, repaired, held | `pipeline/state/precheck.json` |
| Every story the second look read: each sentence's verdict with the source sentence, corrections, re-readings | `pipeline/state/factcheck.json` |
| Corrections readers see | at the foot of each story (تصحيح, dated) |
| The evidence each story rests on, as its sources read at publication | `evidence/<slug>.json.gz`, committed with the story (the passages it relied on and each sentence's verdict with its source quote, never whole pages: this repository is public) |
| Each run's outcome and log | `pipeline/runs/`; the Actions page of each run |
| The morning round: findings, the editor's tries, escalations | `pipeline/state/health.json`; the repository's issues |
| The lessons, their versions, the weekly decisions | `pipeline/state/lessons.json`, `pipeline/state/pairs.json` |
| Every change ever made | the git history of `main` |

## The lessons: tracing and rollback

- Every story names the lessons version it was written with (`models.lessons`, for example `v11`; `control` for a story written without them). Every comparison pair records the exact text the writer read (`lessonsHash`).
- The weekly test (Mondays) keeps, approves or reverts the live version, by a rule fixed in advance and tested in the gate.
- Rollback at any time, by hand: `node pipeline/learn.mjs --revert` puts back the last approved version. Until a version has been approved, that means no lessons at all. Tested on a copy on 26 September: the text after rollback matched the approved one exactly.
- Every version is also in git.

## Evidence that this version is deployed

See the end of this file (filled in from the cloud run that verified it).

## Limitations: what is not done, or not proven

- **The lessons are live but not shown to help.** In the stress test: 4 proved errors with them and 5 without, across 36 stories. The weekly evidence has 2 tied pairs so far. At Claude's error rate, about 1 provable error in 10 stories, proving a benefit would take months.
- **The check before publication is proven only on planted errors.** On real stories it has passed everything so far (11 by 26 September), and the three of those the second look audited were also clean. How many real errors it catches will show in the weekly numbers over time.
- **Evidence has gaps.** What is kept is the passages a story rests on, not whole pages, because the repository is public. A page unreadable when the evidence is taken (a 403, a robots refusal) has none. Stories published before 26 September have only the passages carrying their figures, taken that day, not at publication.
- **Not built:**
  - measuring which important news the collector misses;
  - finding which part of the pipeline caused each failure;
  - comparison drafts for every story;
  - frozen, pre-approved lesson versions (which would conflict with your choice of live learning).
- **Two writers editing the same article at the same moment** could still clash in git. Only the state files merge entry by entry. No current job edits an article another job is editing.
