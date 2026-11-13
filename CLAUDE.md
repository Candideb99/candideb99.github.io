# خازندار — notes for agents

Arabic-first (RTL) economics publication written by an automated newsroom. Read `README.md` first, then `PRODUCT.md` (product truth), `DESIGN.md` (visual system) and `STYLE.md` (how the Arabic is written and how the pages are organised, from the practice of the Arabic economics desks).

## How these notes are organised

This file holds only what every session needs. The dated notes (what the owner said, what was measured, what each rule in the code is for, what was tried and left) are in `.claude/rules/`, one file per area. Claude Code loads a note by itself when you Read, Write or Edit a file it covers; a search (Grep, Glob) loads nothing.

- Before you change or judge code, open the file with Read so its notes load. Before you answer a question about an area without opening its code, read that area's note first.
- A new learning goes into its area's note as a dated entry (the owner's words, the rule, where it lives in the code, how it was tested), in the same turn, never into this file. Keep an entry to what the code and the commit cannot say.
- A note stays under 38,000 characters (Claude Code cuts a longer one); when one fills, start the next numbered file with the same `paths`. This file stays under 150 lines. `@` imports save nothing: they load with this file.

| Note in `.claude/rules/` | Loads with | Holds |
|---|---|---|
| `writing-news-1.md`, `writing-news-2.md` | the writer, desk, critic, style and editor modules, `run.mjs`, STYLE.md | news depth, short stories, headlines, the spine, machine habits, construction, joined prose |
| `writing-hub-pieces.md` | the same modules, `lesson.mjs`, the lesson components | explainers, analyses, paper readings, the weekly, «في العمق» (stopped) |
| `labels-and-corrections.md` | `keyfacts`, `tags`, `regions`, `tidy`, `correct`, `rechart`, the topic files | the «الأرقام» box, tags, regions, one page per subject, corrections, chart forms |
| `pictures-1-foundations.md`, `pictures-2-people-brands.md`, `pictures-3-november.md` | `images`, `commons`, `photolibs`, the picture scripts, `Photo.astro` | the cascade, every picture rule and the owner's ruling behind it, what the free libraries lack |
| `sources-and-coverage.md` | `sources.json`, `reports.json`, `feeds`, `extract`, `reports`, `select` | which outlets and why, ownership labels, the reports desk, politics that moves money, world coverage |
| `market-data.md` | `markets.mjs`, `calendar.mjs`, `quotes`, `context`, the market components | the board's moves, the price line a story gets, the calendar |
| `fact-check.md` | `factcheck`, `precheck`, `snapshots`, `recheck` | the check before publication, the saved evidence, recovery without a person |
| `loops-and-lessons.md` | `lessons`, `paired`, `evidence`, `health`, the morning round | the second look, the lessons and how they are proved, the stress test |
| `site.md` | everything in `src/`, DESIGN.md, the site checks | type scale, front page, masthead, menus, sections, the site's own bugs |
| `models-and-usage.md` | `llm.mjs`, the provider modules | providers, effort levels and their tests, the Claude CLI, what the plan costs |
| `operations.md` | the control room, the gate, sync, the workflows | the gate, deploys, schedules, the control room, security |
| `audits-1-october.md`, `audits-2-31-october.md`, `audits-3-november.md` | any script in `pipeline/` or `scripts/` | what each audit fixed across desks, and what it looked at and left |

## Where things live

- The site is static Astro in `src/`; articles are Markdown in `content/articles/` written only by `pipeline/run.mjs`. Never hand-write news articles; run the pipeline.
- Editorial rules live in `pipeline/lib/write.mjs` (house style), `pipeline/lib/select.mjs` (news judgement), `pipeline/lib/verify.mjs` (what blocks publication) and `pipeline/lib/copydesk.mjs` (the Arabic copy desk: every draft's headline, dek, lede, «لماذا يهمّ» and body are rewritten out of translationese before the critic, under a guard that counts figures, counts in letters, duals, «» names and Latin tokens over the whole story and matches every hedged claim to its rewrite: a fact may leave a place where it repeats, never the story, and a hedge never becomes an assertion). Since the 2026-09-23 audit of the paper, `pipeline/lib/style.mjs` also checks structure, not only words: a source named in sentence after sentence, a fact retold in dek, lede and first paragraph, stock joints («ويأتي… في وقت»، «، إذ ذكر»), English sentence shapes («ما إذا كان»، «كـ» + noun), idioms translated word for word, the box's formulas, machine leftovers. Change behaviour there, not by editing generated articles; when the owner points at a bad sentence, fix the rule and re-run `node pipeline/copydesk.mjs` over the published articles. The owner's standing rule: no literal translations, ever.
- `pipeline/run.mjs` is the newsroom (modes news, analysis, explainer, paper, weekly, reports, recheck, rewrite); `pipeline/lib/` holds its desks: `select` (the editor), `write` (desk notes and writers), `copydesk`, `verify` (critic and code checks), `style` (house checks), `factcheck` and `precheck` (the check before publication), `images` (the picture desk), `feeds`, `extract`, `reports`, `context` and `quotes` (material), `llm` (the model call).
- `scripts/` holds the control room (`control-room.mjs`, opened by OPEN_CONTROL_ROOM.cmd; the owner works through it, not the terminal), the gate, the self-tests and the morning round. State is in `pipeline/state/`, run reports in `pipeline/runs/`, each story's saved evidence in `evidence/`.

## Standing rules

- Fix the source, not the stories (the owner, 2026-10-28: "it is not important to fix published stories, since i will delete all of them when my website goes public, the important thing is to fix from the source like the code, the logic etc"). A fault found in a published story is fixed where the pipeline made it; the story is evidence. No bulk re-pick of photographs, re-desking or rewriting of old stories without his say.
- The site is an online news website, never a paper: no العدد/الطبعة/صحيفة about itself. `lang="ar" dir="rtl"`, logical CSS properties, Western digits, pan-Arab month names; every font size is a role token in `src/styles/global.css`; one house colour, banknote green. `site.md` has the rest.
- Every article keeps its sources, models and quality fields. The site is private until launch (`site.json` `private: true`); launching is the owner's decision.
- The newsroom writes with Claude `claude-opus-5-5` on the owner's subscription at the default effort (Medium); the picture desk alone thinks at Extra (`xhigh`); never Max. Efforts were tested on 27 and 28 October and Sonnet 5.5 on 13 November: nothing beat Opus at Medium, and the owner kept it. `models-and-usage.md` has the numbers.
- The plan's allowance is shared by the newsroom, the control room's chat and every Claude Code session. Anything that calls the model spends it: read the plan's meter before quoting a test's cost, stop at the first limit refusal, and never pay for the same work twice (a story the desk has read carries `deskedAt`; a finished photo search is recorded).
- Never print, log or commit a key; `.env` and the repository secrets hold them, and the repository is public.
- The newsroom's own Claude calls run without a shell, from a temporary directory, with `--setting-sources ""`, so these notes never reach the writer. Keep it so.

## Before handing off

- `node scripts/gate.mjs` must pass (scripts parse, self-tests, `astro check`, the build, the built site's checks). Read its real exit code, never a piped one, and never start it while another gate or build runs in this checkout: they share `dist` and fail each other. A Stop hook holds a turn once when a covered file changed since the last pass.
- `npm run newsroom:dry` tests pipeline changes without publishing; `--dry-run --preview=DIR` writes what a run would publish.
- Pushing `main` publishes: Cloudflare Pages (khazendar.pages.dev) is the live site, GitHub Pages its mirror. The cloud newsroom commits to `main` on its own schedule, so sync before you push (`scripts/sync.mjs`).

## How to work here

Each of these was paid for; the notes have the cases.

- When the owner points at a bad story or picture, trace it through the run log to the step that made it and say which it is: a bug, a rule of ours, or supply (the free libraries, the sources). Most turned out to be our own rules.
- Reproduce a fault before fixing it, and pin the fix with a self-test that fails on the old code (`scripts/*-selftest.mjs`, all in the gate).
- Before writing a style or picture rule, count the pattern over the published archive, and for Arabic style in the real desks' copy. A rule that can be met the cheap way will be: «no bridges between paragraphs» produced bare openings, «a paragraph under the wrong subhead moves» produced a subhead per paragraph.
- An example in a prompt is copied. Use real lines on other subjects, and never quote the bad sentence you are trying to stop.
- One dry run is one draw: writers and judges vary between runs. Say n=1 when it is.
- Check a reviewer agent's or another model's finding with a probe before acting on it; most are real, some are not.
- The owner's examples are examples, not rules, and his verdict on what he sees outranks a metric. When he cannot choose, he leaves the call to you: make it and say why.
- He reads short answers. Lead with the verdict, then what changed, then what is left.
