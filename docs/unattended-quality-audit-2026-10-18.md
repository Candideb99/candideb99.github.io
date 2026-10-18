# Unattended newsroom: checker integrity and live writing

The aim is dependable, clear economic reporting without an operator. A green build or a high
critic score cannot establish Financial Times-level editorial quality. This round tests concrete
failure paths and retries the normal three-event writing audit, without publication or human
revision instructions.

## Reproduced faults and repairs

The fact-checker validated only that its response contained a nonempty checks array. An answer
such as `{"checks":[{"id":999,"verdict":"supported"}]}` passed that validation. Processing discarded
the unknown sentence, and the publication precheck returned clean with no usable checks. A
fractional or absent sentence ID did the same. A duplicate sentence could hide a later
contradiction, an unknown verdict was silently converted to `not_found`, and a partial answer
could omit a numeric body claim while the precheck ignored the returned `unchecked` count.

Regression cases now cover these response failures. The response boundary requires known integer
sentence IDs, unique entries, recognised verdicts and an entry for every sentence the existing
`mustCheck()` detector flags. Invalid answers use the existing schema retries; exhausted checker
failures leave the story waiting. Legitimate `not_found` observations and the distinction between
reported facts and bounded synthesis retain their existing treatment. No critic score or owner-set
publication threshold changed; coverage follows the existing detector rather than a new percentage
quota.

A further probe showed circular evidence: a claim repeated in the headline and body could be
marked `supported` by citing source 0, the story itself, even when the supplied external source
said the opposite. Source 0 is now permitted only for the existing internal-contradiction verdict.
Two additional regressions refuse self-cited support and retain real internal contradictions.

The checker evidence fingerprint previously used the Claude model setting even with Codex active,
and omitted the response-processing implementation. It now includes the active provider/model,
validator and processing code. Offline child-process tests confirm that different providers and
models produce different evidence versions. Historical evidence is retained; these versions keep
incompatible checker results from being pooled as the same judge.

The critic also accepted malformed scores: `"Infinity"` became an infinite score, while `11` was
outside the stated scale but passed through unchanged. Seven invalid-score cases failed before
the repair. Validation and normalisation now require a finite score within the existing 0–10
scale, retaining numeric-string compatibility. Invalid responses use the existing retry path;
the owner's first-pass and post-revision thresholds remain unchanged.

Private writing audits now save evidence and desk notes before the writer starts. A provider
failure before its first draft can therefore leave an inspectable checkpoint rather than silently
disappear from the sample. These checkpoints contain source bodies and stay in system temp.

A separate fault in `deskNotes()` swallowed subscription-quota errors as ordinary notes failures,
then allowed the writer to try the exhausted provider again. An injected quota failure reproduced
this. Quota errors now propagate to the existing run-level deferral path, while ordinary notes
failures retain their existing fallback. Two tests distinguish these cases.

## Reader findings and the shared brief

The anonymous reader preferred the revised US deficit story but found it unready, although the
production critic returned publish/10 and the factual precheck returned clean. Its specific
findings were a missing description of Medicare, a loose monthly-statistic ending and a
significance box that repeated an accounting identity and the body's gross/net distinction.
The source actually calls Medicare a government-run healthcare programme, so the missing
explanation can be supplied without outside knowledge.

The notes now reserve sourced functions of important unfamiliar programmes/institutions using
the existing identification budget. The shared writer/desk/critic brief checks those functions,
the ending's purpose and the synthesis's useful meaning. It explicitly allows a meaningful
comparison or material limit to recur in the body and box; it does not demand another statistic,
an invented causal contribution or a forecast. A regression confirms that a programme's
description survives the same twenty-fact budget.

In a known-example critic probe, the initial wording caught the US omissions but also requested
revision of the useful-sales-comparison positive control. That was too sensitive to repetition.
The narrowed wording retained the US revise verdict and accepted the positive control with
no issues. This is calibration on known material, not proof of improved future writing.

## Validation and live evidence

The full gates pass offline safeguards, Astro check, production build and built-page checks. The
initial gate completed in 43.9 seconds. One uncached run took 128.0 seconds, including an
86.0-second Astro check. The latest gate passed in 50.7 seconds, with a 10.6-second Astro check,
a 20.4-second production build and 13.0 seconds of built-site checks. It recorded 137
file fingerprints. The suite adds 35 regression assertions:
seven malformed check responses,
four valid evidence outcomes, provider/model fingerprint separation, seven malformed scores and a
compatible numeric-string score, two notes-failure paths, programme-function preservation and
six reporting-origin cases and five collector deduplication cases from the article review.
`git diff --check` also passes.

The structural follow-up closed a mismatch between the editorial rule and the publication check:
the brief said two outlets repeating Reuters or a statement are one origin, while code counted
distinct outlet labels. A synthetic pair of separately branded, near-identical source bodies could
therefore pass as two confirmations. `independentOutletCount` now collapses reports from the same
publisher and long body copies (at least 750 characters, with at least 88% of the smaller report's
five-word shingles in common). Distinct bodies and short reports remain separate; the official
primary-source exception is unchanged. These are conservative text signals, not article-lineage
metadata: substantive rewrites of the same wire story can still appear independent, so the check
does not establish provenance when body text differs substantially.

The six most recent cloud newsroom runs returned success. The latest inspected run
([39068021801](https://github.com/Candideb99/candideb99.github.io/actions/runs/39068021801)) actually
published one article; its success was not merely a no-output run. This is a health observation,
not an assessment of that article's prose.

The ordinary three-event dry run completed with 20 successful model calls and no provider
failures. It used the brief loaded before this round's editorial changes. No test article was
published, and the selector received no bespoke angle or repair instruction. The US event had
also appeared in the preceding audit, so this is not a wholly unseen held-out sample.

| Event | Production gate | Separate reader's final-text assessment |
| --- | --- | --- |
| US fiscal deficit | Accepted after one revision, critic 10, factual precheck clean | Not ready: missing programme function, weak closing and repetitive synthesis |
| Indonesia index proposal | Accepted on first critic pass, 10, factual precheck clean | Not ready: unexplained central institutions and concern about obligatory versus discretionary fund selling |
| Meta's news/AI wording | Accepted on first critic pass, 10, factual precheck clean | Ready: coherent account, explained actors and a bounded economic reading |

The reader preferred the final text in all three cases, but only one of three final reports was
judged ready. This is one separate prompt using the same model, not an independent human panel
or an estimated newsroom success rate. The Indonesia selling statement follows the fetched
Arabic report's own wording; that reader concern therefore needs primary-source checking before
being called a demonstrated writer error. Its missing institution identities are present in the
source and are covered by the general identification change.

Private drafts, fetched source bodies, reviews and reader reports remain under the system-temp
directory `khazendar-unattended-20261018-002110`.

## Updated-brief replay

An untouched one-event replay selected the US deficit again through the normal selector. The
notes retained Medicare's sourced healthcare function, the article explained it, and the box
connected the tariff/debt promise to refunds, interest costs and spending pressures instead of
stopping at an accounting identity. The critic returned publish/10. The factual precheck still
found one attribution error in the historical-deficit sentence, repaired that one sentence and
read the corrected story clean. The replay completed with eight successful calls and no failures.

The separate anonymous reader judged both the replay's first and final drafts ready, with no
issues, and expressed no preference. That does not erase the factual checker's attribution
finding: a fluency assessment is not a replacement for sentence-level evidence checking.

This is a known-event execution test, not a held-out writer result or a controlled before/after
experiment. The selector's angle and the existing headline-based lessons/control assignment
also differed between runs. It shows that the updated workflow can produce a clearer result
and automatically repair a real defect on this event; future unattended reliability remains
unestablished. No test articles, existing articles or live repository were changed by these runs.

## Published article review: Moody's Egypt upgrade

Reviewed the [published article](https://candideb99.github.io/articles/moodys-upgrades-egypt-credit-rating-b3-636210/)
and its saved source list without changing the article. The Arabic is clear, the headline and dek
agree, and the two-minute length is proportionate to one rating action. The geographically relevant
Ministry of Finance photograph and the five-point key-facts strip fit the material. The cited facts
are single observations across different measures, so this source set does not support a meaningful
chart or comparison table; `chart: null` and `table: null` are appropriate here.

One copy defect is concrete: the “why it matters” box repeats the closing body paragraphs' conclusion
that an upgrade does not immediately lower borrowing costs and that high debt service limits room
for social spending. That is more than reusing a premise to explain a new inference. It conflicts
with STYLE.md's instruction to delete a sentence whose facts recur without adding meaning, yet the
published critic score was 10. The shared editorial brief now tells the writer and critic to compare
the box with the closing paragraphs, consolidate an echoed conclusion, and allow one concise
synthesis sentence rather than preserving a redundant second sentence to satisfy a count.

The source list also contains two Daily News Egypt articles published 23 minutes apart. Both relay
the same Ministry statement and figures; the second adds no independent reporting to this story.
The evidence collector now collapses exact and long near-copy report bodies before they reach the
desk, including an exact duplicate in an unfetched feed summary, while retaining selected-item
provenance and keeping official documents and reference definitions separate. A run log records
when a duplicate is removed. Five regression assertions cover exact copies, near-copies, summary
copies, retained item provenance and preservation of a matching official document. The shared
editorial brief separately distinguishes a rating agency's rationale from a government response.

This review does not call the article under-length or demand a graphic for every event. A deeper
historical debt/surplus comparison could support a visual when a selected source carries it; this
article's retained source set does not. The quality failure was the redundant synthesis and duplicated
reporting, not its word count or empty chart/table fields.
