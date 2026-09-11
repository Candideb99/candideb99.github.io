# خازندار — notes for agents

Arabic-first (RTL) economics publication written by an automated newsroom. Read `README.md` first, then `PRODUCT.md` (product truth) and `DESIGN.md` (visual system).

- The site is static Astro in `src/`; articles are Markdown in `content/articles/` written only by `pipeline/run.mjs`. Never hand-write news articles; run the pipeline.
- Keep `lang="ar" dir="rtl"`, logical CSS properties, Western digits, pan-Arab month names. Body font Noto Naskh (justified), headlines and wordmark Amiri, Tajawal only for dates and small furniture. One house colour, banknote green `--green` (ink, plus the section bar and the logo plate); no section colours, no colour-washed photos, no generated cover art.
- Editorial rules live in `pipeline/lib/write.mjs` (house style), `pipeline/lib/select.mjs` (news judgement), `pipeline/lib/verify.mjs` (what blocks publication). Change behaviour there, not by editing generated articles.
- Only free OpenRouter models (`:free`) are allowed; chains in `pipeline/lib/llm.mjs`. The key comes from `OPENROUTER_API_KEY` in the environment or the GitHub Actions secret; never commit it.
- Every article must keep its sources, models and quality fields; the site displays them.
- The logo is the owner's artwork `brand/logo-source.png` (green calligraphic wordmark over a gold key); `scripts/brand.mjs` traces it into `src/lib/brand.ts` and `public/` (logo.svg, logo-dark.svg, favicon.svg, avatar.png, og-default.png). Run `npm run brand` after replacing the artwork; never redraw the logo and never hand-edit the outputs.
- The front page is a news-organisation layout (headline strip, top-stories list, lead, figures and picks modules, section card rows); keep it dense and picture-led. Every story should carry a photo: `pipeline/lib/images.mjs` falls back to a generic Commons illustration, and `node pipeline/backfill-images.mjs` fills older stories.
- Before handing off: `npm run check` and `npm run build` must pass; run `npm run newsroom:dry` to test pipeline changes without publishing.
- Deploys: pushing `main` to `Candideb99/candideb99.github.io` builds and publishes via GitHub Pages; the newsroom workflow runs on a cron and commits to `main` itself.
- Scheduled automation: `.github/workflows/editor.yml` (daily Claude editor) and `agent.yml` (issue-triggered) both run on the owner's subscription and are gated on the repository variable `KHAZENDAR_EDITOR=1`; `KHAZENDAR_PROVIDER=claude` additionally routes the newsroom's writing to it.
- Pre-launch: `site.json` `private: true` forces noindex on every page, a blanket-refusal `robots.txt` and no sitemap. Set it to `false` to launch.
- Photographs are hotlinked from Wikimedia Commons, which serves only the widths 120/250/330/500/960/1280; `src/lib/wikimedia.ts` builds the srcset and any other width answers HTTP 400.
