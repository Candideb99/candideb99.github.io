/**
 * The Arabic copy desk (محرر الصياغة).
 *
 * The free models think in English and it shows: "إدارة أمريكية تعلن عن مستردات" is English syntax
 * in Arabic letters. The desk rewrites a draft's headline, dek, lede and «لماذا يهمّ» box (and the body
 * when asked) into the idiom of an Arabic daily, and a guard throws any rewrite away that touches a fact:
 * no figure, name or Latin token may appear that the story did not carry, none may leave the story, a
 * hedged claim may never come back as an assertion, the length must stay in range and the text Arabic.
 * The owner's rule, 2026-09-11: no literal translations.
 *
 * 2026-09-23: the audit of the published paper found the machine now shows in structure more than in words
 * (English sentences in Arabic words, one fact told in four fields, a source tag on every sentence, stock
 * joints). Saying a fact once means deleting where it repeats, which the old guard forbade (every figure
 * had to come back in its own field), so the guard now counts figures and names across the whole story:
 * a fact may leave a place where it repeats, never the story.
 */
import { chat } from "./llm.mjs";
import { arabicRatio, normalizeDigits } from "./util.mjs";
import { BANNED, contentWords, styleIssues } from "./style.mjs";

export const DESK_SYSTEM = `You are the Arabic copy desk (محرر الصياغة) of خازندار, an Arabic economics news website (online only, never a newspaper) for educated readers across the Arab world. A correspondent who thinks in English wrote the draft; you make it read as if a native Arabic news editor wrote it, in clear Modern Standard Arabic (فصحى معاصرة) in the register of الشرق الأوسط and الاقتصادية. Translated words are half of what gives a draft away; the other half is structure, repetition and rhythm.

WHAT YOU CHANGE
- English sentences in Arabic words. Open with the verb. Never chain more than three nouns in an إضافة; turn the rest into a verb clause («ويرجّح التباين أن المنفذ البديل من محددات تفاوت وقع الاضطراب» → «والفارق بين الحالتين يرجّح أن المنفذ البديل من أسباب تفاوت الضرر»). "Whether" is «هل», never «ما إذا كان». "In terms of" becomes a verb, never «من حيث». "Was set to" is «كان مقرراً أن», never «كان سيـ». "As a" is «بوصفه» or a rephrase, never «كـ» + noun («كجزء من»، «كمصدر»). An abstract noun is never the subject of يرجّح/يفسّر/يعكس: name who judges. «بشكل/بصورة» + adjective becomes the adverb or the figure («سراً»، «بنشاط»). «تم/يتم» + verbal noun becomes the verb. Indefinite subjects where Arabic uses the definite or the name ("إدارة أمريكية" → "الإدارة الأمريكية" or "واشنطن"); a strong verb instead of "يعلن عن" + verbal noun.
- Idioms and trade terms translated word for word. Write what they mean, as the Arab business desks write it: industrial-scale → «واسع»؛ crown jewels → «أثمن أصولها»؛ guardrails → «ضوابط»؛ ground stop → «علّقت الرحلات المتجهة إلى»؛ term contracts → «العقود طويلة الأجل»؛ surprisingly strong → «أقوى من المتوقع»؛ lagged effects → «الآثار اللاحقة»؛ intraday → «خلال الجلسة»؛ grounded → «مُنعت من الطيران»؛ choke point → «ممر حيوي»؛ mixed signals → «إشارات متضاربة»؛ "Senator X of Alaska" → «السيناتور عن ألاسكا»؛ by mistake → «خطأً»؛ at the pump → «أسعار الوقود». If a phrase needs a sentence to explain it, the phrase is wrong: replace it and drop the explanation.
- Repetition. Every field adds something the reader has not seen yet. The dek carries the second most important fact, never a figure the lede already gives. The first body paragraph moves the story forward (the source's own words, the hard figure behind the lede, or the contrast) and never retells the lede. Delete every body sentence whose facts already appear higher up, and fold a sentence that repeats half a fact into the one that carries it. A fact removed from one place must remain once in the story.
- Attribution. Name each source once, where its information first enters. After that the reporting verb («وأضاف»، «وأوضح») or one attribution at the head of the paragraph («وبحسب رويترز، …») carries it. Never tag two sentences in a row with «وفقاً لـ/بحسب»; never «وفقاً للمصدر نفسه»; never one outlet more than three times in a story; a market price needs its source once. The BBC is «بي بي سي», never «الهيئة».
- Joints with a job. Background goes in its own sentence with «وكان … قد», never «ويأتي/وجاء + noun + في وقت/في ظل/وسط» and never «يأتي ذلك». «، إذ» only when the clause explains the one before, never before a reporting verb («، إذ ذكر» → «؛ فقد … بحسب»). «فيما/بينما» only for two things happening at once, never to slip a second development into the dek. «وفي المقابل» only for a real opposite. «حيث» only for a place. «مما» at most once. Prefer Arabic's own joints: «و»، «فـ»، «فقد»، «ثم»، «لكن»، «أما … فـ»، «وكان … قد».
- Templates. At most one «الأول… والثاني» list and one «ليس… بل» contrast in a piece; no «السؤال الحقيقي»، «معادلة صعبة»، «أمام اختبار صعب»، «ليس مجرد»؛ a dek is one statement, not a how/why/what list; «حاد، انهيار، تاريخي، الاستراتيجي، جداً» only beside the number that earns them; the last paragraph is never an unattributed verdict.
- Hedges. A hedge stays a hedge, but it is said once and plainly: at most one per paragraph, varied («والأرجح أن»، «يبدو»، «لا يُستبعد أن»، «قد»); never two sentences in a row opening with one; «يرجّح أن» with no subject becomes «والأرجح أن» or names who judges.
- «لماذا يهمّ» (whyItMatters). Two or three sentences stating ONE concrete consequence that the story itself supports; it may reuse a body figure only as the premise of that consequence. Delete what no line of the story supports: a link to «المنطقة», the Middle East, Arab readers or an Arab country that the story never makes; a chain of «قد يؤدي… مما قد…»; a sentence telling the reader what to understand; an opening «يعكس/يمثل/يُعدّ». Never leave it empty and never add a fact to it.
- Dates. The weekday for this week («الجمعة»), the month for this year («في 18 سبتمبر»), the year only when it is not the current one; never an ISO date, never «بتاريخ», never «اليوم» or «أمس» (stored copy outlives the day: write the weekday).
- Speech. Words spoken in another language are reported («قال إن»، «وأضاف أن»), never put in quotation marks; straight quotes "…" never appear. «» holds only a verbatim Arabic quotation, and names.
- Grammar. Case endings on numbers and duals («ألفي رحلة»، «تعلن حلاً جزئياً»); agreement (a company takes a feminine verb: «بارامونت تتوصل إلى تسوية»); the counted noun («5 مليارات»، «108.1 دولار»، «49 محركاً»); «بين 4 و5», never «بين 4 إلى 5»; a sentence never opens with a digit; prepositions («تصل إلى 50%»، «إلى أعلى مستوى»).
- Headline discipline. ONE idea carrying the key fact or number, 35 to 80 characters, verb-led where natural, no word said twice, no two developments chained with "و", no colon teaser, no question. When a headline chains two stories, keep the more important one and let the dek carry the other, without dropping any fact from the pair.
- Fillers, calques and clichés the desks cut: «في هذا السياق»، «تجدر الإشارة»، «من الجدير بالذكر»، «يُذكر أن»، «بالإضافة إلى ذلك»، «علاوة على ذلك»، «من ناحية أخرى» (→ «وفي المقابل» for a real opposite)، «على الرغم من ذلك» (→ «لكن»)، «من قبل» (→ active)، «يقوم بـ» (→ the verb)، «يلعب دوراً» (→ «يؤدي دوراً»)، «على صعيد» and «على مستوى» (→ «في»)، «يعتبر» / «بمثابة» (→ state the fact)، «يسلط الضوء» (→ «يبيّن»)، «يمهد الطريق»، «نقطة تحول»، «مما يعكس» and «ما يعكس» (→ «في مؤشر على» or a plain verb)، «في خطوة»، «في إطار»، «حوالي» (→ «نحو»)، «في نفس الوقت» (→ «في الوقت نفسه»)، «هناك ارتفاع في» / «شهد ارتفاعاً» (→ «ارتفع»). After «قال» comes «إن», never «أن»; «أكد» takes an object.
- Texture. Split any sentence over 35 words into two; keep paragraphs to one to three sentences; prefer the desks' market vocabulary (الجلسة، الإغلاق، المكاسب الأسبوعية، نقطة أساس، العقود الآجلة؛ «المعاملات الفورية» only for spot prices, never for futures).
- Headline forms of the desks are welcome: the two-dot hinge («النفط يشتعل.. برنت يتجاوز 100 دولار») and the colon for a quoted speaker («صندوق النقد: …»).
- Marks between clauses are Arabic ones: the comma, «؛» or parentheses; never a dash (— or –) to set off a clause, which is English punctuation.
- Names and marks. Foreign names transliterated the way Arab business media write them, one spelling throughout («أمريكي»، «ترامب»); foreign programme and brand names in «» (e.g. «أوباماكير», «ناتس»); the Arabic comma (،) and «» quotation marks; Western digits; pan-Arab month names. A transliteration that reads as an Arabic word or pronoun is an error to fix: the Chinese surname He is خه, never هي («بيسنت وهي لفيفنغ» must become «بيسنت وخه لي فنغ»); Xi is شي, Li is لي, Wang is وانغ, Liu is ليو.

WHAT YOU NEVER CHANGE
- Facts. Every number, date, name, attribution ("بحسب", "وفقاً لـ", "قال"), quotation and causal claim keeps its meaning; an expectation stays an expectation ("يتجه لرفع" never becomes "يرفع"; "يعد بـ" never becomes "يعلن"; "قد" and "من المتوقع" stay with their claim), and so does every count written in letters ("جزأين من أربعة" means two of four and must stay two of four; "ثلاث شركات" stays three). You add no fact, no context, no adjective and no interpretation. A fact may leave a place where it repeats; it never leaves the story. A sentence that is already idiomatic stays as it is.
- Latin tokens (tickers, acronyms, Latin names in parentheses) stay verbatim. The one exception is a lowercase English word left inside an Arabic sentence (outlook, total, know-how, shares): that is a translation the writer forgot, not a name; write its meaning in Arabic (التوقعات، الإجمالي، الخبرة الفنية، الأسهم) and never leave it in Latin letters.
- Structure. The lede stays two or three sentences; the body keeps its order, its blank lines between paragraphs and any "## " subheads, and gets shorter only by what repeats; no markdown links, no URLs.

You answer with one JSON object and nothing else.`;

const EXAMPLES = `EXAMPLES (before → after)
- إدارة أمريكية تعلن عن مستردات بقيمة 500 دولار لمستخدمي أوباماكير قبل الانتخابات → واشنطن تعيد 500 دولار للمشتركين في «أوباماكير» قبل الانتخابات
- عطل تقني في نظام ناتس يُلغي أكثر من ألفين رحلة ويكشف عن هشاشة النظام الجوي البريطاني → عطل في نظام «ناتس» يلغي أكثر من ألفي رحلة في بريطانيا
- وظائف أميركا القوية تعيد رفع الفائدة للأضواء وسيتي تعدل مسار الخفض إلى 2027 → قوة سوق العمل الأمريكية تعيد رفع الفائدة إلى الواجهة (the dek then carries: «سيتي» ترجّح تأجيل خفض الفائدة إلى 2027)
- …إن الإدارة تبحث جدوى الحظر من حيث طاقة التكرير الإجمالية، وما إذا كان الحظر الكلي أو الجزئي سينجح → …إن الإدارة تدرس هل تحتمل طاقة التكرير الأمريكية في مجملها حظراً كهذا، وأيّ الحظرين أنجع: الكامل أم الجزئي
- ووصف راتكليف سياسة الطاقة التي تتبعها الحكومة البريطانية بأنها تقود إلى تخريب اقتصادي على نطاق صناعي → ووصف راتكليف سياسة الحكومة البريطانية في الطاقة بأنها تخريب واسع للاقتصاد
- وقال بنك اليابان إنه مستعد لمواصلة رفع تكاليف الاقتراض لمواجهة ضغوط التضخم، وفقاً لألبورصة نيوز. واعترض عضوين في بنك اليابان على قرار رفع الفائدة، مما خفف توقعات تشديد السياسة النقدية بسرعة، وفق نفس المصدر. → وقال البنك إنه مستعد لمواصلة رفع تكلفة الاقتراض لمواجهة ضغوط التضخم، لكن اعتراض عضوين فيه على القرار خفّف توقعات تشديد السياسة النقدية بسرعة، بحسب «البورصة نيوز».
- ويأتي القرار في وقت ارتفعت فيه الأسعار حول العالم بفعل تعطل إمدادات النفط والغاز عبر مضيق هرمز → وكانت الأسعار قد ارتفعت حول العالم منذ تعطلت إمدادات النفط والغاز عبر مضيق هرمز
- غير أن كلفة النقل البحري بقيت مرتفعة، إذ ذكر «أويل برايس» أن العائد اليومي لناقلة على مسار الخليج إلى الصين قفز هذا الأسبوع إلى 1.2 مليون دولار. → غير أن كلفة النقل البحري بقيت مرتفعة؛ فقد قفز العائد اليومي لناقلة على مسار الخليج إلى الصين هذا الأسبوع إلى 1.2 مليون دولار، بحسب «أويل برايس».
- (the lede already says the share jumped 10% to a record on Monday) وأوضحت الشبكة أن قفزة الاثنين دفعت السهم إلى مستوى قياسي، وجاءت ضمن خمس جلسات صعود متتالية ربح خلالها نحو 25%. → وكانت قفزة الاثنين خامس جلسة صعود على التوالي، ربح السهم خلالها نحو 25%.
- (whyItMatters; the body gives the 30 September deadline) كما أن تجنب الرسوم اليومية بقيمة 7 ملايين دولار يوفر على بارامونت تكاليف كبيرة، مما قد يعزز سيولته المالية لاستثمار أكبر في الأسواق الناشئة، بما في ذلك الشرق الأوسط وشمال إفريقيا. → وإتمام الاندماج قبل 30 سبتمبر يجنّب «بارامونت» رسوماً قدرها 7 ملايين دولار عن كل يوم.`;

/** The clitic a count word, a dual or a hedge may carry attached (وثلاث، بألفي، لعامين، وقد): the guard reads through it. */
const CLITIC = "(?:و|ف|ب|ل|ك)?";
/** Quantities written in letters: a rewrite that turns "جزأين من أربعة" into "جزئي" has changed a fact. The word itself is group 1. */
const NUMBER_WORDS = new RegExp(`(?<![؀-ۿ])${CLITIC}(?:ال)?(واحد|واحدة|اثنان|اثنين|اثني|اثنتان|اثنتين|اثنتي|ثلاث|ثلاثة|أربع|أربعة|خمس|خمسة|ست|ستة|سبع|سبعة|ثماني|ثمانية|تسع|تسعة|عشر|عشرة|عشرون|عشرين|ثلاثون|ثلاثين|أربعون|أربعين|خمسون|خمسين|ستون|ستين|سبعون|سبعين|ثمانون|ثمانين|تسعون|تسعين|مئة|مائة|مئتان|مئتين|مئتي|مائتان|مائتين|مائتي|ألف|ألفا|ألفي|ألفان|ألفين|آلاف|مليون|مليونا|مليوني|مليونان|مليونين|ملايين|مليار|مليارا|ملياري|ملياران|مليارين|مليارات|تريليون|تريليونا|تريليوني|تريليونان|تريليونين|تريليونات|نصف|ربع|ثلث|ثلثي|ثلثين|ثلثان|ضعف|ضعفي|ضعفين|ضعفان|أضعاف)(?![؀-ۿ])`, "g");
/** Count-bearing duals (جزأين، شركتين، عامين): a curated list, because the plural suffix ين looks the same. The word itself is group 1. */
const DUALS = new RegExp(`(?<![؀-ۿ])${CLITIC}(?:ال)?(جزأين|جزءان|جزءين|شركتين|شركتان|عامين|عامان|يومين|يومان|شهرين|شهران|أسبوعين|أسبوعان|ساعتين|ساعتان|سنتين|سنتان|مرتين|مرتان|ضعفين|ضعفان|نقطتين|نقطتان|بلدين|بلدان|دولتين|دولتان|ولايتين|ولايتان|مدينتين|مدينتان|قطاعين|قطاعان|مصنعين|مصنعان|بنكين|بنكان|طرفين|طرفان|جانبين|جانبان|مرحلتين|مرحلتان|جولتين|جولتان|صفقتين|صفقتان|اتفاقيتين|اتفاقيتان|خطوتين|خطوتان|حزمتين|حزمتان|سفينتين|سفينتان|ناقلتين|ناقلتان|محطتين|محطتان|مشروعين|مشروعان|عقدين|عقدان|فصلين|فصلان|ربعين|ربعان|نصفين|نصفان|ثلثين|ثلثان|رقمين|رقمان|سهمين|سهمان|منتجين|منتجان|مصدرين|مصدران|وزيرين|وزيران|رئيسين|رئيسان|قرارين|قراران|تقريرين|تقريران|حالتين|حالتان|سيناريوهين|سيناريوهان)(?![؀-ۿ])`, "g");

/**
 * One stem per quantity, whatever its case or gender: the desk's own grammar fixes (ألفين رحلة → ألفي رحلة,
 * ثلاثة شركات → ثلاث شركات) change no fact and must pass the guard; ألفين → ألف (a different count) must not.
 */
const NUMBER_STEMS = [
  [/^(?:واحد|واحدة)$/, "واحد"],
  [/^(?:اثنان|اثنين|اثني|اثنتان|اثنتين|اثنتي)$/, "اثنان"],
  [/^(?:ثلاث|ثلاثة)$/, "ثلاثة"],
  [/^(?:أربع|أربعة)$/, "أربعة"],
  [/^(?:خمس|خمسة)$/, "خمسة"],
  [/^(?:ست|ستة)$/, "ستة"],
  [/^(?:سبع|سبعة)$/, "سبعة"],
  [/^(?:ثماني|ثمانية)$/, "ثمانية"],
  [/^(?:تسع|تسعة)$/, "تسعة"],
  [/^(?:عشر|عشرة)$/, "عشرة"],
  [/^(?:عشرون|عشرين)$/, "عشرون"],
  [/^(?:ثلاثون|ثلاثين)$/, "ثلاثون"],
  [/^(?:أربعون|أربعين)$/, "أربعون"],
  [/^(?:خمسون|خمسين)$/, "خمسون"],
  [/^(?:ستون|ستين)$/, "ستون"],
  [/^(?:سبعون|سبعين)$/, "سبعون"],
  [/^(?:ثمانون|ثمانين)$/, "ثمانون"],
  [/^(?:تسعون|تسعين)$/, "تسعون"],
  [/^(?:مئة|مائة)$/, "مئة"],
  [/^(?:مئتان|مئتين|مئتي|مائتان|مائتين|مائتي)$/, "مئتان"],
  [/^(?:ألف|ألفا)$/, "ألف"],
  [/^(?:ألفان|ألفين|ألفي)$/, "ألفان"],
  [/^(?:مليون|مليونا)$/, "مليون"],
  [/^(?:مليونان|مليونين|مليوني)$/, "مليونان"],
  [/^(?:مليار|مليارا)$/, "مليار"],
  [/^(?:ملياران|مليارين|ملياري)$/, "ملياران"],
  [/^(?:تريليون|تريليونا)$/, "تريليون"],
  [/^(?:تريليونان|تريليونين|تريليوني)$/, "تريليونان"],
  [/^(?:ثلثان|ثلثين|ثلثي)$/, "ثلثان"],
  [/^(?:ضعفان|ضعفين|ضعفي)$/, "ضعفان"],
];
function numberStem(word) {
  for (const [re, stem] of NUMBER_STEMS) if (re.test(word)) return stem;
  return word;
}
/** A quantity in letters and the same quantity in digits are one fact (سبع سفن / 7 سفن); fractions and multiples stay words. */
const NUMBER_VALUES = { واحد: "1", اثنان: "2", ثلاثة: "3", أربعة: "4", خمسة: "5", ستة: "6", سبعة: "7", ثمانية: "8", تسعة: "9", عشرة: "10", عشرون: "20", ثلاثون: "30", أربعون: "40", خمسون: "50", ستون: "60", سبعون: "70", ثمانون: "80", تسعون: "90", مئة: "100", مئتان: "200", ألف: "1000", ألفان: "2000", مليون: "1000000", مليونان: "2000000", مليار: "1000000000", ملياران: "2000000000", تريليون: "1000000000000", تريليونان: "2000000000000" };

/** Digits and number words of a text, as a list of tokens a rewrite may rearrange but never invent or lose. */
function numberTokens(text) {
  // "13 بالمئة" and "13%" are one figure: the percent phrase is a unit, not the quantity مئة.
  const t = normalizeDigits(String(text ?? ""))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/\s*(?:بالمئة|بالمائة|في المئة|في المائة)(?![؀-ۿ])/g, "%");
  // A thousands separator is formatting, not fact: "4,000" and "4000" are one figure.
  const digits = (t.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/,(?=\d{3}(?!\d))/g, ""));
  const words = [...t.matchAll(NUMBER_WORDS)].map((m) => NUMBER_VALUES[numberStem(m[1])] ?? numberStem(m[1]));
  return [...digits, ...words];
}
/**
 * A Latin token the guard protects is a name, a ticker, an acronym or a unit: it carries a capital
 * letter or a digit, or it is short. An all-lowercase English word of four letters or more (outlook,
 * total, know-how) is never a fact — it is a word the writer failed to translate — so the desk is
 * allowed to turn it into Arabic. 2026-09-21: ten of 68 articles carried one, and the guard was the
 * reason the copy desk could not fix them.
 */
function latinTokens(text) {
  return (String(text ?? "").match(/[A-Za-z][A-Za-z0-9&+.-]*[A-Za-z0-9]|[A-Za-z]/g) ?? [])
    .filter((w) => !/^[a-z][a-z-]{3,}$/.test(w))
    .map((w) => w.toLowerCase());
}
/** The short «…» spans of a text: company, brand and programme names the story must keep. */
function quotedNames(text) {
  return [...String(text ?? "").matchAll(/«([^«»\n]{1,40})»/g)]
    .map((m) => m[1].trim())
    .filter((n) => n && n.split(/\s+/).length <= 4 && !BANNED.some((r) => r.hard && n.match(r.re)));
}
const dualsOf = (text) => [...String(text ?? "").matchAll(DUALS)].map((m) => m[1]);

/** The same word twice in a row (the back-reference is the point: "يتوسعون يتوسعون"). */
const STUTTER = /(?<![؀-ۿ])([؀-ۿ]{3,})\s+\1(?![؀-ۿ])/;
/**
 * The hedges an expectation is written with, read through an attached clitic (وقد، ومن المتوقع), in two
 * kinds (see hedgeKind): what is uncertain and what is promised. A rewrite may say a hedge another way of
 * the same kind («يرجّح أن» → «والأرجح أن»), never drop it from its claim. "يعد" counts only in its promise
 * sense (يعد بخفض), never as "is considered". "قد" is a hedge only before a present-tense verb («قد يرفع»);
 * before a past verb it is emphasis («وقد ارتفع»، «فقد قفز»), and "لقد" never hedges.
 */
// Word edges are letters and marks, not the Arabic block: «،» and «؛» sit inside it, and «والأرجح،» must count.
const HEDGES = new RegExp(`(?<![\\p{L}\\p{M}])${CLITIC}(?:ال)?(يتجه|تتجه|قد(?<!لقد)(?= [يتن])|من المتوقع|متوقع|متوقعة|مرشح|مرشحة|محتمل|محتملة|من المحتمل|أرجح|مرجح|يُرجَّح|يُرجّح|يرجّح|يرجح|ترجح|ترجّح|ربما|يبدو|تبدو|يُستبعد|يستبعد|يتوقع|تتوقع|توقعات|توقع|تعهد|تعهدت|يعد(?=(?: [؀-ۿ]+){0,2} ب[؀-ۿ])|تعد(?=(?: [؀-ۿ]+){0,2} ب[؀-ۿ])|وعد|وعدت|يعتزم|تعتزم|يخطط|تخطط|قريباً|قريبا)(?![\\p{L}\\p{M}])`, "gu");
// Two kinds: what is uncertain (a forecast or a possibility: «تتوقع المنظمة» may become «ترجّح المنظمة», both
// leave the claim open) and what is promised (a pledge or a plan is not a likelihood).
function hedgeKind(word) {
  if (/^(?:تعهد|تعهدت|يعد|تعد|وعد|وعدت|يعتزم|تعتزم|يخطط|تخطط|قريباً|قريبا)$/.test(word)) return "promised";
  return "uncertain";
}
const hedgeKinds = (text) => new Set([...String(text ?? "").matchAll(HEDGES)].map((m) => hedgeKind(m[1])));
const sentencesOf = (text) => String(text ?? "").split(/(?<=[.؟!])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);

/**
 * Every hedged claim of the original that is still in the story must still be hedged. A claim is found by
 * its words (the rewritten sentence that carries most of them, and the one after it, since the desk may
 * split a sentence); a claim the desk cut as a repeat or as unsupported is no longer in the story and asserts
 * nothing. Returns the first claim that came back as an assertion, or null.
 */
function assertedClaim(before, after) {
  const target = sentencesOf(after).map((s) => ({ s, words: new Set(contentWords(s)) }));
  for (const sentence of sentencesOf(before)) {
    const kinds = hedgeKinds(sentence);
    if (!kinds.size) continue;
    const words = contentWords(sentence);
    if (!words.length) continue;
    let best = -1;
    let score = 0;
    target.forEach((t, i) => {
      const share = words.filter((w) => t.words.has(w)).length / words.length;
      if (share > score) [best, score] = [i, share];
    });
    if (best < 0 || score < 0.34) continue;
    const kept = hedgeKinds(`${target[best].s} ${target[best + 1]?.s ?? ""}`);
    if ([...kinds].some((k) => !kept.has(k))) return sentence;
  }
  return null;
}

/** The house writes tanween on the alef (اً), not before it (ًا); models mix the two. */
function houseTanween(text) {
  return String(text ?? "").replace(/ًا/g, "اً");
}

/** How far each field may shrink or grow; the body's floor is set per story by how much of it repeats. */
const BOUNDS = { title: [0.45, 1.6], subtitle: [0.5, 1.5], lede: [0.6, 1.5], whyItMatters: [0.35, 1.3], body: [0.8, 1.25] };

/**
 * Judges one rewritten field on its own: everything but the facts, which are counted over the whole story
 * (see `judgeRewrite`). Returns { ok, reason }. `floor` overrides the lower length bound.
 */
export function fieldGuard(field, before, after, { floor } = {}) {
  const a = String(before ?? "").trim();
  const b = String(after ?? "").trim();
  if (!b) return { ok: false, reason: "empty" };
  if (b === a) return { ok: false, reason: "unchanged" };
  if (/https?:\/\/|\]\(/.test(b)) return { ok: false, reason: "link introduced" };
  // A word repeated back to back ("يتوسعون يتوسعون") is a model stutter, never Arabic.
  if (STUTTER.test(b) && !STUTTER.test(a)) return { ok: false, reason: "a word was doubled" };
  const [lo0, hi] = BOUNDS[field] ?? [0.6, 1.5];
  const lo = floor ?? lo0;
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < lo || ratio > hi) return { ok: false, reason: `length ${ratio.toFixed(2)}x` };
  if (arabicRatio(a) > 0.5 && arabicRatio(b) < 0.55) return { ok: false, reason: "not Arabic enough" };
  if (field === "body") {
    const heads = (t) => (t.match(/^## .*$/gm) ?? []).length;
    if (heads(a) !== heads(b)) return { ok: false, reason: "subheads changed" };
  }
  return { ok: true };
}

const STORY_FIELDS = ["title", "subtitle", "lede", "whyItMatters", "body"];
const storyText = (d) => STORY_FIELDS.map((f) => String(d[f] ?? "")).join("\n");

/** How much of the body only repeats what the headline, dek, lede or an earlier body sentence said: the share the desk may cut. */
function repeatedShare(draft) {
  const seen = new Set(contentWords(`${draft.title}\n${draft.subtitle}\n${draft.lede}`));
  let repeated = 0;
  let total = 0;
  for (const s of sentencesOf(draft.body)) {
    const words = contentWords(s);
    total += s.length;
    if (words.length && words.filter((w) => seen.has(w)).length / words.length >= 0.6) repeated += s.length;
    words.forEach((w) => seen.add(w));
  }
  return total ? repeated / total : 0;
}

/**
 * Accepts or refuses each rewritten field. A field is refused for its own faults (length, a stutter, a lost
 * subhead) or when it carries a figure, a Latin token or a dual the story did not have. Then the story as a
 * whole must keep every figure, «» name, Latin token and dual it had, and every hedged claim still in it
 * must still be hedged; a field that broke that goes back to its original, until the story holds.
 * Returns { accepted: {field: text}, rejected: [{field, reason, proposal}] }.
 */
export function judgeRewrite(draft, proposal, fields, { year = new Date().getUTCFullYear(), minFloor = 0.55 } = {}) {
  const before = storyText(draft);
  // The current year is the one figure a rewrite may drop (the desks print the year only when it is not this
  // one); it is exempt from the loss check below, never from the invention check.
  const had = { numbers: new Set(numberTokens(before)), latin: new Set(latinTokens(before)), duals: new Set(dualsOf(before)), names: [...new Set(quotedNames(before))] };
  // The body may shrink by what repeats, never below 55% of itself unless the caller lowers that floor for a
  // story that is nearly all repetition (pipeline/copydesk.mjs --floor=…, reviewed by hand).
  const floor = minFloor < 0.55 ? minFloor : Math.max(0.55, Math.min(0.8, 1 - repeatedShare(draft) - 0.05));
  const accepted = {};
  const rejected = [];
  for (const f of fields) {
    if (typeof proposal[f] !== "string") continue;
    const after = houseTanween(proposal[f]).trim();
    const local = fieldGuard(f, draft[f], after, f === "body" ? { floor } : {});
    if (!local.ok) {
      if (local.reason !== "unchanged") rejected.push({ field: f, reason: local.reason, proposal: f === "body" ? undefined : after });
      continue;
    }
    const invented = [...numberTokens(after).filter((t) => !had.numbers.has(t)), ...latinTokens(after).filter((t) => !had.latin.has(t)), ...dualsOf(after).filter((t) => !had.duals.has(t))];
    if (invented.length) {
      rejected.push({ field: f, reason: `numbers changed (${[...new Set(invented)].slice(0, 4).join("، ")})`, proposal: f === "body" ? undefined : after });
      continue;
    }
    accepted[f] = after;
  }
  // Nothing may leave the story, and no hedged claim may come back as an assertion.
  for (let round = 0; round < fields.length; round++) {
    const current = { ...draft, ...accepted };
    const now = storyText(current);
    const nums = new Set(numberTokens(now));
    const latin = new Set(latinTokens(now));
    const duals = new Set(dualsOf(now));
    const lost = [
      ...[...had.numbers].filter((t) => !nums.has(t) && t !== String(year)).map((t) => ["number", t]),
      ...[...had.latin].filter((t) => !latin.has(t)).map((t) => ["latin", t]),
      ...[...had.duals].filter((t) => !duals.has(t)).map((t) => ["dual", t]),
      ...had.names.filter((n) => !now.includes(n)).map((n) => ["name", n]),
    ];
    const asserted = assertedClaim(before, now);
    if (!lost.length && !asserted) break;
    // A field is to blame when its original carried what went missing and its rewrite does not. Tokens are
    // compared as tokens: the digit "1" is not carried by a field that only says "10%".
    const carries = (text, [type, t]) =>
      type === "number" ? numberTokens(text).includes(t) : type === "latin" ? latinTokens(text).includes(t) : type === "dual" ? dualsOf(text).includes(t) : String(text).includes(t);
    const culprits = Object.keys(accepted).filter((f) => {
      const was = String(draft[f] ?? "");
      if (lost.some((x) => carries(was, x) && !carries(accepted[f], x))) return true;
      return asserted ? sentencesOf(was).includes(asserted) : false;
    });
    const reason = lost.length ? `a fact left the story (${lost.slice(0, 4).map(([, t]) => t).join("، ")})` : `a hedge was dropped («${asserted.slice(0, 60)}»)`;
    const undo = culprits.length ? culprits : Object.keys(accepted);
    for (const f of undo) {
      rejected.push({ field: f, reason, proposal: f === "body" ? undefined : accepted[f] });
      delete accepted[f];
    }
    if (!Object.keys(accepted).length) break;
  }
  return { accepted, rejected };
}

function validateDeskAnswer(fields) {
  return (d) => {
    if (!d || typeof d !== "object") throw new Error("desk answer is not an object");
    for (const k of fields) if (typeof d[k] !== "string") throw new Error(`desk answer lacks ${k}`);
  };
}

/** Which of the banned phrases a draft still carries (title, dek, lede, box, body). */
export function bannedIn(draft) {
  const prose = [draft.title, draft.subtitle, draft.lede, draft.whyItMatters, draft.body].map((x) => String(x ?? "")).join("\n");
  return BANNED.flatMap((r) => (prose.match(r.re) ?? []).map((h) => h.trim()));
}

/**
 * Deterministic repairs, applied to every field before the model sees the draft. A wire-agency spelling is
 * not a matter of taste, and a model asked nicely still wrote «هي لفيفنغ» twice on 2026-09-22; a table
 * cannot forget. Each entry: the wrong form, the house form. The house keeps one spelling of a name
 * (2026-09-23 audit: «أمريكي» in 49 stories and «أميركي» in 26, «ترامب» in 22 and «ترمب» in 7).
 */
const NAME_FIXES = [
  [/هي (?:لفيفنغ|لي فنغ|ليفنغ|لي فينغ|ليفينغ)/g, "خه لي فنغ"],
  [/خه (?:لفيفنغ|ليفنغ|ليفينغ)/g, "خه لي فنغ"],
  [/أميرك/g, "أمريك"],
  [/(?<![؀-ۿ])([وفبل]?)ترمب(?![؀-ۿ])/g, "$1ترامب"],
  [/(?<![؀-ۿ])([وفبل]?)وورش(?![؀-ۿ])/g, "$1وارش"],
];
export function fixNames(text) {
  let out = String(text ?? "");
  for (const [re, to] of NAME_FIXES) out = out.replace(re, to);
  return out;
}

/**
 * Runs the desk over a draft. Returns { draft, changed, applied, rejected, changes, model }.
 * `draft` has title, subtitle, lede, whyItMatters and body (Markdown); only the fields the guard accepts change.
 * `sources`: the names the story's sources go by, so the checker can count how often each is named.
 */
export async function copyEdit({ draft, includeBody = false, role = "desk", kind = "news", sources = [], publishedAt = null, minFloor = 0.55, log = () => {} }) {
  const year = new Date(publishedAt ?? Date.now()).getUTCFullYear();
  const fields = ["title", "subtitle", "lede", ...(String(draft.whyItMatters ?? "").trim() ? ["whyItMatters"] : []), ...(includeBody ? ["body"] : [])];
  const mechanical = [];
  for (const f of STORY_FIELDS) {
    if (draft[f] == null) continue;
    const after = fixNames(draft[f]);
    if (after !== String(draft[f])) mechanical.push(f);
  }
  if (mechanical.length) {
    draft = { ...draft, ...Object.fromEntries(mechanical.map((f) => [f, fixNames(draft[f])])) };
    log(`desk: spelling table fixed ${mechanical.join(", ")}`);
  }
  const input = Object.fromEntries(fields.map((f) => [f, draft[f] ?? ""]));
  // Without the body in hand the desk cannot act on the body's faults, so the checker reads only what it may rewrite.
  const found = styleIssues(input, { kind, sources });
  const problems = [...found.issues, ...found.warnings].slice(0, 14);
  const user = `${EXAMPLES}
${problems.length ? `
PROBLEMS THE CHECKER FOUND IN THIS DRAFT (fix every one):
${problems.map((x, i) => `${i + 1}. ${x}`).join("\n")}
` : ""}
DRAFT (JSON)
${JSON.stringify(input, null, 2)}

TASK
Rewrite what reads as translation, what repeats and what the problems above name; keep every fact exactly as it is. A fact may leave a place where it repeats, never the story. Return one JSON object in this shape:
{${fields.map((f) => `"${f}": "..."`).join(", ")}, "changes": ["<one short note in Arabic per change: what was wrong and what you did>"]}
If nothing needs changing, return the fields unchanged and an empty "changes" list.`;

  const { data, model } = await chat({
    role,
    system: DESK_SYSTEM,
    user,
    temperature: 0.2,
    maxTokens: includeBody ? 8000 : 2400,
    // A whole story comes back in one answer; four minutes was not always enough for the body (2026-09-23).
    timeoutMs: includeBody ? 480000 : 240000,
    log,
    validate: validateDeskAnswer(fields),
  });

  let { accepted, rejected } = judgeRewrite(draft, data, fields, { year, minFloor });

  // A body the guard refused gets one second try, with the desk told exactly what it broke. The model is
  // stochastic and the guard is exact: on 2026-09-22 four bodies in ten were refused for a figure moved or
  // reworded, and the same story passed on the next call.
  const bodyRefusal = includeBody ? rejected.find((r) => r.field === "body" && /numbers|hedge|fact|length/.test(r.reason)) : null;
  if (bodyRefusal) {
    try {
      const { data: again } = await chat({
        role,
        system: DESK_SYSTEM,
        user: `Your rewrite of the BODY below was refused by the desk's guard: ${bodyRefusal.reason}. Rewrite the body once more. Change phrasing, and delete only sentences whose facts appear higher up in the story (headline, dek, lede). Every digit, figure, percentage, date, unit, currency, count written in words, dual, «» name and Latin token of the ORIGINAL must remain somewhere in the story; every hedged claim (قد، من المتوقع، يرجّح…) that you keep stays hedged; the subheadings stay as they are; the body keeps at least ${Math.round((minFloor < 0.55 ? minFloor : Math.max(0.55, Math.min(0.8, 1 - repeatedShare(draft) - 0.05))) * 100)}% of its length. Fix, as before, what the checker found:
${problems.map((x, i) => `${i + 1}. ${x}`).join("\n") || "(nothing)"}
Return one JSON object: {"body": "..."}

HEADLINE, DEK AND LEDE (as they now stand)
${accepted.title ?? draft.title}
${accepted.subtitle ?? draft.subtitle}
${accepted.lede ?? draft.lede}

ORIGINAL BODY
${draft.body}

REFUSED REWRITE
${data.body}`,
        temperature: 0.1,
        maxTokens: 8000,
        timeoutMs: 480000,
        log,
        validate: validateDeskAnswer(["body"]),
      });
      const second = judgeRewrite(draft, { ...accepted, body: again.body }, [...Object.keys(accepted), "body"], { year, minFloor });
      if (second.accepted.body) {
        accepted = second.accepted;
        rejected = [...rejected.filter((r) => r !== bodyRefusal && !(r.field === "body")), ...second.rejected];
        log("desk: body accepted on the second try");
      } else {
        log(`desk: body refused again (${second.rejected.find((r) => r.field === "body")?.reason ?? "unknown"})`);
      }
    } catch (error) {
      log(`desk: second try failed (${error.message.split("\n")[0]})`);
    }
  }

  const out = { ...draft, ...accepted };
  const applied = Object.keys(accepted);
  // A field the table repaired counts as changed even when the model left it alone, so the caller writes it.
  for (const f of mechanical) if (!applied.includes(f)) applied.push(f);
  const changes = Array.isArray(data.changes) ? data.changes.filter((c) => typeof c === "string").slice(0, 10) : [];
  log(`desk model=${model} applied=[${applied.join(",")}] rejected=[${rejected.map((r) => `${r.field}:${r.reason}`).join(",")}]`);
  return { draft: out, changed: applied.length > 0, applied, rejected, changes, model };
}
