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
إن…), the hard figure behind the lede, or the contrast (وفي المقابل…). **The third** gives context
with وكان… or وجاء….

**Every figure** in this order: value, unit, direction, benchmark, time, source. Adjectives only
when quantified (أكبر زيادة منذ مايو); never "بشكل كبير".

**Attribution** once per paragraph, in the desks' forms: قال X في بيان إن (always إن after قال),
وأضاف، وأوضح، وأشار إلى أن، وفق بيانات صدرت الخميس، بحسب رويترز، نقلاً عن. أكد takes an object,
never أكد على. كشف only for what was hidden. **Expectations** belong to someone: يتوقع المجلس أن،
ترجّح الأسواق، مرشح لـ. Never a floating forecast.

**Texture.** One idea per sentence, no sentence over 35 words; paragraphs of one to three
sentences; concrete nouns (البرميل، الأونصة، العقود الآجلة، نقطة أساس، الجلسة، الإغلاق، المكاسب
الأسبوعية، المعاملات الفورية); active voice. Paragraph joints vary: و، وكان، وفي المقابل، ويأتي،
ورغم، وقال.

**Closings** are one of the desks' four: a sweep of related instruments, the next date to watch,
the concrete why-it-matters, or an attributed quote. Never a summary, never a moral.

**Banned** (the checker forces a revision; the desk rewrites): fillers في هذا السياق، تجدر
الإشارة، من الجدير بالذكر، يُذكر أن، لا يخفى، في نهاية المطاف، بالإضافة إلى ذلك، علاوة على ذلك،
من ناحية أخرى، على الرغم من ذلك؛ calques تم + مصدر، من قبل، يقوم بـ، يلعب دوراً، بشكل
كبير/ملحوظ/رئيسي، على صعيد، يعتبر، هناك ارتفاع في، شهد ارتفاعاً؛ clichés بمثابة، يسلط الضوء،
يمهد الطريق، نقطة تحول، مما يعكس. Preferred: نحو not حوالي، في الوقت نفسه، مديرو، أسهم، مهم.

**Headlines.** A nominal sentence: actor first, present-tense verb, the figure (الذهب يتجه لثالث
خسارة أسبوعية مع تصاعد رهانات رفع الفائدة). One idea, at most 12 words, never two developments
chained with و. The two-dot hinge is a desk form (النفط يشتعل.. برنت يتجاوز 100 دولار); the colon
carries a quoted speaker (صندوق النقد: الاقتصاد العالمي يتجه إلى نمو 3%). Definite references for
institutions (الإدارة الأمريكية or واشنطن, never إدارة أمريكية); a strong verb instead of يعلن عن +
verbal noun. No "!", no teaser, no تعرف على, no question headline for news (explainers may ask).

**Marks.** Western digits; pan-Arab month names; % after the figure; the Arabic comma (،); «» for
quotations and foreign brand names; tanween on the alef (اً).

## 2. The editing (فن التحرير الصحفي)

A paper is edited, not filled. The editor model scores every candidate on the news values an
Arabic desk edits by: التأثير (does it change money, prices, jobs or policy for our readers),
الأهمية (a central bank, a government, a market, a major company), الآنية (decided or happened now;
a figure already reported is news again only if the change is material), القرب (the Gulf, Egypt,
the Levant, the Maghreb, or the global forces that move them), الضخامة (the size of the number),
الصراع والنتائج (winners, losers, what follows). A story needs three of them; importance below 6
is not published; the editor states the values in its answer. Development beats repetition: a
candidate that advances a running file is preferred to an unrelated marginal item, and the angle
must say what is new. Hard limits in `pipeline/run.mjs`: at most four stories a run and ten news
stories in any 24 hours (`KHAZENDAR_DAILY_CAP`); `pipeline/lib/verify.mjs` rejects a story whose
headline shares half its content words with one published in the last four days, so the same rate
rise cannot run twice under two headlines. Explainers and analyses are one a day each.

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
- **Inside the article:** اقرأ أيضاً after the third paragraph as a ruled line; tags; المصادر with
  the wire or publisher named; المزيد من القسم after the sources. Every story states its sources.
- **Running stories** live in ملفات (topic files) and the front's ملفات نتابعها band, the way the
  desks keep dossiers; regions are a second axis (بحسب المنطقة).
- **What we do not copy:** market-index tickers (no live data), AI-summary boxes, Arabic-Indic
  digits, long deks, form labels on every card.
