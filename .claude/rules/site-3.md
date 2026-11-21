---
paths:
  - "src/**"
  - "astro.config.mjs"
  - "DESIGN.md"
  - "scripts/{site-check,site-furniture,brand,copy-fonts}.mjs"
---

# The site, continued again

Continues site-2.md, which neared its size limit on 2026-11-21. Dated entries; where two differ, the later one stands.

- One module of figures on the front, 2026-11-21 (the owner: "we have أرقام اليوم and بالأرقام, is this redundancy? how about readability and understanding?"). It was, and it was mine: on 16 November «بالأرقام» (the band of cards) was built to take the place of «أرقام اليوم» (the side column's list), and I kept the list on wide screens because the column ended 400px short without it, noting the repeat as put to him. Two modules of figures under two names that say the same thing; never the same story, but a reader cannot tell why there are two. On understanding the cards are the better form: a headline first, then its three figures with their labels, where the list gives one figure before the reader knows the story («3 ساعات كحد أقصى» over «مهلة نشر التسجيل والعرض»). Now one at a time: while the band runs (two cards or more), the list does not, on any width (`figures` is empty in index.astro; Front.astro's `band` prop and `.figures--wide` went). The list runs on the days the band cannot, as on 21 November with the newsroom paused. `figureModuleFaults()` (scripts/site-furniture.mjs, run by site-check.mjs, pinned in pipeline-selftest.mjs) fails the gate on both on one page. Not seen with the band running: no day's stories filled two cards that day, so the side column's end without the list is unmeasured (about 190px above the others by that day's heights). Left: the article's own «الأرقام» box, a different thing under a near name.
