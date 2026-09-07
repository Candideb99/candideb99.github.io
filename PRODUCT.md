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
- Images: Wikimedia Commons photos with recorded license and author credit, or an original generated cover when no suitable photo exists.

## Capabilities and Constraints

- Static site, no client-side framework; search via Pagefind; RSS and sitemap.
- Sections: الاقتصاد (economy), الأسواق (markets), الطاقة (energy), الشركات (companies), التكنولوجيا (technology), شروح (explainers).
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

## Evidence on Hand

- Working feed registry validated live (pipeline/sources.json).
- Benchmark outputs from free OpenRouter models in Arabic (scratch, not shipped).
- No logo asset, no photography library, no testimonials, no traffic data. Future work must not fabricate any of these.

## Product Principles

1. Evidence before prose: a story exists only when sources exist, and the sources are shown.
2. Numbers are the news: isolate the key figures; never round or invent.
3. Speed with restraint: publish within hours, but skip a story rather than publish a weak one.
4. Readable first: the reading experience on a phone is the product.
5. Zero-touch operation: every process must run unattended and fail safe.

## Accessibility & Inclusion

RTL-first layout with logical properties; WCAG AA contrast; keyboard-navigable; reduced-motion respected; readable Arabic type sizes on mobile.
