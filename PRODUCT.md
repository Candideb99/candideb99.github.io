# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Astro static site (content collections, Pagefind search), Node pipeline on GitHub Actions, GitHub Pages hosting. Chosen for zero hosting cost, static durability, and Arabic RTL control. (Inferred: user delegated all technical decisions.)

## Users

Arabic-speaking readers across the Gulf, Egypt, the Levant, North Africa and the diaspora who want to understand economic, market, energy, corporate and technology news with context, in clear Modern Standard Arabic. They read on phones during the day and on desktop at work. Their job: know what happened, what the numbers are, and why it matters for them, in a few minutes. (Inferred from the brief and the prior project definition; the user delegated product decisions.)

## Product Purpose

خازندار (Khazendar) is an automated Arabic economics publication. A newsroom pipeline reads official releases and reputable outlets, selects the stories that matter, and writes original Arabic reporting with key figures, context and cited sources, several times a day, without human intervention. Success: readers come back daily because coverage is fast, accurate, sourced, and readable; the owner touches nothing.

## Positioning

Every article is an original Arabic synthesis of multiple cited primary and reputable sources, with the key numbers isolated and a "why it matters" for Arab readers, published within hours of the event. Neighboring Arabic outlets translate single wire stories; خازندار cross-reads sources and shows its evidence.

## Operating Context

- Content arrives from a scheduled GitHub Actions job (every few hours) that commits Markdown articles and rebuilds the site.
- The owner monitors quality through workflow summaries and can unpublish by deleting a file. No CMS, no accounts, no comments.
- Sources: central banks (ECB, Fed, Bundesbank), statistics offices (Eurostat), WTO, SEC, EIA and reputable outlets (BBC, CNBC, Guardian, Al Jazeera, Asharq Al-Awsat, Sky News Arabia, Economy Middle East, and others). Paywalled outlets contribute only headlines and summaries.
- Images: Wikimedia Commons photos with recorded license and author credit; when no specific photo exists the newsroom takes a generic illustration of the place, institution or sector (vision-checked); a story still without a photo runs as text, never with generated art.

## Capabilities and Constraints

- Static site, no client-side framework; search via Pagefind; RSS and sitemap.
- Sections: الاقتصاد (economy), الأسواق (markets), الطاقة (energy), الشركات (companies), التكنولوجيا (technology), الدفاع (defense: budgets, procurement, arms trade and the defence industry, judged by what they mean for Arab economies), plus two hubs: تحليلات (analysis: a daily signed-house piece that connects two or more recent stories and answers "what does this mean", with scenarios rather than forecasts, every figure traceable to the stories it draws on) and مدخل إلى الاقتصاد, which holds two kinds: explainers of economic concepts (one a day, labelled شرح مبسّط) and readings of open-access research papers from the IMF, the World Bank, the BIS, the central banks and the academic series (twice a week, labelled قراءة في ورقة بحثية): the question, the data and method in plain words, the findings with their numbers, the paper's own caveats, and what it means for Arab economies, every claim from the paper itself.
- Editing: a day's paper is edited, not filled. At most four stories a run and ten news stories a day; every story must carry three of the news values (التأثير، الأهمية، الآنية، القرب، الضخامة، الصراع) and score 6 or more; a second story on the same event runs only when it carries a material development named in the headline.
- The paper carries market data the way a business daily does (a strip on every page, a box beside the cover, a full board in الأسواق): delayed, free, keyless quotes labelled as such, never presented as live or as advice.
- The front page must let a reader see in one glance what matters (one cover story, a clear step down to everything else) and follow running stories over time (ملفات نتابعها: topic files built from tags). It may rotate the cover automatically but must stop the moment the reader touches it and must never rotate for a reader who asked for reduced motion.
- Every article records: sources with URLs, the models used, a quality score, and an AI-assistance disclosure.
- Western digits (0-9) and pan-Arab month names (يناير, فبراير ...). Arabic MSA throughout; Latin only for tickers, acronyms and proper names where needed.
- No fabricated figures: every number must be grounded in the cited sources, verified programmatically and by a critic model.
- No live market data, no tickers, no accounts, no ads (undecided: ads later).
- Contact email and legal publisher details are intentionally empty until the owner supplies them (undecided).

## Brand Commitments

- Name: خازندار (Latin: Khazendar). Historically the keeper of the treasury; the name is binding.
- Voice: authoritative, calm, precise, plain Arabic; never sensational.
- Tagline (inherited, may be revised): الاقتصاد بلغة واضحة.
- Register (user-pinned, 2026-09-07): a respectable publication for cultured readers. Hand-lettered or playful display faces were rejected; typography must read as serious Arabic press and literary publishing (classical naskh such as Amiri for display, a robust naskh for reading).
- Direction (user-pinned, 2026-09-09): the category standard, played straight. خازندار must look like an authentic printed Arabic broadsheet, not a web product: white paper, black ink, rules instead of boxes, justified naskh columns, photographs in true colour at their column's width. Colour-washed photographs, procedural cover art and decorative web effects were rejected as inauthentic.
- House colour (user-suggested, adopted 2026-09-09): one deep banknote green (#0f5c3c), used as ink only, in the tradition of the green Arabic dailies (Asharq Al-Awsat, Al-Eqtisadiah).
- Logo (owner-supplied, 2026-09-09, binding): the owner's artwork in brand/logo-source.png, the wordmark خازندار in heavy dark-green calligraphy (#0c3c2a) over the treasurer's key in gold (#9b8044) on a thin gold rule. It is used as delivered, never redrawn: scripts/brand.mjs traces it into public/logo.svg (and a paper-lettered logo-dark.svg for dark pages), cuts the key's bow for the favicon, and builds the social card and avatar from it. Earlier generated marks (a seal, then a green plate with star dots) were rejected by the owner.
- Layout register (user feedback 2026-09-09): the site must read as a news organisation's site, dense and modular like the Arabic dailies' sites, not as a sparse editorial template: a latest-headlines strip, a top-stories list with thumbnails, a lead with secondary stories, reference modules (today's figures, editor's picks), section rows of picture cards, share links on stories, and a photograph on every story (the newsroom falls back to a generic Commons illustration of the place, institution or sector).

## Evidence on Hand

- Working feed registry validated live (pipeline/sources.json).
- Benchmark outputs from free OpenRouter models in Arabic (scratch, not shipped).
- Logo: the owner's artwork brand/logo-source.png, traced into public/logo.svg, public/logo-dark.svg, public/favicon.svg, public/avatar.png, public/og-default.png and src/lib/brand.ts (2026-09-09). No photography library, no testimonials, no traffic data. Future work must not fabricate any of these.

## Product Principles

1. Evidence before prose: a story exists only when sources exist, and the sources are shown.
2. Numbers are the news: isolate the key figures; never round or invent.
3. Speed with restraint: publish within hours, but skip a story rather than publish a weak one.
4. Readable first: the reading experience on a phone is the product.
5. Zero-touch operation: every process must run unattended and fail safe.

## Accessibility & Inclusion

RTL-first layout with logical properties; WCAG AA contrast; keyboard-navigable; reduced-motion respected; readable Arabic type sizes on mobile.
