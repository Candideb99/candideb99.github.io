# Arabic news craft: reader clarity, context and flow

Research and implementation review, 17 October 2026. Trigger: the owner found the Russia-waiver
report dry and apparently contradictory, after reporting a compressed Brent headline and a body
of disconnected dispatches. The system had published those weaknesses. A successful workflow and
a high critic score had not established editorial quality.

## What was read

Eight full reports from four established Arabic newsrooms, covering policy, prices, corporate
results, infrastructure and a technology survey, plus a standards-editor interview. This is a
purposive craft sample, not a statistical ranking of outlets or models. It studies their writing;
their pages are not treated as infallible statements of law or economic fact. Full report bodies
were read through the newsroom's normal extractor where browser retrieval failed. Website
navigation and recommendations were excluded from the analysis.

| Report | Observed practice and qualification |
| --- | --- |
| [الشرق الأوسط: Russia waiver, Reuters report](https://aawsat.com/node/5330504) | Opens with the new measures and their timing, then supplies the law's purpose and political/economic context before detailed provisions. Some legal wording remains dense; do not copy it as a model sentence. |
| [الشرق الأوسط: Russia waiver, AFP report](https://aawsat.com/node/5330470) | Makes the affected oil revenue and Ukraine's concern visible early, then develops the diplomatic background. Its emotive framing and wider military developments are unsuitable for Khazendar's calm, single-event economics report. |
| [الجزيرة: Egypt inflation, July](https://www.aljazeera.net/ebusiness/2026/8/10/inflation-egypt-july) | Identifies national versus urban measures, separates annual from monthly rates, groups components and relates them to the central bank's target. The many figures would still benefit from selection in a shorter report. |
| [الجزيرة: Egypt inflation, June](https://www.aljazeera.net/ebusiness/2026/7/9/inflation-egypt-june) | Explains which components drove the change and which did not share it, then connects the release to monetary policy. The reader gets a reason to care about a comparison, not just another percentage. |
| [الشرق بلومبرغ: Egypt's Moody's rating](https://asharqbusiness.com/economics/151892/موديز-ترفع-التصنيف-الائتماني-لمصر-بنظرة-مستقبلية-إيجابية/) | Pairs the rating action with conditions and risks early; later groups debt, financing costs and reserves by their explanatory role. Forecasts remain attributed to the agency. |
| [الشرق بلومبرغ: Saudi–Egypt electricity connection](https://asharqbusiness.com/power/151417/وزير-مصري-بدء-الربط-الكهربائي-مع-السعودية-منتصف-نوفمبر/) | Distinguishes testing from planned operation and explains the project's purpose and physical link. Also repeats capacity and generic benefits: outlet reputation is no reason to imitate that repetition. |
| [الشرق بلومبرغ: UAE AI incidents survey](https://asharqbusiness.com/technology/151804/مديرو-كبرى-شركات-الإمارات-تعرضوا-لحوادث-الذكاء-الاصطناعي/) | The body qualifies its population as surveyed large organisations and explains what an incident and an agent mean. Its headline is broader than the body: preserve sample scope in our prominent wording as well. |
| [CNBC عربية: Aramco quarterly results](https://www.cnbcarabia.com/155259/2026/04/08/أرباح-أرامكو-السعودية-ترتفع-42--إلى-121.5-مليار-ريال-في-الربع-الثاني-من-2026) | Explains the earnings movement, then distinguishes profit, revenue, cash flow and distributions with comparisons. Repetition of the result in the body can develop the opening; the generic closing adds less. The URL's date sequence is not used to infer the report's publication date. |

[The Al Jazeera Media Institute interview with Aref Hijjawi](https://institute.aljazeera.net/ar/ajr/article/606)
supports a related principle: attending only to prescribed words can neglect meaning and make
writers sound alike. Its criticism of clichés is relevant here. We retain Khazendar's own choices
on calm headlines, attribution, quotations and single-event reporting.

## Findings applied

1. **Meaning before procedure.** Readers should understand what changed and the decisive scope
   limitation from the headline, dek and opening. New measures versus existing restrictions must
   be explained together. Numbers alone cannot establish that a claim is accurate.
2. **Evidence must include context.** Desk notes now explicitly select the relevant sourced previous
   position, purpose, comparison, mechanism and affected group within their existing fact budget.
   A separate reader-context fact is checked by the same source/originality guards and placed first
   within the twenty-fact cap; a thin source can return null. A first live preview lost the policy's
   purpose during note filtering and still received an overgenerous context assessment. That case
   motivated the reserved slot and the critic's distinction between economic context and paperwork.
   The writer cannot recover context that the notes excluded, and the copy desk cannot invent it.
   Notes bound the eligible facts; they are not a demand to print every procedural detail.
3. **No paragraph stencil.** Removed the compulsory second/third paragraph sequence and compulsory
   background opener. Order follows the reader's questions. Related figures and their explanation
   belong together; a change of source is not automatically a paragraph break.
4. **Remove empty repetition, preserve explanation.** The former instruction to delete every
   repeated fact could remove the explanation of a headline. A return to a fact is useful when it
   supplies components, conditions or comparison. Repeated terminology can keep references clear.
5. **Interest comes from substance.** Concrete actors, consequences and useful comparisons make
   calm writing readable. No fabricated people, quotes, market effects, history or Arab angle;
   no extra background quota and no length inflation for a small event.
6. **The critic must show its reading.** Within the existing call, it records scope, context, flow
   and precision observations. A concrete revision finding must reach the writer even if the
   overall verdict accidentally says publish. A missing observation is not accepted as a review.
   Scores, publication thresholds and revision-round count remain unchanged.

## What these changes establish

Implementation tests verify that reader findings cannot disappear behind a 10/10 verdict, that
missing observations are refused, that a factual rejection is preserved, and that other genres
retain their existing review contract. They do not measure Arabic fluency.

`node scripts/editorial-eval.mjs --live` runs the real configured critic against eight synthetic
cases, including clean counterexamples. Expected outcomes and diagnoses are not sent to the model.
`--case=<id>` selects one. The harness writes a dated report in the system temp folder and stops
as incomplete on a provider/quota failure. It never publishes, changes providers or retries with
a paid API. It tests whether the critic recognises known defects, not the writer's overall quality.
Reports record the configured model and hashes of the critic rules and fixtures for later comparisons.

Live calibration on GPT-6.1 Sol through the ChatGPT subscription: the latest readings of all eight
cases matched their expected outcomes (four requests for revision and four publish verdicts).
The first run found genuine defects in two supposedly clean examples: an unsupported causal
connector, an ambiguous reference, an unstated crane fuel type and a duplicated significance box.
Those fixtures were corrected and re-read, rather than teaching the critic to overlook the faults.
These are curated examples, not an estimate of newsroom accuracy or a controlled before/after study.

A private writer → copy desk → critic preview of the waiver retained the sourced purpose of the
law and an attributed oil-price risk. The harness initially supplied the White House page's date
incorrectly as 17 October rather than 16 October; the critic independently caught the resulting
Saturday claim against the report's Friday wording. With the test metadata corrected and that
invalid note removed, one normal revision resolved it: programmatic checks returned no issues and
the critic accepted the revised text. This preview was not published and did not exercise the image
desk or the separate pre-publication fact-check; it is not a full newsroom acceptance test.

Human assessment of fresh outputs is still needed to establish improvement in reader experience;
the current complaint and these examples are the calibration evidence, not a promise that prompts
prevent every future error. No model ranking follows from this sample.
