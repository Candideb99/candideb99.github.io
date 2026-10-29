# STYLE.md — how خازندار writes and organises news

Written 2026-09-11 from reading the economics desks of الشرق الأوسط, الاقتصادية, الشرق بلومبرغ,
CNBC عربية, العربية Business, الجزيرة اقتصاد, أرقام, مباشر and الخليج, and the Arabic press style
manuals (Al Jazeera Institute and others). It is the reference behind `pipeline/lib/write.mjs`
(the writer's house style), `pipeline/lib/style.mjs` (the machine checks), `pipeline/lib/copydesk.mjs`
(the copy desk) and the site's page conventions. The owner's rule that started it: no literal
translations, and nothing that reads as "AI taste".

## 1. The Arabic

**The lede.** A past-tense verb of action or saying, then the named actor, then the figure, then
the cause clause (بعدما، مع، وسط، في ظل). Under 45 words. No scene-setting, no "شهد", no
"في خطوة". The opening verb varies across stories (أعلنت، خفّضت، أبقى، قرر، سجّل، تراجع، قفز،
رفعت، أظهرت بيانات، كشف).

> خفّضت منظمة أوبك توقعاتها لنمو الطلب العالمي على النفط في 2026 للمرة الخامسة على التوالي، في
> مؤشر على استمرار تأثير الحرب.

**The development** follows the reader's questions, without a compulsory second or third paragraph.
Put a decisive qualification, comparison or explanation beside the claim it clarifies. Background
may need to precede procedural detail; وكان … قد is one useful opener, not a paragraph formula.

**Every figure** in this order: value, unit, direction, benchmark, time, source. Adjectives only
when quantified (أكبر زيادة منذ مايو); never "بشكل كبير".

**Attribution** in the desks' forms: قال X في بيان إن (always إن after قال), وأضاف، وأوضح، وأشار
إلى أن، وفق بيانات صدرت الخميس، بحسب رويترز، نقلاً عن. Each source is named once, where its
information first enters; after that the reporting verb or one attribution at the head of the
paragraph carries it. Never two sentences in a row tagged وفقاً لـ/بحسب, never وفقاً للمصدر نفسه,
never one outlet more than three times in a story (the checker sends back a story that tags more
than a third of its sentences). أكد takes an object, never أكد على. كشف only for what was hidden.
An unnamed source is one source only inside one report: «مسؤول إيراني كبير» of 23 September and of
24 September are two people, never «وأضاف المسؤول»; and a speaker says only what the story had him
say (the desk once turned the story's own comment into «ورأى أن…» in a banker's mouth, 2026-09-24).
A dual subject before its verb takes a dual verb: «اثنتان منها عبرتا»، «الشركتان أعلنتا».
**Expectations** belong to someone: يتوقع المجلس أن، ترجّح الأسواق، مرشح لـ. Never a floating
forecast.

**Texture.** One idea per sentence, no sentence over 35 words; paragraphs of one to three
sentences; concrete nouns (البرميل، الأونصة، العقود الآجلة، نقطة أساس، الجلسة، الإغلاق، المكاسب
الأسبوعية; المعاملات الفورية only for spot prices, never futures); active voice.

**Joints with a job** (added 2026-09-23, from an audit of the published paper that found the machine
now shows in structure more than in words). Arabic's own joints: و، فـ، فقد، ثم، لكن، أما … فـ،
وكان … قد، ورغم، وقال. Introduce background directly where needed, never ويأتي/وجاء + noun + في
وقت/في ظل/وسط, never يأتي ذلك. «، إذ» only when the clause explains the one before, never before a
reporting verb. فيما/بينما only for two things at once, never to slip a second development into the
dek. وفي المقابل only for a real opposite; حيث only for a place; مما at most once.

**Arabic sentences, not English ones in Arabic words.** Open with the verb; no chain of more than three
nouns in an إضافة. "Whether" is هل, never ما إذا كان; "in terms of" is a verb, never من حيث; "was set
to" is كان مقرراً أن, never كان سيـ; "as a" is بوصفه or a rephrase, never كـ + noun; بشكل/بصورة +
adjective becomes the adverb or the figure; يتم/تم + verbal noun becomes the verb. An abstract noun
never judges: name who does. **Idioms and trade terms** are translated by meaning, never word for
word (industrial-scale, crown jewels, guardrails, ground stop, term contracts, lagged effects,
intraday, grounded, "Senator X of Alaska" = السيناتور عن ألاسكا); replace an awkward calque rather
than explaining it, but keep a useful brief definition of a necessary technical concept.

**Each field has a job.** The dek adds an important detail or qualification to the headline;
the body develops the opening through evidence, comparison or explanation. لماذا يهمّ gives
Khazendar's own bounded synthesis: connect sourced facts to a material constraint, trade-off or
transmission channel, with conditions stated plainly. It is neither a summary nor an analyst's
attributed opinion. Reported premises must be sourced; the inference need not repeat a source's
conclusion. No invented outcome, forecast or country effect. It never recaps or speculates in chains
(قد يؤدي… مما قد…), addresses the reader or opens with يعكس/يمثل/يُعدّ. A sentence whose facts already
appear higher up without adding meaning is deleted. Repeating a figure to explain its components
or comparison, or a term to keep its referent clear, is useful. The copy desk may cut a repeat because its guard counts facts over the
whole story: a figure, a name or a hedged claim may leave a place where it repeats, never the story.

**The box holds what its heading says.** Under «الأرقام» every value is a figure with its unit (an
amount, a rate, a price, a count, a share, a duration) or a credit rating, opening with the number or
its measure word («نحو 70%»، «حتى 7%»), in Arabic; a name, a place, a company, a date, a weekday, a
verdict or a sentence about a figure is not a key fact however important, and stays in the text (the
owner, 2026-09-27, on «بغداد ومسقط» and «النجف» printed there). Its label says exactly what the figure
measures, and every figure belongs to the headline's event. Code decides the form, not the writer's
obedience: `pipeline/lib/keyfacts.mjs` drops such a value wherever a draft is made, written or
corrected, and the site-check refuses a published box that holds one. A story with no figures has no
box. An explainer's box is its glossary, each key term over its one-line definition, headed «مفاهيم
أساسية». The same day's audits held every other label to its story too: tags the text carries, desks
where the event happens, the label above a headline named by the headline (CLAUDE.md has the rules).

**Hedges** are said once and plainly: at most one per paragraph, varied, never two sentences in a row
opening with one; يرجّح أن with no subject becomes والأرجح أن or names who judges. An analysis marks
its reading once where the reading begins and then writes plainly.

**Dates** as the desks write them: the weekday for this week, the month for this year, the year only when
it is not the current one; never an ISO date, never بتاريخ, never اليوم or أمس in stored copy. A key
fact names what is measured, where and when; a weekday or a date is not a key fact. **Names** keep one
spelling across the paper (أمريكي، ترامب، وارش، خه لي فنغ), applied mechanically by the copy desk.

**Closings** are one of the desks' four: a sweep of related instruments, the next date to watch,
the concrete why-it-matters, or an attributed quote. Never a summary, never a moral.

**Banned** (the checker forces a revision; the desk rewrites): fillers في هذا السياق، تجدر
الإشارة، من الجدير بالذكر، يُذكر أن، لا يخفى، في نهاية المطاف، بالإضافة إلى ذلك، علاوة على ذلك،
من ناحية أخرى، على الرغم من ذلك؛ calques تم/يتم + مصدر، من قبل، يقوم بـ، يلعب دوراً،
بشكل/بصورة + صفة، على صعيد، يعتبر، ما إذا كان، هناك ارتفاع في، شهد ارتفاعاً؛ clichés بمثابة،
يسلط الضوء، يمهد الطريق، نقطة تحول، مما يعكس، في خطوة، يأتي ذلك، السؤال الحقيقي، ليس مجرد؛
machine leftovers (Latin, Chinese or Cyrillic letters, straight quotes "…", the prompt's own words
المادة/الملاحظات, also as a place: «أدنى مستوى في المادة», a word said twice in a headline, an ISO date). Warnings: في إطار، على مستوى، من
حيث، ما يعكس، the intensifiers حاد/انهيار/تاريخي/جداً without a number, a number that does not agree
with its noun. Preferred: نحو not حوالي، في الوقت نفسه، مديرو، أسهم، مهم.

**Headlines.** A nominal sentence: actor first, present-tense verb, the figure (الذهب يتجه لثالث
خسارة أسبوعية مع تصاعد رهانات رفع الفائدة). One idea, at most 12 words, never two developments
chained with و. No ellipsis hinge or dramatic metaphor in a news headline; the colon
carries a quoted speaker (صندوق النقد: الاقتصاد العالمي يتجه إلى نمو 3%). Definite references for
institutions (الإدارة الأمريكية or واشنطن, never إدارة أمريكية); a strong verb instead of يعلن عن +
verbal noun. No "!", no teaser, no تعرف على, no question headline for news (explainers may ask).

**The report has a line of thought** (the owner, 2026-10-17, on the first Sol story). The headline is a
complete idiomatic statement: «مخاوف من تعطل إمدادات النفط» says what is feared; «مخاوف الإمدادات»
compresses away the relation. The headline's subject-first form differs from the lede's natural verb
opening; the copy desk must not impose one order on both. Checked desk notes are evidence, never a
paragraph plan: group related figures, their comparisons and attributed context into paragraphs that
develop one point. Three separately attributed one-sentence dispatches in a row merit review, not an
automatic rejection of a brief. The desk may regroup and reorder sentences while preserving actual
chronology, attribution, hedges and every unique fact. No invented cause or contrast just to make a
transition; no extra words just to make the article longer. A useful consequence develops the story;
«ارتفاع السعر يرفع كلفة الشراء» alone merely repeats it. The writer, copy desk and critic share this
brief in `pipeline/lib/editorial.mjs`; the critic names concrete defects in construction as well as facts.

**The headline is the spine** (the owner, 2026-10-29, on «الفيدرالي الأمريكي يبقي الفائدة بين 3.75% و4% رغم
مطالبة عضوتين برفعها»: "check if this article is just a mish-mash/mix of info that look disconnected"). Every
sentence was sourced, yet the story read as two source reports laid side by side: the two dissenters were named in
the lede and never again, while what explained the split (the statement calling growth «قوية», the chair's "family
fight", a governor on further hikes, December's pricing) sat in four distant paragraphs between background, prices
and a textbook definition. Whatever the headline says is new is developed right after the lede, every supplied fact
that bears on it gathered there; a speaker's remarks sit beside the facts they explain. When the sources cannot
develop it, the headline leads on what the story can. Markets reacting to a decision are told as that reaction: one
measure per instrument (never two dollar indices as one dollar), timed against the event rather than each at its own
minute, a retreat from the session's high said with where the day stands, and no market a source does not tie to the
event. A news story does not define the basic words of economics for a reader who has never followed it. «لماذا
يهمّ» ends on its inference: no closing clause that takes it back, no «لا… وحده» against a claim nobody made (six of
some 300 boxes; a warning to the desk in `style.mjs`). The vote under «الأرقام» is printed whole («10 مقابل 2»). The
critic writes a headline the body abandons as «العنوان بلا متن:», a depth defect, and the reviser is shown the
sources it names.

**Padding is not depth; results keep their labels** (the audit of 2026-10-29, 21 pieces). A company's description of
itself, an executive's praise, a communiqué's list of topics, diplomacy that does not touch the economic consequence and
the previous event retold never fill a report, and the critic may not ask for them: a thin event runs short. In company
results each measure keeps the company's own name for it (EBITDA is not operating profit), every comparison names its
base and never sits a year-on-year change beside a quarter-on-quarter one, growth on last year is not a raised plan, and
new guidance is told against the range it replaces. A forecast keeps its assumption wherever it is printed; the copy
desk's guard now treats a condition as it treats a hedge. «لماذا يهمّ» says the consequence in the event's own terms,
in proportion to the story's figures, and no longer by formula («يبقى رهناً بـ…»، «، لا بـ…»).

**Meaning before machinery** (2026-10-17, after reading eight reports from four Arabic desks).
The headline, dek and opening together must establish what changed, who is affected and the
qualification needed to understand the event. Distinguish a waiver of new sanctions from lifting
existing ones, a target from an operating project, and a sample from a country. State a provision's
conditions and reference date accurately: enactment is not implementation, and a fixed additional
tariff is not a ceiling. Use the supplied primary document for a provision when available.

Select the sourced background that answers the reader's question: the previous position, why the
measure exists, the relevant comparison or its practical consequence. Put it near the fact it explains;
do not leave all significance to the final box. No compulsory history paragraph, invented everyday
scene, analyst, motive or Arab angle. A brief remains brief when the evidence is limited.

Interest comes from concrete actors, useful comparisons and an account that advances. A row of
«وشمل… وشمل…» rewritten as «وأضاف… وأوضح…» still needs editing if the underlying structure is a list.
Keep necessary technical terms stable, explain them briefly when needed, and vary rhythm for meaning,
not by a quota of connectors. The copy desk can reorganise existing facts; it cannot invent context.
The critic records observations on scope, context, flow and precision within its existing pass, and
gives specific repairs for defects. Its numeric score is not a certificate of literary quality.
The publication threshold and number of revision rounds stay unchanged. The sample, limitations and
source links are recorded in [the editorial audit](docs/arabic-editorial-audit-2026-10-17.md).

**An original construction, with honest evidence.** The report answers a reader's question through
the checked facts, rather than mirroring another report's paragraph order with different words.
Develop the supplied comparison, mechanism, affected group or limits of a decision. Thin evidence
still makes a brief; no invented exclusive, interview, calculation or local consequence to create
novelty. Outlets repeating the same agency or statement do not provide independent confirmations.
An official release establishes its announcement, not the truth of every benefit it promises.
When a fetched report cites a relevant public institutional document, the evidence collector may
read one such document on an approved host. It keeps the actual publication date (or unknown),
records the referring report and checks relevance. A failed supplement leaves the original sources
intact. The existing limit of five source items and all publication checks still apply.

**Marks.** Western digits; pan-Arab month names; % after the figure; the Arabic comma (،); «» for
quotations and foreign brand names; tanween on the alef (اً).

**Sources, the way a wire desk uses them** (added 2026-09-24, from the same day's stories read beside
الشرق الأوسط's economy desk; the owner asked whether an automated site can reach its level). A fact is
attributed to where it comes from: the institution, company or official that announced it, the body that
published the data, or the agency that reported it (رويترز، بلومبرغ، الأناضول). A newspaper, channel or
website is named only for what it alone reports (its interview, its sources, its exclusive, its own tally).
The Arab desks do not cite one another for public facts: «بحسب «الشرق الأوسط»» on the Fed's own hike or the
OECD's own forecast is gone (12 of 133 stories carried one). When sources disagree on a figure, the story
prints one, the latest or the institution's own, never the disagreement («أما «الشرق الأوسط» فأوردت أرقاماً
أدنى» ran once). **Large counts** in the headline, dek and lede are written as the desks write them:
«نحو 456 ألف مستثمر», never «455758 مستثمراً»; the exact figure goes once in the body, and index levels keep
their digits. The checks are in `pipeline/lib/style.mjs`; the copy desk's guard accepts the rounding
(`roundingsOf()`) and lets an Arab outlet's tag leave the story (`ARAB_OUTLET_NAMES`).

**Whose voice** (added 2026-10-25, when the Turkish, Iranian and Indian press joined "with ownership labels"). An
outlet the story names is named the first time with its owner and country, as the desks introduce a foreign outlet:
«وكالة «مهر» الإيرانية شبه الرسمية»، «صحيفة «طهران تايمز» الإيرانية الحكومية»، «وكالة «شانا» التابعة لوزارة النفط
الإيرانية»، «صحيفة «ديلي صباح» التركية المقربة من الحكومة»، «وكالة الأناضول التركية الرسمية»، «قناة «إيران إنترناشيونال»
المعارضة، ومقرها لندن»، «صحيفة «إيكونوميك تايمز» الهندية»; after that its short name. The labels are in
`pipeline/sources.json` (on each source, and in `outletLabels` for the agencies the sources quote: IRNA, Fars, Tasnim,
Press TV, TRT); the writer sees them beside the sources, and `pipeline/lib/outlets.mjs` sends back a story whose first
mention of a state, ministry, pro-government or opposition outlet drops the words that say so. A private paper's
country is a courtesy and is not checked.

**Captions** (added 2026-09-23, the owner: "a human writer would not describe the sky"). A photo caption
names; it does not paint. Three to ten words, a noun phrase: what the photograph shows and, when the file
itself says so, where (مصفاة نفط في هيوستن بولاية تكساس الأميركية؛ مقر بورصة نيويورك في وول ستريت؛
أفق القاهرة). Never the weather, the sky, clouds, light, time of day, colours, mood, size impressions,
the camera or the composition (تحت سماء…، منظر، مشهد، لقطة، في الخلفية، صورة تظهر، ضخمة، حمراء). A stock
illustration names no place and carries «(صورة تعبيرية)». The rule is `CAPTION_RULE` and the check
`captionFlaws()` in `pipeline/lib/images.mjs`; `node pipeline/recaption-images.mjs` rewrites published
captions by it.

**Depth for the general reader** (2026-10-17, after the Egypt rating report). A substantial policy,
financing or rating event deserves a developed account when its sources provide the material;
the writer and its revision are guided toward 450-650 words for rich reporting (since 2026-10-18 every
news story is a developed report of at least 300 words; see below), never by padding. Preserve the central term's meaning, the useful
comparison, the mechanism and the limits. A credit-rating code is not an explanation: define
creditworthiness, and distinguish investment from speculative grade when the supplied reference
establishes that distinction. The collector can add a fetched ratings reference; it never counts
that reference as confirmation of the event, and keeps five sources at most.

An unfamiliar expert needs a concise sourced role and institution at first mention. Preserve the
origin of an outlet's own comments without implying our own interview. «رفع التصنيف» is clearer
than the catch-all «الترقية» here; «بمقدار محدد» needs an explicit meaning or a faithful clearer
paraphrase. Neither phrase justifies losing the uncertainty about financing costs.

Initial «و» is normal Arabic. A report whose every paragraph opens with «وقال/وأضاف/وأوضح» still
needs a review of its construction and rhythm. The checker now includes these previously exempt
openers in its warning; it does not ban conjunctions or require a quota of alternatives. Definitions
may begin with their subject, comparisons with their facts, while each speaker remains identified.

**What still read as a machine (owner, 2026-10-19: "is the arabic ... robotic and scream ai? i want ...
financial times level").** The grammar was sound; four habits in how stories were built gave the
machine away, and each is now cut by the writer, the desk notes, the copy desk and the critic, and
checked in `style.mjs` (calibrated on 245 published news stories; 3 are sent back, 4 more warned):
- *What the sources do not say.* «ولم تتضمن تصريحاته المنشورة مقارنة… لكنه لا يكشف وحده اتجاه نموها».
  A reporter finds the missing figure or says nothing. The house style itself had asked for it ("if a
  figure is missing, say the source did not disclose it"); that line is gone. The wires' one clause about
  a material term the actor withheld («لم تكشف الشركة قيمة الصفقة») stays.
- *A speech told call by call.* «ودعا… وشدد… وأكد أهمية… وأشاد…». Desk notes now tag a speaker's general
  remarks `remark` (two at most reach the writer) and they do not count toward `NEWS_MIN_FACTS`, so an
  event made of remarks runs as a short story instead of being stretched to the 300-word floor. Four
  exhortation sentences in one story send it back.
- *A sentence that sums up in abstract nouns.* «وتتباين الاحتمالات التي تواجهها السوق بين…»: cut.
- *Paragraphs bridged to the one before.* «ولتطوير هذه الحلول، …»، «إلى جانب الأدوات التقنية، …». Two
  in a story send it back; one, a real contrast («ورغم هذا الصعود») or a time phrase («هذا الشهر») passes.
The same day three stories were read beside الشرق بلومبرغ, Reuters and the FT on the same events
(China's third quarter, oil after the Russia waiver, Anthropic's public-benefit pledge). What they
had and we lacked, now in the house style and the critic: the number that matters leads (Brent before
WTI; never a contract the source says is expiring; the latest-timed price); the dek says what the news
changes; a pending plan takes a verb of intent («تعتزم», not «تخصص»); an institution's self-praise is
not reported; the latest result comes before old background; two or three distinct voices, one
attribution formula at most twice (checked in code: the China story had «في تصريحات أوردتها» four times).
Headlines carry what is new about a figure (its movement, comparison, record or consequence) when the
sources give it; a bare level («…تبلغ 48 مليار دولار») only when they give none. «بلومبرغ» has one
spelling, applied in code.

An owner-selected news article can be re-reported through `pipeline/run.mjs --refresh=<slug>
--refresh-note=<Arabic note>`. It faces the existing gate and factual check, keeps its address,
original publication date, picture and previous correction history. Its reason is recorded in
the internal run report; style improvements carry no public editorial-update banner (owner, 2026-10-17). The schedule never invokes this option. A failed refresh leaves the published text intact.

**Explainers and paper readings sound like a reporter, not a textbook** (2026-10-23, the owner on four of them:
"these articles look like nonsense, no? looks like ai badly written topics with bad headlines that is even more
confusing ... the writing needs to sound human"). Their facts and sums were right; their construction was ours.
The explainer was "evergreen" and forbidden any current fact, so each priced a made-up example in «وحدات نقدية»
while the week's real figure (the dollar past 54 pounds, the Banque du Caire offering) sat in our own news; 23 of
24 carried the same subheads (ما X؟ / مثال توضيحي / أخطاء شائعة وما يُراقب) and closed on a list of indicators;
9 opened on a dictionary definition; the headlines asked about the very term the piece had to teach («علاوة عُمان
على دبي»). The paper readings ran an academic paper's five labels, a correlation in the dek, regression
coefficients in the box and eight «، أي…» glosses a piece. None of the 293 news stories showed any of this.
Read the same day against eight professional pieces (Reuters' explainers on oil above $100, rising Treasury yields
and MSCI's case against Indonesia; الشرق بلومبرغ on Egypt's fuel prices; الجزيرة نت on stagflation; اندبندنت عربية on
Egypt's gold; two Reuters write-ups of San Francisco Fed papers): 7 of 8 open on the week's event with a real figure;
none uses a hypothetical example or definition / misconception / what-to-watch subheads (Reuters heads them with the
reader's questions or the answers stated as facts); they end on the last new fact, a forecast or the next date; the
explainers run 540-1,400 words (Reuters 640-810), the paper write-ups about 300, with the statistic turned into plain
words and the method in one sentence. The one textbook-shaped piece found, an older الشرق explainer of a Nobel theory,
has exactly our template. Now:
- **An explainer answers the question a reader of this week's news is left with** (`selectExplainerTopic()` in
  select.mjs), asked in that reader's words, and opens on the story that raised it: the lede is the news fact with
  its figure and date, then the answer; the dek is the answer. Its figures come from those stories, which are now
  its sources and are checked like an analysis's (`programmaticChecks()`); a paragraph that announces a hypothesis
  («لو…»، «لنفترض…») may compute its own numbers. No fixed sections: at most three subheads, each the reader's next
  question or its answer stated as a fact; the piece ends on the last thing the reader needs or the next dated event. 450-700 words.
- **A paper reading leads with the finding in plain words**; a statistic is translated before it is given and never
  sits in the headline, dek or box; the method gets the paragraph the reader needs to trust the number; the paper's
  caveats keep a paragraph of their own; no academic labels. 400-600 words (Reuters' write-ups of a Fed paper run about 300).
- **Code checks** (`style.mjs`, hard for these two kinds): label subheads, a definition lede or one with no news,
  invented currency units, a closing watch-list, more than three «، أي» glosses. For every kind: the site quoting
  itself («في قراءة خازندار»، «ترى خازندار»: a reading is marked by its hedge), and a warning for significance
  asserted instead of shown («يكتسب أهمية»، «محطة مفصلية»). The house style's «WRITE WHAT IS THERE» rule carries the
  rest of Wikipedia's *Signs of AI writing*, said the Arabic way. Calibrated on all 335 published pieces: no news
  story trips any of them; every explainer and paper reading does.
- **Analyses have no fixed sections either** (the second audit, the same day: all 12 ran ما الذي تغيّر / من يربح ومن
  يخسر / السيناريوهات / ما الذي نراقبه and closed on «نراقب»). The argument is stated positively, never against a claim
  nobody made («لا… وحده»); a scenario appears only where the stories show a real fork; the piece ends on the next
  dated decision or the last fact the argument needs. 600-900 words. Every hub piece's last review findings are mended
  before publication, and analyses, paper readings and the weekly pass the check before publication as news does.
- **A news outlet's arithmetic is not a fact**: an average or share it computed is recomputed or left out, a share keeps
  its base, and «المصدران» says whose sources they are. «رفع الدعم» means removing a subsidy: «زيادة الدعم» for a rise.

## 2. The editing (فن التحرير الصحفي)

News is edited, not filled. The editor model scores every candidate on the news values an
Arabic desk edits by: التأثير (does it change money, prices, jobs or policy for our readers),
الأهمية (a central bank, a government, a market, a major company), الآنية (decided or happened now;
a figure already reported is news again only if the change is material), القرب (the Gulf, Egypt,
the Levant, the Maghreb, or the global forces that move them), الضخامة (the size of the number),
الصراع والنتائج (winners, losers, what follows). A story needs three of them; importance below 6
is not published; the editor states the values in its answer. Development beats repetition: a
candidate that advances a running file is preferred to an unrelated marginal item, and the angle
must say what is new. Hard limits in `pipeline/run.mjs`: at most four stories a run and twenty news
stories in any 24 hours (`KHAZENDAR_DAILY_CAP`; ten until 2026-09-24); `pipeline/lib/verify.mjs` rejects a story whose
headline shares half its content words with one published in the last four days, so the same rate
rise cannot run twice under two headlines. Explainers and analyses are one a day each.

**Our readers' own economies first** (2026-09-24, the owner's go after reading الشرق الأوسط beside Khazendar:
their economy file ran about 30 stories a day, some 40% Saudi, Gulf and Egyptian, while ours carried 8% from
Egypt and the Maghreb). Ten Gulf, Egyptian and Moroccan feeds joined the newsroom (الخليج، جريدة الرياض، اليوم
السابع، مصراوي، هسبريس، AGBI، Arabian Business، Gulf Times، Saudi Gazette، Daily News Egypt; `regionalNotes` in
`pipeline/sources.json` lists the ones that failed). The editor is told a weighty Arab decision, release,
result or deal goes ahead of a comparable foreign story, aiming at about half the day; each run takes at least
one worthy story from الخليج or مصر والمغرب العربي until the day holds eight (`ARAB_DAILY`); every feed gets its
turn in the editor's list of 300 (`CANDIDATE_CAP`) instead of the busiest filling it; and the day's gold,
dollar and share price tables are left out before the editor reads (`SERVICE_ITEM`).

**«في العمق», the week's in-depth piece** (Sundays, 2026-09-24; the owner's Task 5 after reading الشرق الأوسط's
in-depth pages). Their investigations and profiles need reporters; the form an automated newsroom can do
honestly is their weekend feature on one subject («الاقتصاد التونسي... صمود تحت ثقل الديون»): the whole story of
one running file, told from Khazendar's own stories of the past six weeks, oldest first, 1200-1700 words under
كيف وصلنا إلى هنا، بالأرقام، ما الذي يعنيه للمنطقة، الأسئلة المفتوحة, with a timeline table (each story's date
and what it reported). Every figure and date traces to a story; the region section may carry Khazendar's
reading, hedged. The headline may take the in-depth hinge «الموضوع... ما يظهره الملف» or the question the piece
answers. A threshold is a fact the desks print: «فوق 108 دولارات» for a peak of 108.68 passes the number check,
«عند 108» does not (a rounding to 109 would pass, and the critic judges whether «فوق 109» is true).

**A news story is a developed report, or it is not published** (the owner, 2026-10-18: "i still see low quality
articles (also too short) being published"). From 2026-09-24 a small event ran as a brief: the floor was 120 words,
100 when the desk notes held fewer than ten facts, every brief told the writer a thin event "remains a brief", and
the critic was told that an honestly brief report was no defect. The stories of 17 October ran 124 to 193 words
beside sources that carried the cause, the reactions and the background, and scored 10. Now (`NEWS_DEPTH`,
`NEWS_FLOOR` and `NEWS_MIN_FACTS` in `pipeline/lib/editorial.mjs`):
- every news story answers, from its sources, six questions in the reader's order: the news, its driver, the
  numbers in perspective, the reaction (named voices), the background and what comes next; 350-650 words, never
  under 300 (lede plus body), checked in the writer's answer, in the checks before publication and by the critic;
- the desk notes hold 15-30 checked facts, each tagged with its job, and an event whose notes hold fewer than 12 runs
  as a short story (below);
- the critic lists, as «ينقص التقرير:», each element a source supplies and the draft leaves out, and takes a point
  for each; three or more hold the score at 6, so a digest no revision fills is refused;
- the copy desk may not cut a story under the floor, and the editor cites every report of the event, up to five;
- a draft that passes the critic's second pass but is still marked "revise" is sent back once more with those findings
  before the check against the sources (the thresholds are unchanged; a repair the checks refuse leaves the reviewed draft).
A retry is told why the last answer was refused (`chat()` in `pipeline/lib/llm.mjs`).

**A small event runs as a short story, not as a thin report** (the same day; the owner asked whether renowned sites
publish short stories, and showed al-aalem.com's item: a headline, a photograph and some 200 words in six short
paragraphs on an ordinary article page). The Arab sites, the wires and the business papers all run small events
that way, beside their full reports. `SHORT_STORY` in editorial.mjs: 150-250 words (120-320 accepted), a lede with
the news and the decisive figure, then one to four short paragraphs with the most useful sourced detail (the stated
cause, the previous figure, a named reaction, the next step); no subheads, no list, no «الأرقام» box and no «لماذا
يهمّ», which on a 120-word story read as padding. It goes through the same desk, critic (judged as a short story,
never against the six elements), revision and check before publication, and gets a photograph; it is marked
`format: short`, never leads the cover or sits among its secondaries, and at most seven run in 24 hours, so the
developed report stays the paper's form. Past that cap a thin event is not written and returns when more outlets
have reported it. A daily briefs page was built first and dropped the same day: the owner did not like it.

A finished story is mended, not thrown away (2026-09-24). In the 24 runs before that day, 19 drafts were
rejected after their revision against 30 published, most for one stock phrase or a lede a few words long,
after the writer, the desk and the critic had been paid for. Now a revised draft whose remaining faults are
all the desk's trade (a phrase, a long sentence, an English word left behind, a passage too close to its
Arabic source) takes one more desk pass with those faults named, and the checks run again; only what a
writer must mend (a figure the sources lack, a missing structure, too little story, a repeat) still rejects
it (`WRITERS_FAULT` and `lastDeskPass()` in `pipeline/run.mjs`). A key figure without a label is dropped
from the box instead of costing the story.

## 3. The register of media Arabic (لغة وسائل الإعلام)

The formulas readers of Arabic news expect, compiled into the writer's brief as a phrasebook, in
the spirit of the media-Arabic coursebooks: reporting (أفادت … بأن، نقلت … عن … قوله، أوضح، أشار
إلى أن، شدّد على، نفى، حذّر من، من جانبه / من جهته / بدوره for a second speaker, في تصريحات لـ،
في بيان صدر اليوم، على هامش), time and cause (عقب، إثر، غداة، على خلفية، في ظل، وسط، بعدما، فيما،
من المقرر أن، في غضون), and the economic lexicon (سجّل، بلغ، على أساس سنوي، مقارنة بـ، أعلى مستوى
منذ، نقطة أساس، العائد، سعر الصرف، الاحتياطي، العجز والفائض، الميزان التجاري، الدين العام،
التضخم الأساسي، العقود الآجلة، المعاملات الفورية، الصكوك، الاكتتاب، الاستحواذ، الموازنة، التقشف،
الدعم). Formulas carry the news; they never pad it, and the banned list above still applies.

## 4. The organisation

- **Sections** as the desks name them: الاقتصاد، الأسواق، الطاقة، الشركات، التكنولوجيا (الدفاع was folded into them on 2026-10-19), with
  تحليلات and مدخل إلى الاقتصاد (explainers of economic concepts and readings of open-access research papers, labelled شرح مبسّط and قراءة في ورقة بحثية) as hubs; beside the cover, قراءات خازندار carries the latest analysis and the latest explainers or paper readings, the paper's own voice in the place a daily keeps its columns. Cards and articles are labelled by section, never by form; only a real
  exclusive would earn a badge.
- **The kicker** (العنوان التمهيدي): the topic above the headline (الذهب، مضيق هرمز، التضخم) on
  the cover, the secondaries, the features, the section-page lead and the article page, linking to
  the topic's file; the section sits below in the meta line. Never on thumbnails or briefs.
- **Time** is relative and reads منذ ساعة، منذ 3 ساعات، منذ يومين; the article page prints
  نُشر with the date and Riyadh time.
- **Latest / most read / picks.** The strip under the section bar is الأحدث; مختارات المحرر stands
  in for the desks' اختيارات المحررين; there is no الأكثر قراءة because the site keeps no readership
  data and will not fake one.
- **Inside the article:** the trail in the meta line (القسم › الموضوع, as the Arab news sites print it); the first mention of up to four of the story's tags linked to their files, as Al Jazeera and the BBC link people, places and topics in their copy; اقرأ أيضاً after the third paragraph as a ruled line; tags; المصادر with
  the wire or publisher named; المزيد من القسم after the sources. Every story states its sources.
- **Running stories** live in ملفات (topic files) and the front's ملفات نتابعها band, the way the
  desks keep dossiers; regions are a second axis (بحسب المنطقة).
- **What we do not copy:** market-index tickers (no live data), AI-summary boxes, Arabic-Indic
  digits, long deks, form labels on every card.
