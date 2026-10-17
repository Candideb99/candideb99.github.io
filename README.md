# خازندار — Khazendar

An Arabic economics publication that writes itself. A scheduled newsroom reads official releases and reputable outlets, picks the stories that matter to Arab readers, writes original Arabic reporting with the key figures isolated and every source cited, verifies it with a critic pass that never saw the writing, publishes to a static site, and reads every story again against its sources a day later. No CMS, no accounts, no human in the loop.

Live: https://candideb99.github.io

New to this? Read **[START_HERE.md](START_HERE.md)** first: the three places to look, what runs by itself, ads, and how to use your own Claude or ChatGPT subscription.

## Claude as the scheduled editor

`.github/workflows/editor.yml` runs Claude Code once a day on the owner's subscription
(`claude setup-token` → secret `CLAUDE_CODE_OAUTH_TOKEN`, plus the Claude GitHub App), gated on the
repository variable `KHAZENDAR_EDITOR=1`. Free checks run first (`scripts/editor-precheck.mjs`: failed runs,
the build, repeated events, photos lost at their library through the Commons API, a day without news, stale
quotes, a live site behind the repository) and Claude is woken only for what they find, at most once in three
days for the same fault. It repairs failed newsroom runs, keeps `npm run check` and `npm run build` green, and
tightens de-duplication rules. It commits its fixes but cannot push them: the next workflow step runs
`scripts/gate.mjs` and publishes them only if it passes, straight to main for `pipeline/` and `scripts/`, as a
pull request for anything else. What only the owner can mend (the Claude token, the host) is opened as an issue.
The same round writes the week's numbers (`scripts/harvest.mjs`, free): style faults per story, corrections and
the second look's findings, this week against last, in `pipeline/state/quality.json` for the control room. `.github/workflows/agent.yml` answers
an issue that mentions `@claude`, restricted to the repository owner.

Every model call of the newsroom, the copy desk and the picture desk also runs on the subscription,
through Claude Code (`pipeline/lib/llm.mjs`, `callClaudeCli`). The free OpenRouter models were dropped
on 2026-09-24 at the owner's request.

## The editing

News is edited, not filled: `pipeline/lib/select.mjs` scores candidates on the desks' news
values and states them, `pipeline/run.mjs` caps a run at four stories and a day at twenty news stories
(`KHAZENDAR_DAILY_CAP`; ten until 2026-09-24) and takes at least one Gulf, Egyptian or Maghreb story a run
while the day has fewer than eight, and `pipeline/lib/verify.mjs` rejects a story whose headline shares half its
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

Double-click `OPEN_CONTROL_ROOM.cmd` (or `npm run control`); it opens the browser itself at the port it got: 7777, or 4777 and then any free port when Windows has reserved 7777 (it did on 2026-09-24, in the block 7722-7821). It shows the last run's report, the next scheduled cloud run, every article with its critic score, and buttons to run the newsroom, write an explainer, dry-run, build a local preview, sync, publish local changes, or unpublish a story. It binds to localhost only and uses no GPU.

## Design and brand

The site is a classical Arabic daily on screen: white paper, black ink, one banknote green (the logo plate and the section bar), rules instead of boxes, Amiri headlines, Noto Naskh text justified in ruled columns, photographs in true colour at their column's width. `DESIGN.md` records the system as built.

The logo is the owner's artwork, `brand/logo-source.png`: the wordmark خازندار in dark-green calligraphy over the treasurer's key in gold on a thin rule. `scripts/brand.mjs` (`npm run brand`) traces it into `public/logo.svg` and `public/logo-dark.svg` (paper lettering for dark pages), cuts the key's bow into `public/favicon.svg` and the touch icons, and builds `public/avatar.png` and `public/og-default.png` from it; the traced paths in `src/lib/brand.ts` also draw the per-article social cards (`src/pages/og/[slug].png.ts`). The artwork is used as delivered, never redrawn; never hand-edit the generated files.

The front page is laid out like a business daily's site: a market strip (indices, oil, gold, currencies, as their move on the day), a latest-headlines strip, the rotating cover with the paper's own readings and a market box beside it, the top-stories list, two secondary stories, today's figures and the editor's picks, then a row of picture cards per section. The market data (`pipeline/markets.mjs` → `src/data/markets.json`) is delayed, free and keyless (Yahoo Finance's public chart endpoint, open.er-api.com for currencies as a fallback); the deploy refreshes it before every build and rebuilds every two hours, and the full board is its own page, /markets/data/, organised as the dailies organise theirs (headline cards with a month's line, compact group tables, the latest market news); the الأسواق section opens with news and carries a glance band. The economic calendar (`pipeline/calendar.mjs` → `src/data/calendar.json`, from the Fed, ECB, BoE and BLS schedule pages) feeds the front's الأجندة module and `/calendar/`; every Friday the newsroom writes حصاد الأسبوع, the week's review, from its own stories and that calendar (`npm run newsroom:weekly`); every Sunday it writes «في العمق», the in-depth piece: the whole story of one running file from its own stories, with a timeline (`npm run newsroom:feature`). Every story should carry a photograph: the newsroom first searches for the writer's specific subjects and then, as a newspaper would, for a generic illustration of the place, institution or sector (`pipeline/lib/images.mjs`); `node pipeline/backfill-images.mjs` fills older stories.

## Data visuals

When the sources contain at least three comparable figures, the writer emits a chart (bar or line) or a table with Arabic labels. Every value is checked against the sources by `pipeline/lib/verify.mjs`; a visual with an unsupported number is dropped without touching the article. Charts render as static SVG (`src/components/Chart.astro`) with a legend, tooltips and a table view.

## Model providers

**ChatGPT subscription:** choose **ChatGPT subscription — Codex** and `gpt-6.1-sol` in Control Room Settings, then **Use locally for testing**. The official `codex` CLI must be installed and signed in using ChatGPT (`codex login`); **Test ChatGPT subscription** checks the connection. This uses the plan's existing allowance. Newsroom calls use high reasoning effort, shown in the ChatGPT card in Settings. It refuses API-key login, removes API credentials from the child process, and never falls back to the paid API. Text and photo inputs run from temporary directories with shell, browser and multi-agent tools disabled.

**Accounts and dates:** Settings → ChatGPT subscription → **Connect ChatGPT account** opens the official browser sign-in flow; **Device code** is available as an alternative. Each additional connection has its own `CODEX_HOME` outside the repository; switching the newsroom does not log the Codex desktop app out. **Use this account** chooses a local connection. The optional **Expected access end** date is a user reminder, not a verified subscription expiry: OAuth token expiry refreshes automatically, and a stored subscription-period claim can be stale even while inference works. If the plan or access stops working, calls fail without an API fallback; connect a replacement account and select it.

**Two accounts:** connect each account once for the intended run location, then choose **Primary and backup accounts**, enable **quota fallback**, and save the pair. Both sessions stay signed in and renew automatically while valid. Codex's documented `account/rateLimits/read` supplies the actual quota windows and reset times; **Refresh usage** displays them without an inference call. The primary is preferred whenever available; only a quota exhaustion uses the available backup. Both exhausted stops model calls until a later run can confirm an allowance reset. A weekly cap remains binding after a five-hour window resets. Unknown usage never clears a previously known cap; network, content and authentication errors do not rotate accounts. Quota exhaustion defers news instead of marking the event rejected. No API fallback or credit purchase is performed. Revoked sessions can still require a fresh sign-in.

**Scheduled publishing:** deploy the prepared workflow support first. Connect a separate sign-in for **GitHub scheduled publishing**, then click **Use for GitHub scheduled publishing**. That explicit action verifies the sign-in and quota access, stores the session in repository secrets, and switches the scheduled provider only when no cloud run is active. It never copies the desktop session. Refreshed cloud credentials are encrypted with AES-256-GCM before entering the Actions cache; the key remains a repository secret, and the account/session id is authenticated with the ciphertext. Newsroom and picture-repair runs share one concurrency group so refreshes cannot race. Plaintext exists only in `RUNNER_TEMP`; neither it nor the key is committed or logged. Cache loss after the original sign-in expires, revoked access, or cancellation can require reconnecting the cloud account. Until a cloud connection is explicitly completed, the current scheduled provider stays in use.

For cloud fallback, connect both dedicated cloud sign-ins before saving their primary/backup pair. The workflow restores and refreshes both sessions, plus quota state, in the same encrypted cache. The Control Room's **Read latest cloud usage report** retrieves a sanitized artifact from the latest run; its timestamps are observations, not live guarantees. It does not refresh a cloud-owned login on the laptop. When replacing an already-exported pair, reconnect its sessions rather than exporting a stale local refresh token.

Supports ChatGPT subscription through Codex (the owner's current local and cloud provider, `gpt-6.1-sol`), Google Gemini, Anthropic Claude, OpenAI API, Alibaba Qwen (DashScope), and OpenRouter. The active provider can be changed at any time from the Control Room UI (**Settings** → **Who controls & writes the website**) or via `KHAZENDAR_PROVIDER` in `.env` / GitHub Actions repository variables. GitHub runs the scheduled newsroom and deployment independently of the laptop; the local Control Room is needed only to configure or inspect it.

- **Google Gemini (Active)**: Uses Google Generative Language API (`GEMINI_API_KEY`). Defaults to `gemini-2.5-pro` (or `gemini-2.5-flash`), featuring native JSON structured output and multimodal vision for newsroom image selection.
- **Anthropic Claude (Idle / Standby)**: Preserved for easy switching back. Uses Claude Code CLI OAuth token (`CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`) or direct `ANTHROPIC_API_KEY`, defaulting to `claude-opus-5-5`.
- **OpenAI API**: Uses `OPENAI_API_KEY`, defaulting to `gpt-6.1-sol` (GPT-6.1 Sol). Create a key at https://platform.openai.com/api-keys and enable API billing separately from a ChatGPT subscription. In Control Room → Settings, save the key and click **Test OpenAI connection** to check Arabic JSON output without changing the active provider. Then choose OpenAI and `gpt-6.1-sol` under **Who controls & writes the website**, click **Use locally for testing**, and start a dry run from the Desk. **Apply Controller & Model** updates both this laptop and the GitHub Actions variables; use it for cloud activation only after the integration code has been deployed. The key's **Also send it to GitHub** checkbox controls whether cloud runs receive the key. A full dry run can also be tested locally with `KHAZENDAR_PROVIDER=openai`, `KHAZENDAR_OPENAI_MODEL=gpt-6.1-sol`, and `npm run newsroom:dry -- --limit=1` (environment variables or the gitignored `.env`).
- **Alibaba Qwen**: Uses DashScope OpenAI-compatible API (`DASHSCOPE_API_KEY` / `QWEN_API_KEY`), defaulting to `qwen-max` or `qwen-vl-max`.
- **OpenRouter**: Third-party router (`OPENROUTER_API_KEY`).

When one provider is active, all other configured credentials remain safely idle. There is no fallback between providers: the active provider's calls are retried up to three times with exponential backoff and schema validation.

## Advertising

Set `adsenseClient` (and optionally `googleSiteVerification`) in `src/data/site.json`; the AdSense script, `/ads.txt` and the privacy page's ads section switch on automatically.

## How it runs

| Piece | Where | What it does |
| --- | --- | --- |
| `pipeline/` | GitHub Actions, a cron every 3 hours (`.github/workflows/newsroom.yml`; about five runs a day in practice, see the cadence note below) | Fetch feeds → editor selects and clusters stories → writer drafts Arabic → programmatic checks + critic review → licensed photo pick → Markdown article committed to `content/articles/` |
| `--mode=explainer`, `--mode=analysis` | same workflow, once a day each (05:41 and 14:07 UTC) | An explainer teaches one concept behind the week's coverage. An analysis (`kind: analysis`, section `analysis`) picks a theme where at least two recent stories connect, argues what it means and for whom, lays out scenarios and what to watch, and may cite figures only from the related stories, which it links as its sources. |
| second look and lessons | every news round, before it writes (`--mode=recheck` by hand) | The second look (`pipeline/recheck.mjs`, `pipeline/lib/factcheck.mjs`): the earlier rounds' news stories, analyses, week's reviews and في العمق pieces are read again against their sources, sentence by sentence, in a session that never saw the writing, and the backlog two a round. Then `pipeline/learn.mjs` (`pipeline/lib/lessons.mjs`) turns the mistakes it proved into at most ten lessons the desk notes and the writer read before the round's stories (`pipeline/state/lessons.json`; one call only when there is a new proved mistake; the lessons do not grow with the mistakes). A mistake counts only when code finds the quoted source sentence that proves it; then `pipeline/correct.mjs` corrects the story with a dated note (or finds that it stands). The site's own reasoning, a figure whose source page has since changed, and an unproved flag are listed in `pipeline/state/factcheck.json`, never corrected. One Claude call per story, never twice for the same story. |
| `--mode=paper` | same workflow, Tuesdays and Fridays (09:31 UTC) | A reading of a research paper (`kind: paper`, filed in the explainers hub as قراءة في ورقة بحثية): the research editor picks one recent open-access economics paper from the `papers` feeds in `pipeline/sources.json` (Federal Reserve, Bank of England, ECB, World Bank, NBER, arXiv), and the writer explains it in plain Arabic under five fixed subheads (the question, the data and method, the findings, the limits, what it means for Arab readers). Every figure is checked against the paper's own text, which is the single source filed; the mode passes over a paper whose free text is too thin. |
| `src/` | Astro static site (`.github/workflows/deploy.yml`) | Builds the site, Pagefind search, RSS, sitemap, OG images; deploys to GitHub Pages on every push to `main` |
| `pipeline/sources.json` | repo | The only list of feeds the newsroom reads. Add or disable sources here. The `defense` section (الدفاع) is fed by the defence press (Breaking Defense, Defense One, the Army/Naval/Airforce Technology titles, War on the Rocks) and two official sources, the US Department of Defense contract announcements and the UK Ministry of Defence; the editor files defence budgets, procurement and contract awards, the arms trade and the defence industry there, judged by what they mean for Arab economies. |
| `pipeline/state/seen.json` | repo | Fingerprints of items already used or rejected (auto-pruned after 21 days) |
| `pipeline/runs/latest.json` | repo | Report of the last run: what was selected, published, rejected and why |

**The cadence GitHub actually keeps.** The crons are what the workflows ask for, not what they get. Over 7–13 September 2026 GitHub fired the three-hourly news cron 1.5–2.5 hours late and never fired its 00:23, 06:23 and 12:23 slots, so the paper gets about five news runs a day, not eight; the 05:41 explainer ran between 09:33 and 10:35, the daily editor (07:17) between 11:35 and 12:13, and the two-hourly deploy fired once in five slots. Expect the Friday review (15:37) and the Tuesday/Friday paper reading (09:31) two to four hours late. The mode is decided from the cron string, so a late run still does the right thing; only the timing is the platform's, and nothing in this repository can promise more than that. A run that publishes nothing still commits its state and report, so `pipeline/runs/latest.json` is always the last run.

Models: Gemini by default, or Claude, OpenAI, Qwen, OpenRouter (see "Model providers" above).

## Operating it

- **Secrets:** Repository secret for your chosen provider: `GEMINI_API_KEY` (active) or `CLAUDE_CODE_OAUTH_TOKEN` (idle/standby), or `OPENAI_API_KEY`, etc.
- **Manual run:** Actions → Newsroom → Run workflow (choose `news`, `explainer`, `analysis`, `paper` or `weekly`, a limit, and for an analysis optionally the sections it may draw on, e.g. `defense` for the defence-and-geopolitics reading).
- **Unpublish:** delete the Markdown file in `content/articles/` and push; the next deploy removes the page.
- **Quality signal:** every article's frontmatter carries `quality.score` (critic score 0-10), the models used, and the sources. The Actions run summary shows a table per run.
- **Tune:** editorial rules live in `pipeline/lib/write.mjs` (house style), `pipeline/lib/select.mjs` (what counts as important) and `pipeline/lib/verify.mjs` (what blocks publication).

## Local development

```bash
npm ci
npm run dev            # site at http://localhost:4321
npm run build          # static build in dist/ (includes Pagefind index)
npm run newsroom:dry     # full pipeline without writing files (add -- --preview=DIR to read what it would publish)
npm run newsroom -- --limit=3
npm run newsroom:explainer
npm run newsroom:analysis
npm run newsroom:paper
```

Node 22 or newer. The credentials for your active provider (such as `GEMINI_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`) are read from the environment or from a git-ignored `.env` in the project root; never commit it.

## Editorial policy in one paragraph

No story without a source; original Arabic, attributed, with numbers exactly as sourced; every number checked against the sources by code, every claim checked by a critic pass, and every story read again against its sources a day after publication; paywalls and robots.txt respected; photos only under open licences with credit; corrections by deleting or replacing the file. See `/methodology` on the site.
