# خازندار — Khazendar

An Arabic economics publication that writes itself. A scheduled newsroom reads official releases and reputable outlets, picks the stories that matter to Arab readers, writes original Arabic reporting with the key figures isolated and every source cited, verifies it with an independent critic model, and publishes to a static site. No CMS, no accounts, no human in the loop.

Live: https://candideb99.github.io

New to this? Read **[START_HERE.md](START_HERE.md)** first: the three places to look, what runs by itself, ads, and how to use your own Claude or ChatGPT subscription.

## Control room

Double-click `OPEN_CONTROL_ROOM.cmd` (or `npm run control`) and open http://127.0.0.1:7777. It shows the last run's report, the next scheduled cloud run, every article with its critic score, and buttons to run the newsroom, write an explainer, dry-run, build a local preview, sync, publish local changes, or unpublish a story. It binds to localhost only and uses no GPU.

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
| `src/` | Astro static site (`.github/workflows/deploy.yml`) | Builds the site, Pagefind search, RSS, sitemap, OG images; deploys to GitHub Pages on every push to `main` |
| `pipeline/sources.json` | repo | The only list of feeds the newsroom reads. Add or disable sources here. |
| `pipeline/state/seen.json` | repo | Fingerprints of items already used or rejected (auto-pruned after 21 days) |
| `pipeline/runs/latest.json` | repo | Report of the last run: what was selected, published, rejected and why |

Models (all free tier on OpenRouter, with automatic fallback): MiniMax M3 and Nvidia Nemotron 3 Ultra for editing and writing, Nemotron / Ling Flash Fin / MiniMax for the critic, MiniMax / Gemma 4 for photo selection. Override any chain with `KHAZENDAR_MODELS_EDITOR|WRITER|CRITIC|VISION` (comma-separated ids).

## Operating it

- **Secrets:** the repository needs one Actions secret, `OPENROUTER_API_KEY`. Nothing else.
- **Manual run:** Actions → Newsroom → Run workflow (choose `news` or `explainer`, and a limit).
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
```

Node 22 or newer. The key is read from the environment only; never commit it.

## Editorial policy in one paragraph

No story without a source; original Arabic, attributed, with numbers exactly as sourced; every number checked against the sources by code, every claim checked by a second model; paywalls and robots.txt respected; photos only under open licences with credit; corrections by deleting or replacing the file. See `/methodology` on the site.
