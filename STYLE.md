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

**The second paragraph** does one of three things: the source's own words (وقال البنك في بيان
إن…), the hard figure behind the lede, or the contrast (وفي المقابل…, only for a real opposite).
**The third** gives the background in its own sentence with وكان … قد.

**Every figure** in this order: value, unit, direction, benchmark, time, source. Adjectives only
when quantified (أكبر زيادة منذ مايو); never "بشكل كبير".

**Attribution** in the desks' forms: قال X في بيان إن (always إن after قال), وأضاف، وأوضح، وأشار
إلى أن، وفق بيانات صدرت الخميس، بحسب رويترز، نقلاً عن. Each source is named once, where its
information first enters; after that the reporting verb or one attribution at the head of the
paragraph carries it. Never two sentences in a row tagged وفقاً لـ/بحسب, never وفقاً للمصدر نفسه,
never one outlet more than three times in a story (the checker sends back a story that tags more
than a third of its sentences). أكد takes an object, never أكد على. كشف only for what was hidden.
**Expectations** belong to someone: يتوقع المجلس أن، ترجّح الأسواق، مرشح لـ. Never a floating
forecast.

**Texture.** One idea per sentence, no sentence over 35 words; paragraphs of one to three
sentences; concrete nouns (البرميل، الأونصة، العقود الآجلة، نقطة أساس، الجلسة، الإغلاق، المكاسب
الأسبوعية; المعاملات الفورية only for spot prices, never futures); active voice.

**Joints with a job** (added 2026-09-23, from an audit of the published paper that found the machine
now shows in structure more than in words). Arabic's own joints: و، فـ، فقد، ثم، لكن، أما … فـ،
وكان … قد، ورغم، وقال. Background in its own sentence with وكان … قد, never ويأتي/وجاء + noun + في
وقت/في ظل/وسط, never يأتي ذلك. «، إذ» only when the clause explains the one before, never before a
reporting verb. فيما/بينما only for two things at once, never to slip a second development into the
dek. وفي المقابل only for a real opposite; حيث only for a place; مما at most once.

**Arabic sentences, not English ones in Arabic words.** Open with the verb; no chain of more than three
nouns in an إضافة. "Whether" is هل, never ما إذا كان; "in terms of" is a verb, never من حيث; "was set
to" is كان مقرراً أن, never كان سيـ; "as a" is بوصفه or a rephrase, never كـ + noun; بشكل/بصورة +
adjective becomes the adverb or the figure; يتم/تم + verbal noun becomes the verb. An abstract noun
never judges: name who does. **Idioms and trade terms** are translated by meaning, never word for
word (industrial-scale, crown jewels, guardrails, ground stop, term contracts, lagged effects,
intraday, grounded, "Senator X of Alaska" = السيناتور عن ألاسكا); a phrase that needs a sentence to
explain it is the wrong phrase.

**Each field adds something.** The dek carries the second most important fact, never a figure from the
lede; the first body paragraph moves the story on and never retells the lede; لماذا يهمّ states one
concrete consequence that a source reports or that follows from the story's own figures, names an Arab
country, company or price only when a source makes the link, and never recaps, speculates in chains
(قد يؤدي… مما قد…), addresses the reader or opens with يعكس/يمثل/يُعدّ. A sentence whose facts already
appear higher up is deleted. The copy desk may cut a repeat because its guard counts facts over the
whole story: a figure, a name or a hedged claim may leave a place where it repeats, never the story.

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
chained with و. The two-dot hinge is a desk form (النفط يشتعل.. برنت يتجاوز 100 دولار); the colon
carries a quoted speaker (صندوق النقد: الاقتصاد العالمي يتجه إلى نمو 3%). Definite references for
institutions (الإدارة الأمريكية or واشنطن, never إدارة أمريكية); a strong verb instead of يعلن عن +
verbal noun. No "!", no teaser, no تعرف على, no question headline for news (explainers may ask).

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

**Captions** (added 2026-09-23, the owner: "a human writer would not describe the sky"). A photo caption
names; it does not paint. Three to ten words, a noun phrase: what the photograph shows and, when the file
itself says so, where (مصفاة نفط في هيوستن بولاية تكساس الأميركية؛ مقر بورصة نيويورك في وول ستريت؛
أفق القاهرة). Never the weather, the sky, clouds, light, time of day, colours, mood, size impressions,
the camera or the composition (تحت سماء…، منظر، مشهد، لقطة، في الخلفية، صورة تظهر، ضخمة، حمراء). A stock
illustration names no place and carries «(صورة تعبيرية)». The rule is `CAPTION_RULE` and the check
`captionFlaws()` in `pipeline/lib/images.mjs`; `node pipeline/recaption-images.mjs` rewrites published
captions by it.

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

**A small event runs as a brief.** The shortest news story accepted is 120 words, 100 when the desk notes
hold fewer than ten facts (`newsFloor()` in `pipeline/lib/write.mjs`; 200 until 2026-09-24). It is a safety
net, not a target: the brief still asks for 300-550 words when the material carries them, and a writer pushed
past what the material holds pads or fails. That day a Gulf story failed ten attempts at 119 to 199 words and
an Abu Dhabi regulation with fourteen small facts three at 140 to 152; Claude judged both brief-sized, as the
desks would. A retry is now told why the last answer was refused (`chat()` in `pipeline/lib/llm.mjs`), where
three identical requests had come back the same. A story that fails outright takes the rejection mark, so the
editor does not choose it again in the next run.

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

- **Sections** as the desks name them: الاقتصاد، الأسواق، الطاقة، الشركات، التكنولوجيا، الدفاع, with
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
