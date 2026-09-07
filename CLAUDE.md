# خازندار — notes for agents

Arabic-first (RTL) economics publication written by an automated newsroom. Read `README.md` first, then `PRODUCT.md` (product truth) and `DESIGN.md` (visual system).

- The site is static Astro in `src/`; articles are Markdown in `content/articles/` written only by `pipeline/run.mjs`. Never hand-write news articles; run the pipeline.
- Keep `lang="ar" dir="rtl"`, logical CSS properties, Western digits, pan-Arab month names. Body font Naskh, titles Marhey, masthead Rakkas, UI Tajawal.
- Editorial rules live in `pipeline/lib/write.mjs` (house style), `pipeline/lib/select.mjs` (news judgement), `pipeline/lib/verify.mjs` (what blocks publication). Change behaviour there, not by editing generated articles.
- Only free OpenRouter models (`:free`) are allowed; chains in `pipeline/lib/llm.mjs`. The key comes from `OPENROUTER_API_KEY` in the environment or the GitHub Actions secret; never commit it.
- Every article must keep its sources, models and quality fields; the site displays them.
- Before handing off: `npm run check` and `npm run build` must pass; run `npm run newsroom:dry` to test pipeline changes without publishing.
- Deploys: pushing `main` to `Candideb99/candideb99.github.io` builds and publishes via GitHub Pages; the newsroom workflow runs on a cron and commits to `main` itself.
