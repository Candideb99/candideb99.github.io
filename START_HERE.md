# Start here — how خازندار works and how to run it

You own an automated Arabic economics newspaper. This page is the whole operating manual. You do not need to know how to code.

## 1. The three places

| What | Where | Why you go there |
| --- | --- | --- |
| The live website | https://khazendar.pages.dev | What readers see, served by Cloudflare Pages (since 2026-09-21). It rebuilds itself from GitHub on every publish and every automatic run. The old address https://candideb99.github.io still works as a mirror. |
| **The control room (on this laptop)** | double-click `OPEN_CONTROL_ROOM.cmd` → http://127.0.0.1:7777 | **Where you do everything.** See what was published, *talk to the paper in plain words and have it change the site*, run the newsroom, remove a story, and publish when you are ready. |
| The cloud runs | https://github.com/Candideb99/candideb99.github.io/actions | Every automatic run with a table of what it published or rejected and why. |
| Hermes, the local editor | double-click `TALK_TO_HERMES.cmd` | The older way to talk to an agent, from a black terminal window. The control room's **Chat** tab replaces it and is easier. |

Nothing here uses your GPU. Writing happens on OpenRouter's servers (or on your Claude subscription, see section 5); the site is built and served by GitHub.

## 2. What happens automatically

Every 3 hours (and once a day each for an explainer and an analysis) a cloud job:

1. reads 47 feeds (central banks, statistics offices, BBC, CNBC, Guardian, Al Jazeera, Asharq Al-Awsat, Sky News Arabia, the defence press …),
2. picks the stories that matter to Arab readers and groups sources covering the same story,
3. writes an original Arabic article with the key figures, a "why it matters" paragraph and, when the sources contain comparable numbers, an Arabic chart or table,
4. passes the draft through an Arabic copy desk that rewrites anything reading like a translation ("إدارة أمريكية تعلن عن مستردات" becomes "واشنطن تعيد 500 دولار للمشتركين"), under a guard that keeps every figure and name exactly as sourced,
5. checks every number against the sources by code and sends the draft to an independent critic model; anything that fails is rejected and logged,
6. finds a licensed photo on Wikimedia Commons (credited); a story with no suitable photo runs as text,
7. commits the article and republishes the site.

You never have to touch it. If a story is wrong, either open the control room on this laptop
(double-click `OPEN_CONTROL_ROOM.cmd`) and press **Unpublish**, or, from any device, open an issue on
the repository and write `@claude` followed by the request in plain words (see section 5).

**What the front page does on its own.** The cover shows the day's strongest story and lists the next
four beneath it as numbered tabs; it turns to the next one every seven seconds until the reader
clicks, hovers or presses a key, and it stays still for readers who have asked their device for less
motion. "ملفات نتابعها" gathers running stories (any topic with three or more articles) so a reader
who missed a week can pick up the thread. "رسم اليوم" prints the freshest chart from the last three
days. All of it is built from the articles; there is nothing to feed it.

## 2b. Keeping it unlisted before you launch

The site is live but asks the whole internet to ignore it. `src/data/site.json` carries
`"private": true`, and while that is set every page says "do not index", `robots.txt` refuses every
crawler, and no sitemap is published. Google and Bing will not list it.

**To launch properly**, change that one line to `"private": false` and publish. The site starts
asking to be indexed the same day.

**Be honest with yourself about what this is.** It hides the site from search engines, not from
people. Anyone you give the address to can read it, and the address is guessable from your public
GitHub account. It is the right setting for "not ready for readers yet"; it is not a lock. A real
lock means moving the site behind a login, which needs a different host, and I can set that up if
you ever need it.

## 2d. The control room — the editor's desk

Double-click **`OPEN_CONTROL_ROOM.cmd`**. Four places in the left rail — **Desk**, **Stories**,
**Settings**, **Change the site** — and the Desk opens first. It says, before anything else, that the
newsroom is running on its own: the next automatic run, the last one, how many stories are live, and
whether anything waits for you. Under that, **every part of the paper**: each section with today's
and this week's count and its last story, so you can see at a glance that nothing is being neglected
(a section quiet for three days is marked *due for one*, and the balancing rule feeds it next).

You do not have to check anything. The desk exists for the few decisions that are yours:

> **read a draft you asked for → Publish or Discard · find a story → open, make it the lead, move it, or unpublish**

**Get new material.** 📰 News stories — for the whole paper or for one section (الاقتصاد, الأسواق,
الطاقة, الشركات, التكنولوجيا, دفاع) and how many; 📘 An explainer; 📈 An analysis (of the week, or of one
section, e.g. defence only); 🔬 A research paper; 🗓 The week's review. Each writes **drafts**. Nothing
reaches the site until you approve it. A news run takes 8–10 minutes for four stories and the panel
shows *"2 of 4 written · 1 refused"* while it works, with a Stop button; the others take 3–5 minutes.

**Where a story goes, and who decides.** The front page is picked by a formula: the **lead** is the
strongest fresh news story (the editor's importance score, minus a point per 12 hours of age, plus 1.5
for a photo); the **cover** is the lead plus the four strongest of the freshest twelve; the next five
run in the **ticker**; everything else sits on its section page and in الأحدث. The live list shows
each story's place in a *Where* column, and **Make it the lead** overrides the formula for 48 hours
when you want a story on top. The section is chosen by the editor model from the filing guide in
`src/data/sections.json` (what belongs where, and the confusable cases); when it still gets one
wrong, **Move to…** on the story's row re-files it in one click, live in a minute. If the same
mistake keeps coming back, tell the *Change the site* tab and the guide gets a line.

**Visitors.** Cloudflare → Workers & Pages → khazendar → Metrics → *View Web Analytics*: visits, pages,
countries, referrers — free, no cookies, nothing installed on readers.

**Finding a story.** The live list filters by section, kind, month, placement (front page or not) and
headline. Nothing is ever archived away: a story keeps its page, its section's older pages and its
topic page for good.

**Models.** Settings → *The models* lists every job's chain of free OpenRouter models with a green or
red dot from OpenRouter's live list. Only `:free` models are ever accepted, so a model that turns paid
cannot be used and you cannot be charged; a red dot means "replace me", and the list below it shows
what is free right now.

**Waiting for your approval.** One card per draft: the photo, the headline and standfirst, the
section, the critic's score, and the sources. **Read it** opens the whole article as it will look —
lede, key facts, body, "why it matters", sources with links, the critic's note, which models wrote
and checked it. Then **Publish** (live in about a minute) or **Discard** (thrown away, and the story
will not come back on the next run). **Publish everything above** does them all.

**Refused by the copy desk in the last run.** Folded away under the drafts: the stories that were
written and then refused, with the reason in Arabic. A source that keeps being refused is worth
telling the *Change the site* tab about.

**Stories.** Every published story with where it sits, its score and its sources. The **⋯** menu on a
row holds everything you can do to it: open it on the site, make it the lead, move it to another
section, unpublish. The bar above filters by headline, section, kind, month and placement.

**Settings.** Three key boxes that are *not* interchangeable, each labelled with what it is and what
its value starts with: OpenRouter (`sk-or-`, free models), Claude API key (`sk-ant-`, pay per use),
Claude subscription token (from `claude setup-token`, no per-message cost). A line tells you which
one the cloud is actually writing with. Below that: whether the cloud publishes on its own or writes
drafts and waits for you, and the newspaper's own fields (contact email, AdSense id, visibility).

**Change the site.** A chat for changing how the paper *looks and works* — a font size, a new source,
a rule the copy desk keeps applying wrongly. It is not for running the paper; the Desk is. It can
change anything and cannot publish: what it changed is listed underneath with Publish / Preview / Undo.

### Two ways to run the paper

- **As now**: the cloud publishes on its own every three hours, and the desk is for extra material
  and for taking things down. Settings → "Publish on their own".
- **Editor-gated**: the cloud writes drafts and waits. You open the desk, press **Sync from GitHub**,
  read, publish. Settings → "Write drafts and wait for me". Choose this if you want to see every
  story before a reader does.

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

**Switched off, 2026-09-11.** You asked for no extra services running, so Hermes is stopped and no
longer starts with Windows, and its daily job is paused. It never touched your graphics card; it
only made web requests. Claude now does the scheduled work instead. To bring Hermes back:

```bash
%LOCALAPPDATA%\hermes\hermes-agent\.venv\Scripts\hermes.exe gateway install
```

`TALK_TO_HERMES.cmd` still works for a one-off chat without any of that.

## 3. Your weekly five minutes

- Open the live site once; read one article; make sure it looks right.
- Open the control room and glance at "Last run", or, once the Claude editor is switched on (section 5), read its morning note under the repository's Actions tab. Rejections that keep repeating mean a source or a rule needs adjusting; tell Claude what you see.
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

**Step 2 — the easy way.** Open the control room → **Settings** and paste the token into the box at
the top with the GitHub option ticked. It writes both places for you, and you can skip the table
below. The manual way, if you would rather:

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
- **`KHAZENDAR_PROVIDER = claude`** (Settings → *Who writes* on the desk) makes Claude write the
  articles on every three-hourly run — the single biggest quality change available to you — **with
  the free models as the automatic backup**: if the subscription lapses or a limit is hit, that job
  falls back to the free chain by itself and the paper keeps publishing. Every story records which
  model actually wrote it, and the desk shows the last 24 hours' writers. Photo choice always uses a
  free vision model.
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

Open the control room → **Chat** and say what you want in plain language. You do not need to know
which file anything lives in; that is the point of the tab. The list below is only so you recognise
a name when the chat mentions one:

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
