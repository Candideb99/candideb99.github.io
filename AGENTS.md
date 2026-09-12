# AGENTS.md — read this before touching anything

This project's rules and its owner's decisions are in `CLAUDE.md` (the rules), `PRODUCT.md`
(what the paper promises), `DESIGN.md` (the visual system) and `STYLE.md` (how the Arabic is
written and how the pages are organised, from the practice of the Arabic economics desks). Read all
four first. They bind every agent, Codex included.

## Decisions the owner made in person. Do not reverse them.

- **The cover rotates.** The owner saw the carousel research (fifteen of sixteen major sites use a
  still lead; NN/g and Baymard data) and chose rotation anyway, twice. It turns every six seconds,
  the dots sit inside the photograph, the pointer is the pause, and it turns even for readers with
  reduced motion (the fade alone is dropped). Do not make it static.
- **The news bar moves.** The owner asked for a moving strip. It scrolls by whole pixels so the
  text stays sharp, carries the newest stories not already on the first screen (so no headline
  prints twice above the fold), and holds under the pointer. Do not make it static or chronological.
- **The publication gate** is: programmatic checks, the Arabic copy desk, the critic; one revision
  round; a second critic pass; publish when the verdict is not "reject" and the score is 6 or more.
  With the free models the critic returns "revise" with a list on nearly every first pass; a gate
  that demands a "publish" verdict with zero issues publishes nothing, which defeats the owner's
  purpose (a fully automated paper). Raising the bar is the owner's call, not an agent's.
- **Published articles are not retroactively "held".** A story that passed the gate of its day
  stays published. Retiring a story is an editorial act taken one story at a time with a reason
  (duplicates and stitched roundups were retired that way on 2026-09-12).
- **Explainers** are written from standard definitions with illustrative numbers labelled as such;
  they carry no external sources by design. **Analyses** draw on the paper's own recent stories.
  **Paper readings** cite the open-access paper. Do not require external sources for explainers.
- **The daily budget** is at most four stories a run and ten a day; the editor scores candidates on
  the news values in STYLE.md §2; one story is one event.
- **No literal translations, ever.** The copy desk and the banned list in `pipeline/lib/style.mjs`
  enforce it; fix the rule, never the article by hand.
- **The calendar** (`/calendar/`, the front's الأجندة module) is read from the institutions' own
  schedule pages by `pipeline/calendar.mjs`; never add a date from memory. The weekly review
  (`--mode=weekly`, Fridays) is written only from the paper's own stories and that calendar.
- **The market data** (strip, box beside the cover, glance band on الأسواق, the board at /markets/data/) comes only from
  `pipeline/markets.mjs`; the JSON is generated, never edited. Quotes are delayed and say so. Do not
  add a paid or keyed data source without the owner's yes.

## What you may do without asking

Run the pipeline in dry-run mode, fix a broken run, tighten a check that is demonstrably letting a
false fact through (show the case), improve the Arabic rules, add tests. Keep `npm run check` and
`npm run build` at zero errors.

## What needs the owner's explicit yes

Changing the publication threshold, holding or unpublishing groups of articles, removing motion
the owner asked for, adding readership counts or opinion columns (there are no readership data and
no outside authors; the paper's own voice is قراءات خازندار), pushing to the live repository.

## How the site publishes

`git push pages rebuild:main` from this machine; GitHub Pages builds `main`. Never force-push. Never
commit `.env` or any key. Scratch files go in the system temp folder, not the project.
