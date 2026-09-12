---
name: خازندار (Khazendar)
description: A classical Arabic economics broadsheet on screen — paper, ink and one banknote green.
colors:
  paper: "#fcfcf9"
  paper-2: "#f3f3ee"
  ink: "#141414"
  ink-2: "#454442"
  ink-3: "#6a6965"
  rule: "#d6d5ce"
  green: "#0f5c3c"
  green-deep: "#0a4530"
  chart-1: "#0f5c3c"
  chart-2: "#2f4f8f"
  chart-3: "#b07a12"
typography:
  display:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(2rem, 1.6rem + 1.6vw, 2.9rem)"
    fontWeight: 700
    lineHeight: 1.3
  headline:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(1.85rem, 1.3rem + 2vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.3
  cover:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(1.85rem, 1.2rem + 2.5vw, 3.1rem)"
    fontWeight: 700
    lineHeight: 1.26
  lead:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(1.6rem, 1.1rem + 1.6vw, 2.3rem)"
    fontWeight: 700
    lineHeight: 1.3
  feature:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(1.22rem, 1rem + 0.7vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.36
  secondary:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "clamp(1.2rem, 1rem + 0.6vw, 1.42rem)"
    fontWeight: 700
    lineHeight: 1.38
  title:
    fontFamily: "Amiri, Naskh, Noto Naskh Arabic, Times New Roman, serif"
    fontSize: "1.12rem"
    fontWeight: 700
    lineHeight: 1.45
  body:
    fontFamily: "Naskh, Noto Naskh Arabic, Amiri, Times New Roman, serif"
    fontSize: "clamp(1.12rem, 1.02rem + 0.35vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.9
  label:
    fontFamily: "Tajawal, IBM Plex Sans Arabic, Segoe UI, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  none: "0"
spacing:
  gutter: "clamp(1rem, 3vw, 2.5rem)"
  col-gap: "clamp(1.25rem, 2.5vw, 2rem)"
  block: "clamp(1.5rem, 3.5vw, 2.75rem)"
  measure: "40rem"
components:
  logo-lockup:
    source: "brand/logo-source.png (owner artwork, traced)"
    lettering: "#0c3c2a"
    key: "#9b8044"
    height: "118px"
  section-bar-link:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    padding: "0.62rem 1.1rem 0.5rem"
  pill:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "0.45rem 0.7rem 0.35rem"
---

# Design System: خازندار
As built on 2026-09-09 from `src/styles/global.css`, `src/components`, `src/pages`, `scripts/brand.mjs` and the r4 screenshots; replaces the 2026-09-07 magazine record. Deviations from the direction contract in `src/layouts/Base.astro` are listed at the end.

## Overview
**Creative North Star: "The Treasurer's Broadsheet"**

خازندار is a classical Arabic daily on screen, played straight: white paper, black ink, one banknote green in the tradition of the green Arabic dailies, rules instead of boxes, Amiri heads over justified naskh columns, photographs in true colour at the width of their column. It implements the brand commitments in PRODUCT.md: the respectable register (serious Arabic press, no playful display faces), the house green as the only colour, the owner's logo (dark-green calligraphic wordmark over a gold key, traced from brand/logo-source.png) used as delivered, and the layout register of a dense news organisation's site rather than a sparse editorial template. The page is flat paper: no shadows, no radius, no colour washes, no generated art; the one ornament is the eight-pointed star hidden in the name.

**Key Characteristics:**
- Paper, ink and one green; green is a field only in the section bar and the ticker label, and ink everywhere else. The logo carries its own two inks, the artwork's dark green (`#0c3c2a`) and gold (`#9b8044`).
- Hierarchy by rule weight (hairline, 1px ink, 3px ink, the 3px-over-1px double rule), never by boxes, fills, shadows or radius.
- Amiri 700 for every head, Naskh for reading and the section bar, Tajawal only for dates, meta and small furniture; Western tabular digits isolated LTR.
- A dense modular front (ticker, top-stories list, lead with two secondaries, today's figures, editor's picks, section rows of four picture cards) and true-colour photographs sized to their column; a story without a licensed photo runs as text.

## Colors
### Primary
- **Banknote Green** (`--green`): the section bar field (hard-coded `#0f5c3c` with `#fcfcf9` text, scheme-invariant), the ticker label, section and module heads with their 3px tabs, meta and source-name links, prose links, the hover colour of headlines and footer links, the focus ring, `::selection`, search `mark`, chart series 1 and `theme-color`. **Deep Green** (`--green-deep`) only colours the section-head link on hover.
- **Chart Slate and Ochre** (`--chart-2`, `--chart-3`): series 2 and 3, separable for colour-blind readers; ochre is ≈3.6:1 on paper, so graphics only. The social avatar square is a one-off `#0b3d28`.
### Neutral
- **Paper** (`--paper`): page ground, text on green, the share-link and search-input ground.
- **Paper 2** (`--paper-2`): only the ticker strip and the ground under a photograph until it loads.
- **Ink** (`--ink`): all text and heads, 1px and 3px rules, the "why it matters" frame, the skip-link field, table header rules.
- **Ink 2** (`--ink-2`): deks, excerpts, blockquotes, the byline, footer text, pill and share text, chart legend and ticks.
- **Ink 3** (`--ink-3`): meta, captions, figure labels, source hosts, notes, the chart baseline.
- **Rule** (`--rule`): every hairline: column rules, list separators, card grids on phones, table rows, pill and share borders.
### Dark scheme
`prefers-color-scheme: dark`, no toggle: paper `#171716`, paper-2 `#1f1f1d`, ink `#ebeae4`, ink-2 `#c6c5bd`, ink-3 `#9a9992`, rule `#353532`, green `#67c096`, green-deep `#8ad3b0`, chart `#5dbb8d` / `#7f9ee6` / `#dcaa3d`. Fixed in both schemes: the section bar (`#0f5c3c` / `#fcfcf9`; hover `rgba(255,255,255,.12)`, current `.08`), the logo's gold key, the social cards and the avatar; the logo's lettering swaps from `#0c3c2a` to paper via `<picture>` in dark.
### Named Rules
**The One Green Rule.** Green marks navigation, section names, links, hover and the brand; it never sets a headline, prose or a background beyond the three fields above.
**The Contrast Floor.** On paper: ink ≈17.9:1, ink-2 ≈9.5:1, ink-3 ≈5.3:1, green ≈7.8:1 (paper on green the same); in dark, ink-3 ≈6.3:1 and green ≈8.2:1. Nothing lighter than ink-3 carries text.

## Typography

The page has a descending headline scale, and the gaps between the steps are what make the front page readable: cover 3.1rem, section-page lead 2.3rem, block feature 1.5rem, secondary 1.42rem, hub title 1.28rem, card 1.12rem, brief 1.02rem. The cover is about 2.8x a card, the ratio a front page needs; at 2.1rem it was 1.9x and the squint test found no primary element at all. Below the headline steps sits a furniture micro-scale in Tajawal and Naskh (0.75, 0.78, 0.8, 0.82, 0.86, 0.95, 0.98, 1.02, 1.05rem) for meta lines, summaries, ticker items and module labels.
**Display/Title Font:** Amiri 400 and 700 (fallback Naskh, Times New Roman, serif)
**Body Font:** "Naskh" = Noto Naskh Arabic variable 400–700 (fallback Amiri, serif)
**Label Font:** Tajawal 400/500/700/800 (fallback IBM Plex Sans Arabic, Segoe UI, system-ui)

**Character:** literary naskh for reading under a bold classical head, with a plain sans confined to the furniture. Self-hosted woff2 in `/fonts`, Arabic and Latin subsets by `unicode-range`, `font-display: swap`; Naskh, Amiri 700 and Tajawal 500 are preloaded. Root 16px, line-height 1.8, `kern liga calt`; every h1–h4 is Amiri 700, line-height 1.4, `text-wrap: balance`, `overflow-wrap: anywhere`.
### Hierarchy
| Role | Face | Size | Line-height |
|---|---|---|---|
| Page title (`.page-title`) | Amiri 700 | `clamp(2rem, 1.6rem + 1.6vw, 2.9rem)` | 1.3 |
| Article title | Amiri 700 | `clamp(1.85rem, 1.3rem + 2vw, 2.75rem)` | 1.3 |
| Cover story title | Amiri 700 | `clamp(1.85rem, 1.2rem + 2.5vw, 3.1rem)` | 1.26 |
| Section-page lead title | Amiri 700 | `clamp(1.6rem, 1.1rem + 1.6vw, 2.3rem)` | 1.3 |
| Block feature title (front) | Amiri 700 | `clamp(1.22rem, 1rem + 0.7vw, 1.5rem)` | 1.36 |
| Secondary / hub title (front) | Amiri 700 | `clamp(1.2rem, 1rem + 0.6vw, 1.42rem)` / 1.28rem | 1.38 |
| Section head / module head / rail heads (الأرقام, اقرأ أيضاً, المصادر, لماذا يهمّ) | Amiri 700, green for the first two | 1.35 / 1.15 / 1.2–1.3rem | 1.3 |
| Card / list / text / picks titles | Amiri 700 | 1.12 / 1.02 / 1.05 / 1.02rem | 1.45 |
| Dek / page intro | Naskh 400, ink-2 | `clamp(1.1rem, 1rem + 0.4vw, 1.3rem)` / 1.12rem | 1.7 / 1.75 |
| Lede | Naskh 700, justified | `clamp(1.18rem, 1.08rem + 0.4vw, 1.35rem)` | 1.8 |
| Prose | Naskh 400, justified, `text-align-last: start` | body size; h2 1.35em, h3 1.15em, blockquote Amiri 1.15em on a 1px ink start rule | 1.9 |
| Key figure value | Amiri 700, tabular | 1.4rem rail / 1.25rem front | 1.25 |
| Section bar / ticker items | Naskh 700 | 1rem (0.92 ≤719px) / 0.95rem | 1.4 |
| Meta, captions, labels, notes, chips | Tajawal 500 (chips 700–800), ink-3 | 0.86rem; card meta 0.8, captions 0.82, hosts 0.78, ticker label 0.78, picks numerals 1.3 | 1.5 |

Measure: `--measure` 40rem for prose, lede, facts, chart, table, why box and sources; article head 52rem, dek 44rem, page intro 40rem, footer note 34rem.
### Named Rules
**The Furniture Rule.** Tajawal never sets a headline, a summary or a sentence of prose; it sets dates, meta, captions, labels, chips, table cells and chart text.
**The Isolated Figure Rule.** Digits are Western and tabular (`.num`, `time`, `.ui`, figure values); `isolateNumbers()` wraps each figure with its sign and % in `<bdi dir="ltr">` and turns a leading hyphen into U+2212. Dates read "الأربعاء 9 سبتمبر 2026", short "7 سبتمبر", time "22:25 بتوقيت الرياض"; relative times "الآن / قبل 3 ساعات / أمس / قبل يومين / قبل 5 أيام", then a date; the issue number is days since 2026-09-07 + 1.

## Layout
Containers: `.wrap` = `min(1240px, 100% − 2 × gutter)`, `.wrap--article` 68rem; page blocks `padding-block: clamp(1.5rem, 3.5vw, 2.75rem)`. Columns never use gaps: `column-gap: 0`, each column padded by `--col-gap` and divided by a 1px `--rule` (`.cols`, the front, the article rail). Breakpoints, all `max-width`: 1023px (tablet), 719px (phone), plus 599px (`.cols` to one column); at 719px `.cards` becomes one ruled column of thumbnail rows.

- **Front page** (`index.astro`): the market strip → the latest-headlines strip (`Ticker.astro`: the newest stories not already on the first screen) → the cover (`Cover.astro`; beside the stage, ruled, قراءات خازندار: one reading of each kind, the latest analysis at 1.22rem with its dek and time, then the latest explainer and paper reading at 1.05rem each with a one-line dek and no time, so the column reads as three different things, then the market box): still, as fifteen of sixteen major sites set theirs. `9fr | 3fr`: the lead (headline first in the reading direction, kicker above, dek, meta, beside a 3/2 photograph, `5fr | 7fr`) and, ruled beside it, the next four strongest stories as a thumbnail list (5.5rem square, kicker, title, time), all visible at once; closed by a 3px ink rule. No rotation, no tabs, no dots: the carousel research (NN/g, Baymard) and the majors' practice both refuse it → `4fr | 5fr | 3fr`: أيضاً في الأخبار (5 list cards) at the start; two secondaries at 1.42rem laid out like every feature (text `5fr`, photograph `6fr`, ruled between) over مختارات المحرر (4 unnumbered titles on hairlines) in the centre column ruled on both sides; أحدث الرسوم البيانية (the freshest chart of the last three days, compact, its title linking to the story and a من مادة line naming it) over أرقام اليوم (4 figures, each with its label and the headline it comes from) at the end → ملفات نتابعها (`Dossiers.astro`): up to four running topics in ruled columns, each the topic name in green Amiri, a count and last-update line, three dated headlines (never the same headline in two files) and a link to the file, the head linking to /tags/, and a بحسب المنطقة line of region links with counts beneath → one block per news section with stories (economy, markets, energy, companies, technology, defense), alternating two shapes so no block repeats its neighbour: a `.section-head` then `7fr | 5fr`, the section's feature at 1.5rem laid out horizontally (text `5fr`, photograph `6fr`) beside up to three thumbnail briefs on a ruled list; then a `.cards` row of up to four picture cards → تحليلات and شروح, when they have anything, as text bands: `.cols` of up to four `card--text` items (1.28rem Amiri title, Naskh excerpt), which tells the reader at a glance these are argument and concept pieces. Blocks are separated by `clamp(2.25rem, 4.5vw, 3.75rem)` against roughly 0.7rem inside a group. ≤1023px the columns become `7fr | 5fr` with the centre column first across both (secondaries two-up), the files band two columns, the blocks stacked; ≤719px the cover puts the photograph on top and its tabs become a snapping strip of headline tabs (74% wide each, the active one scrolled into view without moving the page), secondaries and section features run as 7.5rem thumbnail rows, files show two headlines each. A photograph prints once per page: the first card carrying it shows it, later cards run as text. Every story is placed once; the front is the only page whose الرئيسية link is marked current.
- **Section page**: page head → `8fr | 4fr`: the lead (16/9 photo, `lead` card) beside a ruled list of the next three stories → 3px ink rule → `.cards` rows for the rest (a list when fewer than three remain).
- **Article**: head max 52rem (title, dek, meta on a hairline, share row) → figure at story width, 2/1 crop (3/2 ≤719px) → `1fr | 17rem`: main (lede, inline facts ≤1023px, chart, prose, table, why box, tags, sources) and a rail with a 1px start rule (side facts, اقرأ أيضاً); ≤1023px the rail stacks beneath.
- **Footer**: double rule → `2fr 1fr 1fr` (brand, sections, about) → hairline → licence lines; ≤719px two columns with the brand across both.

## Elevation & Depth
Flat paper. No `box-shadow`, no gradient (the ticker scrolls horizontally with a hidden scrollbar and snaps per headline), no tonal layering beyond `--paper-2` under the ticker and under a loading photograph. Depth is rule weight: hairline `--rule` between items and columns; 1px ink under module and footer heads and table headers; 3px ink to open a page head, a section grid, key figures, sources, the related rail and the stacked lead; the double rule (3px over 1px, 2px apart) for the footer and the social cards. Motion is 0.15–0.2s colour and border transitions on `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; there are no animations, and `prefers-reduced-motion` collapses every transition to 0.01ms.

## Shapes
Every corner is square (`border-radius: 0`, explicit on the search input). Photographs are hard-edged rectangles at fixed ratios: 16/9 (cards, lead), 1/1 (list thumbnails, 5.5rem), 2/1 (article figure; 3/2 on phones), 3/2 (`Photo` default). Chips are 1px `--rule` rectangles; the only frame is the 1px ink box of لماذا يهمّ. The brand geometry is the owner's: the traced lettering (`#0c3c2a`) and the gold key (`#9b8044`) on its rule; the favicon and app icons clip the key's ornate bow onto a 100-unit `#0f5c3c` square.

## Components
Character: newsprint furniture, restrained; state is shown by turning text green or a border to ink, never by fills, lifts or motion.
### Masthead and brand
- **Top line (`Masthead.astro`):** Tajawal 500 0.84rem ink-2 on a hairline: weekday date · "العدد N" at the start, a 16px magnifier + "بحث" at the end (ink, green on hover). An inline script rewrites the date, issue number and every `time[data-relative]` each minute so a static build stays current.
- **Brand:** the owner's logo centred at 118px tall (72px ≤719px) as a cached `<picture>`: `/logo.svg` (dark-green lettering) and `/logo-dark.svg` (paper lettering) chosen by `prefers-color-scheme`, alt "خازندار — الاقتصاد بلغة واضحة", padding `clamp(0.8rem, 2vw, 1.15rem)`.
- **Section bar:** the one green field: links Naskh 700 `#fcfcf9` on `#0f5c3c`, padding 0.62rem 1.1rem 0.5rem, centred (start-aligned and scrollable ≤719px, scrollbar hidden); hover white 12% tint; `aria-current="page"` a 3px `#fcfcf9` underline plus 8% tint; focus outline `#fcfcf9` inset 3px. Order: الرئيسية, then the six sections.
- **Market strip (`MarketStrip.astro`):** on every page between the section bar and the ticker, paper ground under a hairline, 2.1rem tall: a green "الأسواق" label (Tajawal 800 0.78rem, a link to the board) then eight instruments on hairline dividers, each its short name (Tajawal 700 ink) and its move on the day (Tajawal 700, `--up` green or `--down` red with a small ▲/▼), the level in the tooltip, "حُدّث منذ …" at the end (hidden ≤719px). Overflow scrolls with a hidden scrollbar. Sized so the eight fit one line at 1240px.
- **Market board (`MarketBoard.astro`):** a compact ruled quote table under a `.module__head`: name Naskh 700 0.95rem (over a Tajawal 0.72rem note, country or unit, in the group variant), level and move Tajawal tabular, numbers isolated LTR, the quote's time in the row tooltip. The `box` beside the cover lists five instruments with a "لوحة الأسواق كاملة · حُدّثت منذ …" foot. Stale rows print their numbers in ink-3.
- **Quote card (`QuoteCard.astro`):** name, note, the level at 1.28rem beside its move, and a 96×28 sparkline of the last month's closes (1.5px line in the day's direction colour) at the end. Six of them make the الأسواق في لمحة band on the markets section (under the lead block, before the rest of the stories, ruled columns 6 / 3 / 2) and the headline row of the data page.
- **Data page (`markets/data.astro`, /markets/data/):** a `.page-head` with the delayed-data notice, the six headline cards on a 3px ink rule, then five group tables (الأسواق العربية, الأسواق العالمية, العملات, السلع, السندات والأصول الرقمية) three across in ruled columns (2 / 1 on smaller screens), a source note, and من أخبار الأسواق (four cards). A section never opens with tables: the data has its own page and the section opens with news. `--up` (`#0f5c3c`, dark `#67c096`) and `--down` (`#a3271f`, dark `#e2796d`) are the one functional colour pair on the site; nothing else is red.
- **Ticker:** `--paper-2` strip 2.4rem tall under a hairline, green "الأحدث" label (Tajawal 800 0.78rem), five latest headlines Naskh 700 0.95rem each preceded by a green relative time, in a horizontal scroll strip (hidden scrollbar, `scroll-snap-type: x proximity`).
- **Logo (`Logo.astro`; `scripts/brand.mjs` traces `brand/logo-source.png` into `src/lib/brand.ts` and `public/`):** the owner's artwork, the wordmark خازندار in heavy dark-green calligraphy (`#0c3c2a`) over the treasurer's key in gold (`#9b8044`) on a thin gold rule, used as delivered and never redrawn. The trace (potrace, even-odd fill) crops to the ink (1431×641 units) and yields `logo.svg`, `logo-dark.svg` (paper lettering, gold key), the favicon and touch icons (the key's bow clipped onto a `#0f5c3c` square), `avatar.png` (dark green `#0b3d28`, paper lettering) and the social cards.
- **Social cards:** paper 1200×630 with 3px+1px double rules top and bottom at an 80px margin. `og-default.png` centres the logo 660 wide; a photo-less story's `/og/{slug}.png` sets the logo 104 tall at the right margin, the section name Amiri 400 30px green at the left margin, a 1px rule, the headline Amiri 700 58px on 87px leading up to three lines, and the date Amiri 26px ink-3. Stories with a photo use the photo.
### Story cards and photographs
- **Variants (`StoryCard.astro`):** `lead` (16/9 photo, 200-char summary Naskh 1.05rem/1.7), `card` (16/9 photo above, optional 120-char summary 0.98rem), `list` (row, 5.5rem square photo at the start), `text` (no photo). Meta: section link in green ("شرح" for explainers) + relative time; `showPhoto=false` drops the picture entirely.
- **States:** the title link has no underline and turns green on hover; the photo link is `tabindex="-1" aria-hidden`, so a story is one tab stop. In lists cards sit on hairlines with `padding-block 0.7rem`.
- **Photograph (`Photo.astro`):** true colour, `object-fit: cover` at the column's width and the variant's ratio, `--paper-2` ground until loaded, `loading="lazy"` except the lead and article figure (`eager`, `fetchpriority="high"`), `sizes` per placement, `referrerpolicy="no-referrer"`. Renders nothing without a licensed image. Article caption: Tajawal 0.82rem ink-3, alt at the start and "الصورة: credit" linked to the Commons page at the end, hairline beneath.
### Article furniture and data
- **Key figures (`KeyFacts.astro`):** 3px ink top and 1px ink bottom rule, "الأرقام" Amiri 1.2rem, values Amiri 700 1.4rem tabular over Tajawal 0.86rem ink-3 labels, hairlines between; `side` shows in the rail ≥1024px, `inline` (auto-fit 9.5rem columns, 1rem column gap) below it.
- **Sources (`Sources.astro`):** 3px ink rule, "المصادر" Amiri 1.3rem; per item the source name Tajawal 700 0.86rem green, the linked title Naskh 1rem in `<bdi>` (1px underline, offset 0.2em), host `bdi dir="ltr"` + short date Tajawal 0.78rem ink-3; then the automation note and model list Tajawal 0.86rem ink-3. External links `noopener nofollow`.
- **Why it matters (`.why`):** 1px ink frame, padding 1rem 1.25rem, Amiri 1.2rem head, Naskh 1.08rem justified.
- **Chart (`Chart.astro`):** static SVG 720×380 (`direction="ltr"`, padding 28/24/56/64), bar or line, in a figure with a 1px ink top and hairline bottom; Amiri 1.18rem title, Tajawal 0.82rem unit, legend with 0.8rem square swatches for two or more series; gridlines `--rule`, zero baseline ink-3, labels Tajawal 12px (21px ≤719px, where the SVG shrinks); bars fill 72% of a slot, lines 2px with 4.5px paper-stroked dots; value labels for a single series of ≤8 points, end labels for ≤3 series; every mark has a native `<title>` tooltip and darkens 15% on hover; a `<details>` "عرض البيانات كجدول" table and a Tajawal 0.78rem source line follow.
- **Table (`DataTable.astro`):** Amiri 1.18rem caption, horizontally scrollable box with a 3px ink top, Tajawal 0.92rem, 1px ink under the header row, hairlines between rows, numeric cells tabular and unwrapped, source line beneath.
### Chips, heads and page furniture
- **Pill (tags):** Tajawal 500 0.86rem ink-2, 1px `--rule` border; hover/focus turns border and text ink. **Share (`Share.astro`):** "شارك" label, then واتساب / إكس / تيليغرام / فيسبوك links and a "نسخ الرابط" button (reads "تم النسخ" for 2s): Tajawal 700 0.8rem ink-2 on paper, 1px `--rule` border, padding 0.42rem 0.65rem 0.32rem; green border and text on hover.
- **`.section-head`:** hairline row; the section name Amiri 700 1.35rem green as a tab whose 3px green underline overlaps the hairline; "المزيد من …" Tajawal 700 0.82rem ink-2 at the end, green underlined on hover. **`.module__head`** (global): Amiri 700 1.15rem green over a hairline with a 3.5rem × 3px green tab at the start; the one device for every labelled block on the site, on the front's modules, the article's الأرقام, لماذا يهمّ, المصادر and اقرأ أيضاً, the footer's columns and the files index's regions. The 3px ink rule is reserved for page heads and the close of the cover; لماذا يهمّ is a rule-bottomed block, not a frame. **`.page-head`:** 3px ink top rule, display title, Naskh 1.12rem ink-2 intro.
- **Files index** (`tags/index.astro`): a `.page-head`, then every topic with two or more articles in three ruled columns (name in green Amiri, count and last update, the latest headline with its date), ranked as the front ranks them, then بحسب المنطقة as a `.module__head` block of region links with counts.
- **Kicker** (`.kicker`, global): the story's topic (its most-shared non-region tag) in Tajawal 700 0.78rem green above the headline, linking to the topic's file, on the cover, the secondaries, the block features, the section-page lead and the article page; never on thumbnails or briefs. Relative times read منذ ساعة / منذ 3 ساعات / منذ يوم / منذ يومين; the article meta line reads نُشر with date and Riyadh time.
- **اقرأ أيضاً in the text** (`.also`): a ruled line (1px ink above, hairline below) carrying the label in green Tajawal and one related headline in Amiri, moved after the third paragraph by an embedded script on articles of five paragraphs or more; without JavaScript it stands at the end of the text. The rail's اقرأ أيضاً list and the closing المزيد من القسم row remain.
- **Topic file** (`tags/[tag].astro`): a `.page-head` with the topic as the title and a count/last-update intro, then a chronological thread newest first: a 7.5rem date column (Tajawal 700 ink-2, the time beneath in ink-3) ruled on its inline end, every item a list card with its excerpt and no relative time (the margin carries the date), the first with a 10rem thumbnail and a feature-size title, hairlines between items, a كل الملفات link in the intro. A topic with one article says so plainly.
- **Search (`search.astro`):** input Naskh 1.3rem on paper, no border but a 2px ink bottom rule that turns green on focus (outline suppressed); results max 46rem on hairlines, titles Amiri 1.2rem, excerpts Naskh 1rem ink-2, `mark` green bold without background, count and hints Tajawal ink-3 in an `aria-live="polite"` region.
- **Skip link:** "انتقل إلى المحتوى", ink field, paper text, Tajawal 700, off-screen at `top: -4rem`, shown at 1rem on focus.
- **Footer (`Footer.astro`):** double rule, wordmark in green with the tagline Amiri 1.05rem ink-2 and a Naskh 0.98rem/1.8 note (max 34rem); column heads Amiri 1.1rem on a 1px ink rule; links Naskh 1rem ink-2, green underline on hover; RSS with a 13px icon; licence and error lines Tajawal 0.8rem ink-3 on a hairline.

## Do's and Don'ts
### Do:
- **Do** open every page region with a rule, not a box: 3px ink for a head or grid, a hairline between items, the double rule only for the footer and social cards.
- **Do** set heads in Amiri 700, reading text in Naskh justified with `text-align-last: start` at 40rem, and furniture in Tajawal.
- **Do** print photographs in true colour at their column's width and ratio, credit them in the caption, and print each picture once per page; a story without a licensed photo runs as text.
- **Do** isolate every figure in `<bdi dir="ltr">` with Western tabular digits, pan-Arab months and Riyadh time.
- **Do** show state by colour alone (green text on hover, ink or green border on chips, a `#fcfcf9` underline for the current section) and keep the section bar at `#0f5c3c` / `#fcfcf9` in both schemes; the logo swaps to paper lettering in dark.
- **Do** keep sources, the automation note and the model list under a 3px ink rule on every article.
### Don't:
- **Don't** add a colour field beyond the section bar and the ticker label, or tint, wash or duotone a photograph.
- **Don't** add shadows, radii, gradients or animation; transitions stay at 0.15–0.2s.
- **Don't** use generated, stock or illustrative art; the typographic social card is the only substitute for a missing photo.
- **Don't** set a headline, summary or prose in Tajawal, put a kicker above a headline, reintroduce hand-lettered or playful display faces, or redraw the logo; the logo is the owner's artwork.
- **Don't** put text in `--chart-3` ochre or any colour lighter than ink-3.

## Accessibility and RTL
- `lang="ar" dir="rtl"`, logical properties throughout (`inset-inline-start`, `padding-inline`, `border-inline-start`); `bdi { unicode-bidi: isolate }`; Latin hosts, model names and figures isolated LTR; chart SVGs are `direction="ltr"` with category labels `direction: rtl; unicode-bidi: plaintext`.
- `color-scheme: light dark`, `theme-color #0f5c3c`. Focus: `:focus-visible` 2px green outline offset 3px (brand link 4px; inside the section bar a `#fcfcf9` outline inset 3px). Selection green on paper. Skip link to `#main`.
- Keyboard: one tab stop per story (photo links `tabindex="-1" aria-hidden`); nav `aria-current="page"`; modules and rails `aria-labelledby`; charts `role="img"` with `aria-label`, native `<title>` tooltips and a table view; search results `aria-live="polite"`.
- Reduced motion collapses transitions to 0.01ms; there is nothing else to pause.

## Deviations from the direction contract (Base.astro, 2026-09-09)
1. **Green as field.** The `:root` comment in `global.css` still says green is "ink only"; the build fills the section bar and the ticker label with it, and the favicon is a green square.
2. **The logo.** Recorded here as built on 2026-09-09 evening: the owner's artwork replaced the generated plate; the r4 captures referenced above still show the plate-era masthead.
3. **The first viewport.** The contract was revised on 2026-09-09 evening to the built front (logo, green section bar, headline strip, the three-column front); no deviation remains.
4. **Rules instead of boxes.** لماذا يهمّ is a 1px ink frame, and tags and share links are bordered chips.
