# خازندار — Khazendar

An Arabic economics publication that writes itself. A scheduled newsroom reads official releases and reputable outlets, picks the stories that matter to Arab readers, writes original Arabic reporting with the key figures isolated and every source cited, verifies it with an independent critic model, and publishes to a static site. No CMS, no accounts, no human in the loop.

Live: https://candideb99.github.io

New to this? Read **[START_HERE.md](START_HERE.md)** first: the three places to look, what runs by itself, ads, and how to use your own Claude or ChatGPT subscription.

## Claude as the scheduled editor

`.github/workflows/editor.yml` runs Claude Code once a day on the owner's subscription
(`claude setup-token` → secret `CLAUDE_CODE_OAUTH_TOKEN`, plus the Claude GitHub App), gated on the
repository variable `KHAZENDAR_EDITOR=1`. It repairs failed newsroom runs, backfills missing
pictures, keeps `npm run check` and `npm run build` green, and tightens de-duplication rules. It
commits fixes confined to `pipeline/`, `content/articles/` and `.github/` itself, and opens a pull
request for anything touching `src/` or the product documents. `.github/workflows/agent.yml` answers
an issue that mentions `@claude`, restricted to the repository owner.

Setting the variable `KHAZENDAR_PROVIDER=claude` additionally routes the newsroom's own writing and
critic calls to the subscription instead of the free OpenRouter models (`pipeline/lib/llm.mjs`,
`callClaudeCli`); vision stays on OpenRouter.

## The editing

A paper is edited, not filled: `pipeline/lib/select.mjs` scores candidates on the desks' news
values and states them, `pipeline/run.mjs` caps a run at four stories and a day at ten news stories
(`KHAZENDAR_DAILY_CAP`), and `pipeline/lib/verify.mjs` rejects a story whose headline shares half its
content words with one published in the last four days. STYLE.md §2 explains the rules.

## The house style

`STYLE.md` records how the paper writes and organises news, taken from the practice of the Arabic
economics desks: the lede formula, attribution forms, the banned calques and fillers, headline
forms, the kicker, relative time, and what is deliberately not copied. `pipeline/lib/style.mjs`
is its machine-checkable half.

## The Arabic copy desk

`pipeline/lib/copydesk.mjs` runs on every draft before the critic: a model rewrites translationese
(indefinite subjects such as "إدارة أمريكية", "يعلن عن" + verbal noun, jargon calques such as
"مستردات" or "المعدل العقاري", chained headlines, wrong case endings) into the idiom of an Arabic
daily, and a guard throws away any rewrite whose digits, number words, count-bearing duals or Latin
tokens differ from the original, whose length leaves a band, or whose subheads change. Headline and
dek are judged as a pair, so a figure may move from one to the other but never vanish.
`node pipeline/copydesk.mjs [--dry-run] [--limit=N] [--slugs=a,b] [--body]` runs the same desk over
published articles and writes a report to `pipeline/runs/`.

## Hermes, the local editor

Hermes Agent (Nous Research, installed at `%LOCALAPPDATA%\hermes`) runs on the owner's laptop as the
newspaper's local editor, on OpenRouter free models (`inclusionai/ling-3.0-flash-fin:free`, provider
and key in `%LOCALAPPDATA%\hermes\config.yaml` and `.env`, never in this repo). It is registered to
the project `khazendar` and reads `HERMES.md` (its charter) together with `CLAUDE.md` (the house
rules). Image generation and computer-use tools are disabled deliberately: this paper publishes
licensed photographs or no picture at all.

It drives the existing pipeline rather than replacing it, so every story it publishes passes the same
grounding checks, critic pass and vision-verified image search as a cloud run. A scheduled job
(`khazendar-editor-round`, `0 9 * * *`) does a daily editor's round; the Hermes gateway starts with
Windows and fires it. `TALK_TO_HERMES.cmd` opens an interactive session.

## Control room

Double-click `OPEN_CONTROL_ROOM.cmd` (or `npm run control`) and open http://127.0.0.1:7777. It shows the last run's report, the next scheduled cloud run, every article with its critic score, and buttons to run the newsroom, write an explainer, dry-run, build a local preview, sync, publish local changes, or unpublish a story. It binds to localhost only and uses no GPU.

## Design and brand

The site is a classical Arabic daily on screen: white paper, black ink, one banknote green (the logo plate and the section bar), rules instead of boxes, Amiri headlines, Noto Naskh text justified in ruled columns, photographs in true colour at their column's width. `DESIGN.md` records the system as built.

The logo is the owner's artwork, `brand/logo-source.png`: the wordmark خازندار in dark-green calligraphy over the treasurer's key in gold on a thin rule. `scripts/brand.mjs` (`npm run brand`) traces it into `public/logo.svg` and `public/logo-dark.svg` (paper lettering for dark pages), cuts the key's bow into `public/favicon.svg` and the touch icons, and builds `public/avatar.png` and `public/og-default.png` from it; the traced paths in `src/lib/brand.ts` also draw the per-article social cards (`src/pages/og/[slug].png.ts`). The artwork is used as delivered, never redrawn; never hand-edit the generated files.

The front page is laid out like a news organisation's site: a latest-headlines strip, the top-stories list, the lead with two secondary stories, today's figures and the editor's picks, then a row of picture cards per section. Every story should carry a photograph: the newsroom first searches for the writer's specific subjects and then, as a newspaper would, for a generic illustration of the place, institution or sector (`pipeline/lib/images.mjs`); `node pipeline/backfill-images.mjs` fills older stories.

## Data visuals

When the sources contain at least three comparable figures, the writer emits a chart (bar or line) or a table with Arabic labels. Every value is checked against the sources by `pipeline/lib/verify.mjs`; a visual with an unsupported number is dropped without touching the article. Charts render as static SVG (`src/components/Chart.astro`) with a legend, tooltips and a table view.

## Model providers

Default: free OpenRouter models. Alternative: the owner's Claude subscription through Claude Code (`KHAZENDAR_PROVIDER=claude`, after `claude login` locally or a `CLAUDE_CODE_OAUTH_TOKEN` secret plus the `KHAZENDAR_PROVIDER` repository variable in the cloud). Photo selection always uses the free vision model.

## Advertising

Set `adsenseClient` (and optionally `googleSiteVerification`) in `src/data/site.json`; the AdSense script, `/ads.txt` and the privacy page's ads section switch on automatically.

## How it runs

| Piece | Where | What it does |
| --- | --- | --- |
| `pipeline/` | GitHub Actions, every 3 hours (`.github/workflows/newsroom.yml`) | Fetch feeds → editor selects and clusters stories → writer drafts Arabic → programmatic checks + critic review → licensed photo pick → Markdown article committed to `content/articles/` |
| `--mode=explainer`, `--mode=analysis` | same workflow, once a day each (05:41 and 14:07 UTC) | An explainer teaches one concept behind the week's coverage. An analysis (`kind: analysis`, section `analysis`) picks a theme where at least two recent stories connect, argues what it means and for whom, lays out scenarios and what to watch, and may cite figures only from the related stories, which it links as its sources. |
| `--mode=paper` | same workflow, Tuesdays and Fridays (09:31 UTC) | A reading of a research paper (`kind: paper`, filed in the explainers hub as قراءة في ورقة بحثية): the research editor picks one recent open-access economics paper from the `papers` feeds in `pipeline/sources.json` (Federal Reserve, Bank of England, ECB, World Bank, NBER, arXiv), and the writer explains it in plain Arabic under five fixed subheads (the question, the data and method, the findings, the limits, what it means for Arab readers). Every figure is checked against the paper's own text, which is the single source filed; the mode passes over a paper whose free text is too thin. |
| `src/` | Astro static site (`.github/workflows/deploy.yml`) | Builds the site, Pagefind search, RSS, sitemap, OG images; deploys to GitHub Pages on every push to `main` |
| `pipeline/sources.json` | repo | The only list of feeds the newsroom reads. Add or disable sources here. The `defense` section (الدفاع) is fed by the defence press (Breaking Defense, Defense One, the Army/Naval/Airforce Technology titles, War on the Rocks) and two official sources, the US Department of Defense contract announcements and the UK Ministry of Defence; the editor files defence budgets, procurement and contract awards, the arms trade and the defence industry there, judged by what they mean for Arab economies. |
| `pipeline/state/seen.json` | repo | Fingerprints of items already used or rejected (auto-pruned after 21 days) |
| `pipeline/runs/latest.json` | repo | Report of the last run: what was selected, published, rejected and why |

Models (all free tier on OpenRouter, with automatic fallback): MiniMax M3 and Nvidia Nemotron 3 Ultra for editing and writing, Nemotron / Ling Flash Fin / MiniMax for the critic, MiniMax / Gemma 4 for photo selection. Override any chain with `KHAZENDAR_MODELS_EDITOR|WRITER|CRITIC|VISION` (comma-separated ids).

## Operating it

- **Secrets:** the repository needs one Actions secret, `OPENROUTER_API_KEY`. Nothing else.
- **Manual run:** Actions → Newsroom → Run workflow (choose `news`, `explainer`, `analysis` or `paper`, and a limit).
- **Unpublish:** delete the Markdown file in `content/articles/` and push; the next deploy removes the page.
- **Quality signal:** every article's frontmatter carries `quality.score` (critic score 0-10), the models used, and the sources. The Actions run summary shows a table per run.
- **Tune:** editorial rules live in `pipeline/lib/write.mjs` (house style), `pipeline/lib/select.mjs` (what counts as important) and `pipeline/lib/verify.mjs` (what blocks publication).

## Local development

```bash
npm ci
npm run dev            # site at http://localhost:4321
npm run build          # static build in dist/ (includes Pagefind index)
OPENROUTER_API_KEY=... npm run newsroom:dry     # full pipeline without writing files
OPENROUTER_API_KEY=... npm run newsroom -- --limit=3
OPENROUTER_API_KEY=... npm run newsroom:explainer
OPENROUTER_API_KEY=... npm run newsroom:analysis
OPENROUTER_API_KEY=... npm run newsroom:paper
```

Node 22 or newer. The key is read from the environment or from a git-ignored `.env` in the project root; never commit it.

## Editorial policy in one paragraph

No story without a source; original Arabic, attributed, with numbers exactly as sourced; every number checked against the sources by code, every claim checked by a second model; paywalls and robots.txt respected; photos only under open licences with credit; corrections by deleting or replacing the file. See `/methodology` on the site.
