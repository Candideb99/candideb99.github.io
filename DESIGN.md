# DESIGN.md — خازندار visual system, as built

As-built record from `global.css`, the components, pages, `cover.ts` and the built screenshots (2026-09-07). Contract seed 6923a822; deviations from it are flagged inline.

## 1. Direction

خازندار is a daily issue, not a feed: a mid-century Cairo illustrated magazine on the web — flat spot-colour fields, classical Arabic display, naskh reading text, one-colour halftone plates. The register is user-pinned respectable and cultured: Amiri for display and titles, Noto Naskh for reading, Tajawal only for furniture. It refuses the cream broadsheet with gold hairlines, the black terminal with neon figures, hand-lettered or playful display faces, kickers, and scattered accents.

## 2. Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#fbfaf6` | `#15140f` | page ground |
| `--paper-2` | `#f2efe7` | `#1d1b16` | tinted blocks, key-figure and "why" boxes, natural-photo ground, dark footer |
| `--paper-3` | `#e7e2d6` | `#2a2721` | deeper tint, unused as built |
| `--ink` | `#171512` | `#efeade` | text, 3px rules, ink fields (footer, "why" chip, skip link) |
| `--ink-2` | `#4b463f` | `#cdc6b7` | deks, summaries, key-figure labels |
| `--ink-3` | `#75706a` | `#9d968a` | meta, captions, hosts; `#66615a` / `#a8a194` inside `.block--tint` |
| `--rule` | `#dad5c9` | `#34302a` | 1px hairlines |
| `--saffron` | `#e5a52b` | `#e9ad3c` | brand field: masthead band, focus ring, selection, search `mark`, footer wordmark and heads |
| `--saffron-deep` | `#c98c15` | `#d99a22` | defined, unused |
| `--saffron-ink` | `#6b4a08` | `#f0c669` | dark only: the Home nav link |
| `--on-spot` | `#fbfaf6` | same | text on any field |

Section inks live on `[data-section]` (root defaults to economy). `--spot` is the flat field and never changes with the scheme; `--spot-ink` is section text on paper, lifted in dark; `--spot-deep` is a field carrying paper text, so scheme-invariant.

| Section | `--spot` | `--spot-ink` light | `--spot-ink` dark | `--spot-deep` |
|---|---|---|---|---|
| economy الاقتصاد, cobalt | `#1f47b8` | `#122a70` | `#8fa6ee` | `#122a70` |
| markets الأسواق, vermilion | `#d64524` | `#8c2a14` | `#f19077` | `#8c2a14` |
| energy الطاقة, teal | `#0f7d6f` | `#0a5248` | `#6fd0c1` | `#0a5248` |
| companies الشركات, plum | `#7a2e6f` | `#4d1c46` | `#d78ccb` | `#4d1c46` |
| technology التكنولوجيا, cyan | `#1b7fa8` | `#11536e` | `#7fc6e6` | `#11536e` |
| explainers شروح, ochre | `#9a6b13` | `#63450c` | `#e0b459` | `#63450c` |

**Committed strategy.** One hue per context, applied whole: paper stays neutral; a section's colour arrives as a full flat field or as its ink on text, never as a tint, wash, border or icon accent; the only gradient is the cover scrim. Colour may sit in fields (band, cover, plates, chips, footer), in section ink on section heads, page titles, meta links, contents numerals, key-figure values, prose links and blockquotes, source names, the current nav link and tag pills, and as one saffron cut-out per cover art. It may not sit in prose, article or card titles (ink), hairlines (`--rule`), 3px rules (ink; only section heads take `--spot`) or behind prose beyond `--paper-2`. Dark keeps every field, lifts the inks and turns the footer into `--paper-2`; band text and cover art are hard-coded (`#171512` on saffron; `#fbfaf6` / `#171512` / `#e5a52b` in `cover.ts`) and never shift.

## 3. Typography

Three self-hosted families in four roles (`/fonts`, `font-display: swap`; naskh, Amiri 700 and Tajawal 700 preloaded): display and title (`--font-display` = `--font-title`) Amiri 400 / 700; body (`--font-body`) "Naskh" = Noto Naskh Arabic variable 400–700; UI (`--font-ui`) Tajawal 400 / 500 / 700 / 800. Root 100%, line-height 1.85; headings 700, line-height 1.45, `text-wrap: balance`.

| Role | Face | Size | Line-height |
|---|---|---|---|
| Wordmark | Amiri 700 | `clamp(3rem, 2.2rem + 3.8vw, 4.9rem)` | 1.15 |
| Page title / section head | Amiri 700, `--spot-ink` | `clamp(2.2rem, 1.8rem + 2.2vw, 3.4rem)` / `clamp(1.5rem, 1.2rem + 1.2vw, 2.1rem)` | 1.3 |
| Cover title | Amiri 700 | `clamp(1.75rem, 1.2rem + 2.3vw, 3rem)`; ≤719px `clamp(1.7rem, 1.2rem + 3vw, 2.2rem)` | 1.4 |
| Article title | Amiri 700, ink | `clamp(1.85rem, 1.3rem + 2.4vw, 3rem)` | 1.28 |
| Card titles tile / row / text / contents | Amiri 700 | 1.42 / 1.22 / 1.25 / 1.22rem | 1.45 |
| Deks cover / article | Amiri 400 | `clamp(1.05rem, .95rem + .5vw, 1.3rem)` / `clamp(1.15rem, 1rem + .6vw, 1.4rem)` | 1.6 / 1.65 |
| Lede | Naskh 700 | `clamp(1.25rem, 1.1rem + .5vw, 1.45rem)` | 1.8 |
| Prose | Naskh 400 | `clamp(1.15rem, 1.05rem + .4vw, 1.3rem)`; first paragraph 1.06em; h2 1.45em; blockquote Amiri 400 1.25em `--spot-ink` | 1.95 |
| Meta | Tajawal 500, `--ink-3` | 0.9rem (article 0.95, contents 0.85) | — |
| Key-figure value / label | Amiri 700 / Tajawal 500 | 1.55 / 0.92rem | 1.15 / 1.4 |

Measure: `--measure` 42rem for prose and the article column; article head 56rem, dek 46rem, cover dek 38rem.

Digits: Western 0–9, `tabular-nums lining-nums` on `.ui`, `time`, `.num` and key-figure values. Every figure (sign, digits, `.` `,`, optional %) is wrapped in `<bdi dir="ltr">` — `isolateNumbers()` for titles, deks, summaries and facts, `rehype-isolate-numbers.mjs` for Markdown (skipping code, pre, bdi, svg); a leading hyphen becomes U+2212. Figures take the face of their context; deviation: the contract's "Tajawal figures" holds only for furniture, key-figure values are Amiri and prose figures Naskh.

Dates (`format.ts`): pan-Arab months (يناير … ديسمبر), Arabic weekdays — "الاثنين 7 سبتمبر 2026", short "7 سبتمبر", 24-hour Asia/Riyadh time "بتوقيت الرياض", relative "الآن / قبل 3 ساعات / أمس / قبل 5 أيام" then a date.

## 4. Layout

- `.wrap` = `min(1240px, 100% − 2 × gutter)`, `--gutter: clamp(1rem, 3vw, 2.5rem)`; blocks `padding-block: clamp(1.75rem, 4vw, 3.25rem)`.
- `.grid--stories`: 12 columns, gap `clamp(1.25rem, 2.5vw, 2rem)`; children span 12, `span-3/4/6/8` from 720px, `lg-span-3…8` from 1024px. Section block = tile `span-6 lg-span-5` + row list `span-6 lg-span-7`, odd blocks flipped (`order: 2`) at ≥1024px. Count-based `spanFor(n)`: 1 → `span-12 lg-span-8`, 2 → `span-6`, ≥3 → `span-6 lg-span-4`, so a lone story or a pair fills its row. Section page: lead `span-12 lg-span-8` (3/2), rail `span-12 lg-span-4`, rest `span-6 lg-span-4`.
- Issue: saffron band → section strip → `.issue` grid `2fr 1fr` (cover + "في هذا العدد", six stories) → a block per news section with ≥2 stories (max five) → "أيضاً في هذا العدد" gathering single-story sections → explainers on `--paper-2` (max three) → footer.
- Article: head (56rem) → full-wrap figure → grid `minmax(0,1fr) 18rem`, gap `clamp(1.5rem, 4vw, 4rem)`, main capped at 42rem, rail with sticky key figures (`top: 1rem`) and "اقرأ أيضاً"; at ≤1023px it stacks, side figures hide and inline figures (auto-fit `minmax(10rem, 1fr)`) precede the prose.
- Breakpoints: ≤719px (masthead reflow, nav edge fade, cover text below the plate, footer two columns, art plate 2/1); ≥720px spans; ≤1023px single column; ≥1024px lg spans and alternation.

## 5. Components

- **Masthead**: saffron band, grid `1fr auto 1fr`: issue number and date (Tajawal, `#171512` / `#4a3a12`), centred wordmark and Amiri 400 tagline, search link with a 2px hover underline; ≤719px the brand takes its own row.
- **Nav**: paper strip, `--rule` border, scrollable; Tajawal 700 links whose 4px underline and text take their own section's `--spot` / `--spot-ink` on hover and `aria-current`; Home uses ink (saffron in dark).
- **Cover (Lead)**: section field, `--shadow`, eager 16/10 plate, headline lettered at the bottom over a `--spot-deep` scrim; contents beside it under a 3px ink rule, numerals (Tajawal 800, 1.55rem) in each item's section ink.
- **Story card**: `tile` (4/3 plate above, summary ≤150 chars), `row` (1/1 plate 5.75rem beside text), `text` (hairline top, no plate); the plate link is `tabindex="-1" aria-hidden`, the title underlines 2px in `--spot` on hover.
- **Plate**: duotone photo by default, `.plate--art` for cover art, `.plate--photo` for natural colour.
- **Key figures**: `--paper-2` box, "الأرقام" chip on `--spot-deep`, values Amiri 700 in `--spot-ink`; `side` (sticky rail) or `inline`.
- **Sources and disclosure**: 3px ink rule, "المصادر", source name (Tajawal 800, `--spot-ink`), linked title in `bdi`, host `bdi dir="ltr"` and date, external links `noopener nofollow`; then the note in Tajawal 0.9rem `--ink-3` (written automatically from these sources only, verified independently, the original prevails) and the model list.
- **Section head**: 3px `--spot` rule, Amiri head in `--spot-ink`, Tajawal description, "كل مواد … ←".
- **Chips and pills**: chips Tajawal 800 ~0.85rem on `--spot-deep` or ink (`.label`, `--radius` unused); `.pill` 1.5px ink border, `.pill--spot` for tags, filled with `--spot` on hover.
- **Footer**: ink field, paper text (dark: `--paper-2`), saffron wordmark 2.4rem and heads, `2fr 1fr 1fr`, 0.82rem licence and error note.

## 6. Imagery

Commons photos print as one-colour duotone plates: `grayscale(1) contrast(1.08) brightness(1.04)` with `mix-blend-mode: multiply` on the section's `--spot` ground under a `::after` halftone (white 0.8px dots, 5px cell, `soft-light`); until a lazy photo loads the plate is the bare field. On hover-capable devices `a:hover` / `a:focus-visible` on the wrapping link drops the filter over 0.6s, revealing colour. The article figure is `natural` (`.plate--photo`): true colour on `--paper-2`, 16/9, alt and "الصورة: credit" linked to the Commons page. Deviation: the contract's "full-colour" cover is built as the duotone or art plate.

Without a photo, `cover.ts` draws procedural cover art: a 1200×750 SVG, `preserveAspectRatio="xMidYMid slice"`, so every ratio (16/10, 4/3, 1/1, 3/2, 3/1, 2/1) is a centre crop of one composition, seeded by an FNV-1a hash of the slug so a story always gets the same cover. Grammar on the `--spot` ground: one paper **anchor form** (disc, quarter, arch, wedge, bars) on one side; one **ink accent** (`#171512` dot, ring, rotated line or square) opposite; one small **saffron cut-out** (circle or bar); a **halftone screen** (9–13 unit cell, paper dots at 0.55 opacity) over one quadrant. Colours are constants; the SVG is `aria-hidden`.

## 7. Motion

One authored moment: the cover prints. `print-field` wipes the cover in from the top (`clip-path: inset(0 0 100% 0)` → `inset(0)`) over 0.7s with `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; title, dek and meta `settle` (fade, 10px rise) over 0.6s at 0.35 / 0.45 / 0.55s. All inside `prefers-reduced-motion: no-preference`; reduced motion gets a static cover and `scroll-behavior: auto`. Otherwise only hover transitions: plate 0.6s, nav and pills 0.2s.

## 8. States and accessibility

- Focus: `:focus-visible` 3px `--saffron` outline at 3px offset; inside `.band` it turns `#171512` to survive the saffron field. Selection is saffron on `#171512`.
- Contrast (computed): ink on paper ≈ 17:1; `--ink-3` ≈ 4.7:1, so `.block--tint` darkens it to `#66615a` (≈ 5.3:1 on `--paper-2`); paper on every `--spot-deep` ≥ 8:1; `#171512` on saffron ≈ 8.5:1, `#4a3a12` ≈ 5.1:1; dark: `--ink-3` ≈ 6.3:1, lifted section inks ≥ 7:1. Dark rule: fields fixed, inks lifted, `--spot-deep` and `--on-spot` constant.
- RTL: `lang="ar" dir="rtl"`, logical properties throughout, `bdi { unicode-bidi: isolate }`, figures isolated LTR, Latin hosts and model names in `bdi dir="ltr"`.
- Skip link "انتقل إلى المحتوى" to `#main`, hidden at `top: -4rem`, shown at 1rem on focus; `aria-labelledby` on sections, `aria-live="polite"` results, `color-scheme: light dark`, `theme-color #e5a52b`.
- Live timestamps: an inline script refreshes every `time[data-relative]` each 60s on the `timeAgo` scale and rewrites the masthead date and issue number (days since launch 2026-09-07 + 1, Asia/Riyadh) on load, so a static build stays honest between deploys.

## 9. Do / Don't

1. Do set display and titles in Amiri 700 and body in Naskh; never reintroduce hand-lettered or playful display faces.
2. Do keep Tajawal to furniture: chips, meta, nav, pills, dates, issue numbers.
3. Don't put a kicker above a heading; the meta line and the field colour state the section.
4. Do commit colour to fields and section inks; don't scatter accents, tints, gradients or coloured hairlines.
5. Do keep `--spot` and `--spot-deep` scheme-invariant; only `--spot-ink` lifts in dark.
6. Do isolate every number in `<bdi dir="ltr">` with Western digits and pan-Arab months.
7. Do print photos as one-colour duotone on the section field; natural colour only on the article figure or on hover.
8. Do credit every image (alt, author, Commons link) and fall back to seeded cover art, never a stock or invented picture.
9. Do show sources and the AI disclosure on every article under a 3px ink rule.
10. Don't add motion beyond the cover print and hover transitions, and keep it behind `prefers-reduced-motion`.
11. Do fill rows with count-based spans; keep saffron for the band, focus, selection and one cut-out per cover.
