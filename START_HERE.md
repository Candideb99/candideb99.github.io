# Start here — how خازندار works and how to run it

You own an automated Arabic economics newspaper. This page is the whole operating manual. You do not need to know how to code.

## 1. The three places

| What | Where | Why you go there |
| --- | --- | --- |
| The live website | https://candideb99.github.io | What readers see. Updates itself every 3 hours. |
| The control room (on this laptop) | double-click `OPEN_CONTROL_ROOM.cmd` → http://127.0.0.1:7777 | See what was published, run the newsroom by hand, remove a story, preview locally. |
| The cloud runs | https://github.com/Candideb99/candideb99.github.io/actions | Every automatic run with a table of what it published or rejected and why. |
| Hermes, the local editor | double-click `TALK_TO_HERMES.cmd` | Talk to an agent that runs the newsroom, fixes pictures, diagnoses failures and reports back. |

Nothing here uses your GPU. Writing happens on OpenRouter's servers (or on your Claude subscription, see section 5); the site is built and served by GitHub.

## 2. What happens automatically

Every 3 hours (and once a day for an explainer) a cloud job:

1. reads 38 feeds (central banks, statistics offices, BBC, CNBC, Guardian, Al Jazeera, Asharq Al-Awsat, Sky News Arabia …),
2. picks the stories that matter to Arab readers and groups sources covering the same story,
3. writes an original Arabic article with the key figures, a "why it matters" paragraph and, when the sources contain comparable numbers, an Arabic chart or table,
4. checks every number against the sources by code and sends the draft to an independent critic model; anything that fails is rejected and logged,
5. finds a licensed photo on Wikimedia Commons (credited); a story with no suitable photo runs as text,
6. commits the article and republishes the site.

You never have to touch it. If a story is wrong, open the control room and press **Unpublish**.

## 2c. Hermes, your local editor

Hermes Agent is installed on this laptop and connected to your OpenRouter key, so it costs nothing to
run. Double-click **`TALK_TO_HERMES.cmd`** and talk to it in plain words, Arabic or English:

- "check the newsroom and tell me if anything is broken"
- "publish two new stories now"
- "find a better picture for the Oman trade story"
- "add the Saudi central bank feed to the sources"

**What it may do by itself.** Run the newsroom, find and replace pictures, check and build the site,
publish what the pipeline produced, diagnose a failed cloud run and repair it. Its charter is in
`HERMES.md`; it also obeys `CLAUDE.md`, the same house rules every agent here follows. It never
writes an article by hand, never invents a number, and never generates a picture: the pipeline writes
and the critic checks, which is what keeps the quality up.

**What it does on its own every day.** At 9am it does the editor's round: reads the last cloud runs,
fixes any story that lost its picture, and leaves you a short report. It only runs while the laptop is
on and awake, which is why the cloud, not Hermes, remains the publisher.

**Turning it off.** In a terminal:

```
%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe cron pause khazendar-editor-round
```

To stop it starting with Windows, run the same command with `gateway uninstall` instead. Neither
touches the cloud newsroom, which keeps publishing either way.

## 3. Your weekly five minutes

- Open the live site once; read one article; make sure it looks right.
- Open the control room; glance at "Last run" for rejections that keep repeating (that means a source or a rule needs adjusting: tell Claude Code or Codex what you see).
- That is it.

## 4. Making money (ads)

The site is prepared for Google AdSense but a person must open the account:

1. Buy a domain (about $10 a year, e.g. khazendar.news) and add it in GitHub → repository → Settings → Pages → Custom domain. Ad networks approve custom domains far more readily than free github.io addresses.
2. Apply at https://adsense.google.com with the site address. AdSense wants: original content (you have it, growing daily), an About page, a Privacy page and a Contact route (add your email in `src/data/site.json` → `contactEmail`).
3. When approved, paste your publisher id (looks like `ca-pub-1234567890`) into `src/data/site.json` → `adsenseClient` and publish (control room → Commit & publish). Auto ads and the required `ads.txt` file switch on by themselves.
4. Optional: put your Google Search Console verification code in `googleSiteVerification` in the same file so Google indexes the site faster.

Realistic expectations: ad income follows traffic, and traffic follows months of consistent publishing plus search visibility. The system gives you the consistency; the domain and time give you the rest.

## 5. Letting Claude run the paper on your subscription

No API key and no per-message cost: this uses your Claude subscription. Do these three things once,
then never again.

**Step 1, on this laptop.** Open a terminal in the project folder and run:

```bash
claude setup-token
```

It prints one long token. Copy it.

**Step 2, on GitHub.** Open
https://github.com/Candideb99/candideb99.github.io/settings/secrets/actions and add:

| Where | Name | Value |
| --- | --- | --- |
| Secrets tab, "New repository secret" | `CLAUDE_CODE_OAUTH_TOKEN` | the token from step 1 |
| Variables tab, "New repository variable" | `KHAZENDAR_EDITOR` | `1` |
| Variables tab, optional | `KHAZENDAR_PROVIDER` | `claude` |

**Step 3.** Install the Claude app on the repository: https://github.com/apps/claude

### What each one switches on

- **`KHAZENDAR_EDITOR = 1`** gives you an editor-in-chief. Every morning Claude reads the night's
  runs, repairs a broken pipeline, finds any missing picture, checks the site still builds, and
  leaves a short report. It commits its own fixes. Anything that would change how the paper looks
  comes to you as a pull request instead. Nobody types a prompt; it is in `.github/workflows/editor.yml`.
- **`KHAZENDAR_PROVIDER = claude`** makes Claude write the articles themselves, instead of the free
  models, on every three-hourly run. This is the single biggest quality change available to you.
  Photo choice still uses a free vision model.
- **Asking for something from anywhere.** With the same setup, open an issue on the repository from
  your phone and write `@claude` with your request. Claude answers and opens a pull request. You
  never open the project folder.

**Turning it off** is one edit: set `KHAZENDAR_EDITOR` to `0`. The newsroom keeps publishing on free
models regardless, so nothing breaks.

**The cost.** No money. It draws on your subscription's usage limits: the daily editor is one
session, and a full newsroom run is roughly 25 to 40 model calls. If you hit your limit, set
`KHAZENDAR_PROVIDER` back to `openrouter` and the free models take over again.

### Codex

Possible locally with `codex exec` and a ChatGPT login, but there is no clean way to run it in the
cloud without copying your login file. Claude is the better route here.

## 6. Changing things

Tell the agent what you want in plain language; these are the files it will touch:

- Sources: `pipeline/sources.json` (add a feed, disable one).
- House style and what counts as news: `pipeline/lib/write.mjs`, `pipeline/lib/select.mjs`.
- What blocks publication: `pipeline/lib/verify.mjs`.
- Look and feel: `src/styles/global.css` and `src/components/`. The design rules are written down in `DESIGN.md`.
- Site name, tagline, contact, ads: `src/data/site.json`.
- The logo: replace `brand/logo-source.png` with new artwork (same idea: dark lettering and a gold key on white), then `npm run brand` (it regenerates the favicon, the social card and the logo files; never edit those by hand).
- A story with a wrong or missing picture: run `node pipeline/backfill-images.mjs --redo=<slug>` (the slug is the last part of the story's address); without `--redo` it only fills stories that have no picture. New stories get a picture automatically, falling back to a generic photo of the place, institution or sector.

## 7. If something breaks

- Cloud run failed: open the Actions page, click the red run, read the last lines. Most failures are free models being unavailable for an hour; the next run recovers.
- Site not updating: check the latest "Deploy" run on the Actions page.
- Everything else: open Claude Code in this folder and paste what you see.

## 8. Costs

Hosting, builds, the newsroom and the free models cost nothing. A domain is about $10 a year. Using your Claude subscription for writing costs nothing extra beyond the subscription.
