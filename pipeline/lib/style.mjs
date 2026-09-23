/**
 * The house's Arabic, made checkable.
 *
 * Built from reading the economics desks of الشرق الأوسط, الاقتصادية, الشرق بلومبرغ, CNBC عربية,
 * العربية, الجزيرة and أرقام on 2026-09-11, and the Arabic press style manuals: what the desks
 * cut, what betrays translation, and what betrays a machine. Two uses: `styleIssues()` feeds the
 * newsroom's revision loop with concrete, quoted problems, and `BANNED` is shared with the copy
 * desk so the same phrases are hunted everywhere. Rules that need judgement live in the prompts.
 *
 * 2026-09-23: an audit of the published paper (27 stories read closely, 126 counted; the owner: "editorial
 * work still needs a lot of work to bring the language to be as human as possible") found the giveaway had
 * moved from vocabulary to structure. The newest stories passed every rule above and still read as
 * translation: English sentences in Arabic words, one fact told in the dek, the lede, the first paragraph
 * and the box, a source tag on sentence after sentence, the same stock joints. The second half of this
 * file checks those.
 */
import { normalizeDigits } from "./util.mjs";

const AR = "؀-ۿ";

/** Phrases the desks cut, each with the fix a sub-editor would make. `hard` forces a revision. */
export const BANNED = [
  { re: /(?<![؀-ۿ])(?:حاسم|حافل|مصيري|صادم|كارثي|ملحمي|جنوني|يشتعل|تشتعل|ينفجر|تنفجر|زلزال|تسونامي)(?![؀-ۿ])/g, fix: "صفة تقييمية من عند الكاتب؛ احذفها واذكر الرقم أو الفعل الذي في المصدر", hard: true },
  { re: /يفهم القارئ|من خلال هذا المقال|في هذا المقال (?:سوف|سن)|دعونا نستكشف/g, fix: "اذكر المعلومة مباشرة بدلاً من وصف المقال أو مخاطبة القارئ", hard: true },
  // fillers and machine connectors
  { re: /في هذا السياق/g, fix: "احذفها أو ابدأ بـ«و»", hard: true },
  { re: /تجدر الإشارة(?: إلى)?|من الجدير بالذكر|جدير بالذكر|يُذكر أن|يذكر أن|هذا وقد|لا يخفى على أحد|لا يمكن إنكار/g, fix: "احذفها؛ ابدأ الفقرة بـ«وكان» أو بالواقعة نفسها", hard: true },
  { re: /في عالم اليوم|من المهم ملاحظة أن|من المهم الإشارة|في نهاية المطاف|في كثير من الأحيان/g, fix: "احذفها", hard: true },
  { re: /بالإضافة إلى ذلك|علاوة على ذلك|إضافة إلى ذلك/g, fix: "«كما» أو «و»", hard: true },
  { re: /من ناحية أخرى|على الجانب الآخر/g, fix: "«وفي المقابل» إن كان تضاداً حقيقياً، وإلا «و»", hard: true },
  { re: /على الرغم من ذلك/g, fix: "«لكن» أو «ورغم»", hard: true },
  { re: /بناءً? على ذلك/g, fix: "«ولذلك»", hard: true },
  // calques of English (each read through the attached و/ف a paragraph joint adds: «وتم رفع» is «تم رفع»)
  { re: /(?<![؀-ۿ])(?:و|ف)?تم(?:ت)? (?:ال)?[؀-ۿ]+/g, fix: "فعل مبني للمجهول أو فعل مع فاعله («اختُرق» لا «تم اختراق»)", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:يتم|تتم|سيتم|ستتم)(?![؀-ۿ])/g, fix: "الفعل المبني للمجهول أو الفعل مع فاعله («تُراقَب الإمدادات» لا «يتم مراقبة الإمدادات»)", hard: true },
  { re: /من قِ?بل/g, fix: "اجعل الفاعل فاعلاً: «رفع البنك» لا «رُفع من قبل البنك»", hard: true },
  { re: /(?:يقوم|تقوم|قام|قامت|يقومون) ب/g, fix: "الفعل نفسه («زار» لا «قام بزيارة»)", hard: true },
  { re: /(?:يلعب|تلعب|لعب|لعبت) دور/g, fix: "«يؤدي دوراً»", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:بشكل|بصورة) (?:ال)?[؀-ۿ]+/g, fix: "الرقم نفسه، أو الحال («سريعاً»، «أساساً»، «رسمياً»)، لا «بشكل/بصورة» + صفة", hard: true },
  { re: /على صعيد/g, fix: "«في»", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:يعتبر|تعتبر|يُعتبر|تُعتبر)(?![؀-ۿ])/g, fix: "اذكر الواقعة مباشرة، أو «يُعد» عند الضرورة", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?بمثابة(?![؀-ۿ])/g, fix: "«هو»", hard: true },
  { re: /(?:يسلط|تسلط|سلط|سلطت) الضوء/g, fix: "«يبيّن»", hard: true },
  { re: /(?:يمهد|تمهد|مهد|مهدت) الطريق/g, fix: "قل ما الذي سيحدث فعلاً", hard: true },
  { re: /نقطة تحول|تحول جذري|تحولاً جذرياً/g, fix: "التغير الملموس نفسه", hard: true },
  { re: /مما يعكس|مما يشير/g, fix: "«في مؤشر على»، أو قل الدلالة بفعل صريح", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف|ب|ل)?حوالي(?![؀-ۿ])/g, fix: "«نحو»", hard: false },
  { re: /في نفس (?:الوقت|السياق|الفترة)/g, fix: "«في الوقت نفسه»", hard: false },
  { re: /كافة (?:ال)[؀-ۿ]+/g, fix: "الاسم أولاً ثم «كافة» («القطاعات كافة»)", hard: false },
  { re: /(?<![؀-ۿ])(?:و|ف|ب|ل|ك)?(?:ال)?مدراء(?![؀-ۿ])/g, fix: "«مديرو»", hard: false },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:ساهم|ساهمت|يساهم|تساهم)(?![؀-ۿ])/g, fix: "«أسهم»", hard: false },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:ال)?هام(?:ة|ا|اً)?(?![؀-ۿ])/g, fix: "«مهم»", hard: false },
  { re: /أكد على/g, fix: "«أكد» بلا حرف جر", hard: false },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:يعمل|تعمل|عمل|عملت) ك(?=[؀-ۿ])/g, fix: "الحال لا الكاف («يعمل مستشاراً»)", hard: false },
  // Sentence openers (the start of the text, of a line, or after a full stop), with or without the joining و/ف.
  { re: /(?<=^|\n|\.\s)\s*(?:و|ف)?هناك /g, fix: "ابدأ بالفعل («ارتفع» لا «هناك ارتفاع في»)", hard: true },
  { re: /(?<=^|\n|\.\s)\s*(?:و|ف)?(?:شهد|شهدت) [؀-ۿ]+ (?:ارتفاعاً|تراجعاً|انخفاضاً|زيادة|نمواً|هبوطاً|قفزة|صعوداً)/g, fix: "الفعل مباشرة («ارتفع النفط» لا «شهد النفط ارتفاعاً»)", hard: true },

  // English sentences in Arabic words (audit of 2026-09-23)
  { re: /(?<![؀-ۿ])(?:و|ف)?ما إذا (?:كان|كانت|كانوا)(?![؀-ۿ])/g, fix: "«هل» («تدرس هل تحتمل…»)، لا «ما إذا كان»", hard: true },
  { re: /(?<![؀-ۿ])و?ك(?:جزء|وحدة|مؤشر|مرجع|عامل|مصدر|كتلة|بديل|أداة)(?![؀-ۿ])/g, fix: "«بوصفه» أو أعد بناء الجملة؛ «كـ» + اسم ترجمة لـ as a", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:كان|كانت|كانوا) (?:سي|ست|سن)[؀-ۿ]{2,}/g, fix: "«كان مقرراً أن» أو «كان يُفترض أن»، لا «كان سيـ»", hard: false },
  { re: /(?<![؀-ۿ])من حيث(?![؀-ۿ])/g, fix: "فعل صريح بدل «من حيث»", hard: false },
  { re: /(?<![؀-ۿ])على (?:ال)?مستوى(?![؀-ۿ])/g, fix: "«في» أو الحال («عالمياً»)؛ هي أخت «على صعيد»", hard: false },
  { re: /(?<=^|\n|[.؟!]\s)\s*(?:و|ف)?بالنسبة (?:ل|إلى)/g, fix: "«أما … فـ»", hard: false },
  // idioms and trade terms translated word for word
  { re: /على نطاق صناعي|جواهر التاج|حراس(?:اً)? صارم|نقطة تشويقية|توقفاً أرضياً|توقف أرضي|العقود المحددة المدة|على نحو مفاجئ|الآثار المتأخرة|على أساس التداول اللحظي|عملاقة جداً|تحت اختبار|إشارات? مختلطة|عن طريق الخطأ/g, fix: "تعبير إنجليزي منقول بألفاظه؛ اكتب معناه كما تكتبه الصحف («ضوابط صارمة»، «علّقت الرحلات»، «أقوى من المتوقع»، «الآثار اللاحقة»، «خلال الجلسة»، «إشارات متضاربة»، «خطأً»)", hard: true },
  // attribution
  { re: /(?:وفقاً|وفق|بحسب|حسب)\s+(?:(?:للمصدر|المصدر) (?:نفسه|ذاته)|(?:لنفس|نفس) المصدر)/g, fix: "اذكر المصدر مرة في رأس الفقرة، ثم «وأضاف» أو «وأوضح»", hard: true },
  // stock joints
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:يأتي|تأتي|جاء|جاءت) ذلك(?![؀-ۿ])/g, fix: "احذفها؛ الخلفية في جملة مستقلة تبدأ بـ«وكان … قد»", hard: true },
  { re: /(?<=^|\n|[.؟!]\s)\s*(?:و|ف)?(?:يأتي|تأتي|جاء|جاءت) (?:[؀-ۿ«»]+ ){1,3}(?:في وقت|في ظل|وسط)/g, fix: "الخلفية في جملة مستقلة تبدأ بـ«وكان … قد»، لا «ويأتي القرار في وقت…»", hard: true },
  { re: /، إذ (?:ذكر|ذكرت|قال|قالت|أفاد|أفادت|أشار|أشارت|أوضح|أوضحت|أورد|أوردت|نقل|نقلت)(?![؀-ۿ])/g, fix: "«إذ» للتعليل لا قبل فعل إسناد: «…؛ فقد قفز…، بحسب…»", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?في خطوة(?![؀-ۿ])/g, fix: "احذفها وابدأ بالفعل", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?في إطار(?![؀-ۿ])/g, fix: "احذفها أو قل الغرض بفعل («لتمويل…»)", hard: false },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:وهو )?ما يعكس(?![؀-ۿ])/g, fix: "احذفها أو قل الدلالة بفعل صريح", hard: false },
  // stock templates and machine rhetoric
  { re: /السؤال الحقيقي|معادلة صعبة|أمام اختبار صعب|(?<![؀-ۿ])ليس(?:ت)? مجرد|من يربح هو|من يخسر هو/g, fix: "قالب جاهز؛ قل الفكرة مباشرة", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف|ب|ل)?(?:ال)?(?:حاد|حادة|حاداً|انهيار|تاريخي|تاريخية|تاريخياً|الاستراتيجي|الاستراتيجية|جداً)(?![؀-ۿ])/g, fix: "صفة تهويل؛ لا تُستعمل إلا بجوار الرقم الذي يبررها", hard: false },
  // leftovers of the machine
  { re: /[一-鿿぀-ヿЀ-ӿ]+/g, fix: "حروف صينية أو يابانية أو روسية تسربت من النموذج؛ اكتب الكلمة العربية", hard: true },
  { re: /(?:المادة|المواد) (?:المرفقة|المتاحة|المقدمة)|(?:تشير|تُشير|تذكر) المادة|المادة لا (?:تشير|تُشير|تذكر|تقول|تحدد)|(?:في|وفق|بحسب) الملاحظات(?![؀-ۿ])/g, fix: "لغة التعليمات تسربت إلى المقال («المادة»، «الملاحظات»)؛ اذكر المصدر نفسه", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?(?:ي|ت)تسوى(?![؀-ۿ])/g, fix: "«تتوصل إلى تسوية»", hard: true },
  { re: /(?<![؀-ۿ])(?:ما )?بين \d[\d.,]*%? (?:[؀-ۿ]+ )?إلى \d/g, fix: "«بين 4 و5» أو «من 4 إلى 5»", hard: true },
  // the site calls itself a paper (the owner, 2026-09-23: an online news website, not an online newspaper)
  { re: /صحيفتنا|جريدتنا|(?<![؀-ۿ])(?:في )?هذا العدد(?! من)|عدد اليوم(?![؀-ۿ])/g, fix: "خازندار موقع إخباري لا صحيفة: سمّه «خازندار»", hard: true },
  { re: /[؀-ۿ»)]\s[—–]\s|\s[—–]\s[؀-ۿ«(]/g, fix: "شرطة بين جملتين علامة إنجليزية؛ الفاصلة أو «؛» أو القوسان", hard: false },
  // dates the way a database writes them
  { re: /\b20\d\d-\d\d-\d\d\b/g, fix: "اكتب التاريخ كما تكتبه الصحف (اليوم أو الشهر)، لا 2026-09-19", hard: true },
  { re: /(?<![؀-ۿ])(?:و|ف)?بتاريخ(?![؀-ۿ])/g, fix: "اليوم أو الشهر مباشرة («الجمعة»، «في 19 سبتمبر»)", hard: true },
];

/** What «لماذا يهمّ» must never say: the region as a formula, the reader addressed, a chain of maybes. */
const BOX_BANNED = /القارئ العربي|للقارئ العربي|للمواطنين العرب|(?<![؀-ۿ])يجب على|بما في ذلك الشرق الأوسط|المنطقة العربية الأوسع|ما قد يعيد تشكيل/g;
const BOX_OPENER = /^(?:و|ف)?(?:يعكس|تعكس|يمثل|تمثل|يُمثّل|يُعدّ|يعد|تعد|تُعد|يُعد)(?![؀-ۿ])/;

const SENTENCE_SPLIT = /[.؟!]\s+|\n+/;
const sentencesOf = (text) => String(text ?? "").split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);

const STOP = new Set(["في", "من", "إلى", "الى", "على", "عن", "مع", "بعد", "قبل", "أن", "إن", "التي", "الذي", "الذين", "هذا", "هذه", "ذلك", "تلك", "كان", "كانت", "قد", "ما", "لا", "لم", "لن", "أو", "ثم", "كما", "بين", "حتى", "منذ", "خلال", "عند", "وفق", "وفقاً", "بحسب", "حسب", "نحو", "أي", "كل", "بعض", "غير", "أكثر", "أقل", "إذ", "فيما", "بينما", "مما", "حيث", "قال", "قالت", "إنه", "إنها", "أنه", "أنها", "هو", "هي", "هم", "لها", "له", "بها", "به", "فيه", "فيها", "منه", "منها", "عليه", "عليها", "اليوم", "أيضاً"]);
/** The content words of a text, the joining letters and the article stripped, for measuring repetition. */
export function contentWords(text) {
  // Arabic letters and marks only: the Arabic comma, semicolon and question mark (U+060C, U+061B, U+061F)
  // sit inside the Arabic block, and a word read with its comma («البنك،») would not match itself.
  return (String(text ?? "").match(/[ء-يً-ْٰ-ۓ]+/g) ?? [])
    .map((w) => w.replace(/[ً-ْ]/g, "").replace(/^(?:وال|بال|فال|كال|لل|ال)/, ""))
    .map((w) => (w.length > 4 && /^[وف]/.test(w) ? w.slice(1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}
/** The figures of a text as the copy desk's guard reads them: digits, thousands separators dropped. */
export function figuresOf(text) {
  const t = normalizeDigits(String(text ?? "")).replace(/٬/g, ",").replace(/٫/g, ".");
  return (t.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/,(?=\d{3}(?!\d))/g, ""));
}
/** The share of a text's content words that another text already carries. */
function covered(words, seen) {
  return words.length ? words.filter((w) => seen.has(w)).length / words.length : 0;
}
/** Word 4-grams, for telling a recap from a new sentence. */
function grams(words, n = 4) {
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** The counted nouns whose number the desks keep: 3 to 10 take the plural, 11 to 99 and decimals the singular. */
const COUNTED = [["مليار", "مليارات"], ["مليون", "ملايين"], ["ألف", "آلاف"], ["دولار", "دولارات"]];
function agreementSlips(text) {
  const slips = [];
  const forms = COUNTED.flat().join("|");
  for (const m of normalizeDigits(String(text ?? "")).matchAll(new RegExp(`(?<![\\d.,])(\\d[\\d,]*(?:\\.\\d+)?)\\s+(${forms})(?![${AR}])`, "g"))) {
    const [raw, num, noun] = m;
    const plural = COUNTED.some(([, p]) => p === noun);
    if (num.includes(".")) {
      if (plural) slips.push(raw);
      continue;
    }
    const n = Number(num.replace(/,/g, ""));
    const r = n % 100;
    if (r >= 3 && r <= 10 && !plural) slips.push(raw);
    else if ((r >= 11 || (r === 0 && n >= 100)) && plural) slips.push(raw);
  }
  return slips;
}

/**
 * Checks a draft against the rulebook. Returns { issues[], warnings[] } in the newsroom's Arabic
 * issue style: each issue quotes the offending text and says what to do.
 * `sources`: the names the story's sources go by (Arabic and English), to count how often each is named.
 * `latin: false` leaves untranslated English words to the caller (verify.mjs has its own, broader check).
 */
export function styleIssues(draft, { kind = "news", sources = [], latin = true } = {}) {
  const issues = [];
  const warnings = [];
  const title = String(draft.title ?? "");
  const dek = String(draft.subtitle ?? "");
  const body = String(draft.body ?? "");
  const lede = String(draft.lede ?? "");
  const box = String(draft.whyItMatters ?? "");
  const prose = [title, dek, lede, body, box].join("\n");
  const news = kind === "news";

  for (const rule of BANNED) {
    const hits = [...new Set((prose.match(rule.re) ?? []).map((h) => h.trim()))];
    if (!hits.length) continue;
    const line = `عبارة مترجمة أو حشو: «${hits.slice(0, 3).join("»، «")}»؛ ${rule.fix}.`;
    if (rule.hard) issues.push(line);
    else warnings.push(line);
  }

  // The lede: one breath, under 45 words, and never a scene-setter.
  const ledeWords = lede.trim().split(/\s+/).filter(Boolean).length;
  if (news && ledeWords > 55) issues.push(`المقدمة طويلة (${ledeWords} كلمة)؛ اجعلها جملتين إلى ثلاث بأقل من 45 كلمة: الفعل، الفاعل، الرقم، السبب.`);

  // Sentences that run past forty words are translation, not Arabic news.
  const sentences = sentencesOf(body);
  const long = sentences.filter((s) => s.split(/\s+/).length > 45);
  if (long.length) issues.push(`جمل طويلة جداً (${long.length}): «${long[0].split(/\s+/).slice(0, 12).join(" ")}…»؛ اقسم كل جملة تتجاوز 40 كلمة إلى جملتين، فكرة واحدة في كل جملة.`);

  // A paragraph of five or more sentences is a wall; the desks write one to three.
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("## "));
  const walls = paragraphs.filter((p) => p.split(SENTENCE_SPLIT).filter((s) => s.trim().split(/\s+/).length >= 3).length >= 5);
  if (walls.length) warnings.push(`فقرات طويلة (${walls.length}) من خمس جمل أو أكثر؛ الفقرة في الصحافة العربية جملة إلى ثلاث.`);

  // Every paragraph opening with the same «و» reads as a machine; the desks vary the joint («ويأتي» and «وجاء» are stock joints, not variety).
  const wawOpeners = paragraphs.filter((p) => /^و(?!كان|في|رغم|قال|قالت|أضاف|أضافت|أشار|أشارت|أوضح|أوضحت|بحسب|وفق)/.test(p)).length;
  if (paragraphs.length >= 4 && wawOpeners / paragraphs.length > 0.6) warnings.push(`أكثر من نصف الفقرات تبدأ بواو العطف المجردة؛ نوّع المفاصل: «وكان … قد»، «فقد»، «لكن»، «أما … فـ»، «وقال».`);

  // Speech: قال takes إن, never أن.
  const qalAn = prose.match(/(?:قال|قالت|وقال|وقالت)\s+[^.،\n]{0,40}?\s+أن\s/g) ?? [];
  if (qalAn.length) warnings.push(`«قال … أن» (${qalAn.length}): بعد «قال» تأتي «إن» لا «أن».`);

  // --- the audit of 2026-09-23 ---

  // A source named once where its information enters; not a tag on every sentence.
  const story = [lede, ...sentences];
  const storySentences = sentencesOf(`${lede}\n${body}`);
  const tagged = storySentences.filter((s) => /(?<![؀-ۿ])(?:و|ف)?(?:وفق(?:اً)?|بحسب|حسب|نقلاً عن)(?![؀-ۿ])/.test(s)).length;
  if (news && storySentences.length >= 6 && tagged / storySentences.length > 1 / 3) issues.push(`الإسناد في كل جملة تقريباً (${tagged} من ${storySentences.length} جملة فيها «وفقاً/بحسب»)؛ اذكر كل مصدر مرة حيث تدخل معلومته، ثم «وأضاف» أو «وأوضح»، أو إسناداً واحداً في رأس الفقرة.`);
  const names = [...new Set(sources.map((s) => String(s ?? "").trim()).filter((s) => s.length >= 3))];
  const storyText = story.join("\n");
  for (const name of names) {
    const count = storyText.split(name).length - 1;
    if (count > 3) issues.push(`المصدر «${name}» مذكور ${count} مرات؛ اذكره مرة حيث تدخل معلومته، ولا يُذكر مصدر واحد أكثر من ثلاث مرات.`);
  }

  // Straight quotation marks carry translated speech; the house reports it.
  const straight = prose.match(/"[^"\n]{2,}"|'[^'\n]{2,}'/g) ?? [];
  if (straight.length) issues.push(`علامات تنصيص إنجليزية («${straight[0].slice(0, 40)}»)؛ الكلام المترجم يُنقل بصيغة «قال إن» بلا علامات تنصيص، و«» للاقتباس العربي الحرفي وحده.`);

  // English words left in the Arabic (parenthesised Latin originals of names and web addresses such as
  // Investing.com are allowed; «موcha» is not).
  if (latin) {
    const bare = prose.replace(/\([^)]*\)/g, " ").replace(/\b[\w-]+\.(?:com|net|org|co|io|info|gov)\b/gi, " ");
    const leaked = [...new Set(bare.match(/(?<![A-Za-z])[a-z][a-z-]{2,}(?![A-Za-z])/g) ?? [])];
    if (leaked.length) issues.push(`كلمات إنجليزية تُركت في النص العربي: ${leaked.slice(0, 6).join(", ")}؛ اكتب معناها بالعربية.`);
  }

  // A headline that says a word twice («…ويخلفه ابنه هوارد يخلفه»). The same word, letter for letter, outside
  // «» blocks; a repeated root is a warning, since parallels («ترفع توقعات… وتخفض توقعات») can be deliberate.
  // Units and the letters of a rating («3 مليارات يورو بتقييم 21 مليار يورو»، «إيه+/إيه-1») repeat by nature.
  const UNITS = /^(?:دولار|دولارات|دولاراً|يورو|جنيه|ريال|درهم|دينار|ين|يوان|مليار|مليارات|مليون|ملايين|ألف|آلاف|تريليون|نقطة|نقاط|برميل|طن|إيه|بي|سي|دي|إس|إن|إم)$/;
  const surface = (title.replace(/«[^»]*»/g, " ").match(/[؀-ۿ]+/g) ?? []).filter((w) => w.length >= 3 && !UNITS.test(w) && !STOP.has(w));
  const twice = surface.filter((w, i) => surface.indexOf(w) !== i);
  const roots = contentWords(title.replace(/«[^»]*»/g, " ")).filter((w) => !UNITS.test(w));
  const rootTwice = roots.filter((w, i) => roots.indexOf(w) !== i);
  if (twice.length) issues.push(`كلمة مكررة في العنوان («${twice[0]}»)؛ العنوان يقول الكلمة مرة.`);
  else if (rootTwice.length) warnings.push(`الكلمة نفسها مرتين في العنوان («${rootTwice[0]}»)؛ أعد صياغته بلا تكرار إن أمكن.`);

  // Dates the desks write: the weekday this week, the month this year, the year only when it is not this one.
  const year = new Date().getUTCFullYear();
  if (news && new RegExp(`(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر) ${year}`).test(lede)) warnings.push(`المقدمة تذكر السنة الحالية (${year})؛ الصحف تكتب اليوم أو الشهر وحده في أخبار السنة الجارية.`);
  if (news && /(?<![؀-ۿ])(?:و|ف|ب|ل)?اليوم(?![؀-ۿ])/.test(`${lede}\n${body}`)) warnings.push(`«اليوم» في نص محفوظ يصبح خطأ في اليوم التالي؛ اكتب اسم اليوم («الاثنين»).`);
  const digitOpeners = sentencesOf(`${lede}\n${body}`).filter((s) => /^(?:و|ف)?\d/.test(s));
  if (digitOpeners.length) warnings.push(`جملة تبدأ برقم («${digitOpeners[0].slice(0, 30)}…»)؛ ابدأ بكلمة.`);

  // Hedges: said once, varied, never two sentences in a row, never a «يرجّح أن» that nobody says.
  const HEDGE_OPENER = /^(?:و|ف)?(?:يرجّح|يُرجّح|يُرجَّح|يرجح|من المحتمل|من المرجح|قد|ربما|يبدو|لا يُستبعد|لا يستبعد|كما قد)(?![؀-ۿ])/;
  const all = sentencesOf(`${lede}\n${body}`);
  const hedgeRuns = all.filter((s, i) => i > 0 && HEDGE_OPENER.test(s) && HEDGE_OPENER.test(all[i - 1])).length;
  if (hedgeRuns) warnings.push(`جملتان متتاليتان تبدآن بتحوّط («يرجّح»، «قد»، «من المحتمل»)؛ تحوّط واحد في الفقرة، ونوّعه («والأرجح أن»، «يبدو»، «لا يُستبعد»).`);
  if (all.some((s) => /^(?:و|ف)?(?:يرجّح|يُرجّح|يُرجَّح|يرجح) أن/.test(s))) warnings.push(`«يرجّح أن» بلا فاعل؛ سمِّ من يرجّح، أو اكتب «والأرجح أن».`);

  // Joints with a job: «مما» once, «حيث» for a place, «، إذ» to explain, no second development slipped into the dek.
  const count = (re) => (prose.match(re) ?? []).length;
  if (count(/(?<![؀-ۿ])مما(?![؀-ۿ])/g) > 1) warnings.push(`«مما» مكررة (${count(/(?<![؀-ۿ])مما(?![؀-ۿ])/g)} مرات)؛ مرة واحدة في المقال على الأكثر، والباقي جملة مستقلة أو «فـ».`);
  if (count(/(?<![؀-ۿ])حيث(?![؀-ۿ])/g) > 2) warnings.push(`«حيث» مكررة؛ هي للمكان، والتعليل «إذ» أو «فـ».`);
  if (count(/، إذ(?![؀-ۿ])/g) > 2) warnings.push(`«، إذ» مكررة (${count(/، إذ(?![؀-ۿ])/g)} مرات)؛ للتعليل وحده، والباقي جمل مستقلة.`);
  if (/(?<![؀-ۿ])(?:فيما|بينما)(?![؀-ۿ])/.test(dek)) warnings.push(`الوصف الفرعي يضيف تطوراً ثانياً بـ«فيما/بينما»؛ الوصف الفرعي جملة واحدة عن الخبر نفسه.`);
  if (count(/(?<![؀-ۿ])و?نراقب(?![؀-ۿ])/g) > 2) warnings.push(`«نراقب… ونراقب…» مكررة؛ اجمعها في جملة أو فقرة واحدة.`);
  if (count(/(?<![؀-ۿ])و(?:ال)?ثاني(?:ة)?(?![؀-ۿ])/g) > 1) warnings.push(`أكثر من تعداد «الأول… والثاني» في المقال؛ واحد على الأكثر.`);

  // Numbers that do not agree with their noun («3 مليار»، «108.1 دولارات»).
  const slips = agreementSlips(`${title}\n${dek}\n${lede}\n${body}\n${box}`);
  if (slips.length) warnings.push(`العدد لا يطابق معدوده («${slips.slice(0, 3).join("»، «")}»)؛ من 3 إلى 10 جمع («5 مليارات»)، ومن 11 إلى 99 والكسور مفرد («50 مليار»، «108.1 دولار»).`);

  // Each field adds something: the dek, the first paragraph and the box never retell the lede.
  const ledeFigures = new Set(figuresOf(lede));
  const dekShared = [...new Set(figuresOf(dek))].filter((f) => ledeFigures.has(f));
  if (news && dekShared.length >= 2) warnings.push(`الوصف الفرعي يكرر أرقام المقدمة (${dekShared.join("، ")})؛ ليحمل ثاني أهم معلومة لا رقم المقدمة.`);
  const first = paragraphs[0] ?? "";
  const ledeSeen = new Set(contentWords(`${title}\n${dek}\n${lede}`));
  if (news && first && covered(contentWords(first), ledeSeen) > 0.6) warnings.push(`الفقرة الأولى من المتن تعيد المقدمة («${first.slice(0, 50)}…»)؛ لتتقدم بالخبر: كلام المصدر، أو الرقم وراء المقدمة، أو المقابل. احذف كل جملة وردت وقائعها أعلى النص.`);
  if (box) {
    const bodyGrams = grams(contentWords(`${lede}\n${body}`));
    const recaps = sentencesOf(box).filter((s) => {
      const g = [...grams(contentWords(s))];
      return g.length >= 2 && g.filter((x) => bodyGrams.has(x)).length / g.length > 0.6;
    });
    if (recaps.length) warnings.push(`«لماذا يهمّ» تعيد جملة من المتن («${recaps[0].slice(0, 50)}…»)؛ هي نتيجة واحدة ملموسة لا يقولها المتن، لا ملخص.`);
    const boxHits = [...new Set(box.match(BOX_BANNED) ?? [])];
    if (boxHits.length) issues.push(`«لماذا يهمّ» تستعمل قالباً («${boxHits.join("»، «")}»)؛ اذكر بلداً عربياً أو شركة أو سعراً فقط إن ربطه مصدر بالخبر، وإلا قل ما يغيّره الحدث في سوقه، ولا تخاطب القارئ.`);
    if (BOX_OPENER.test(box.trim())) issues.push(`«لماذا يهمّ» تبدأ بـ«يعكس/يمثل/يُعدّ»؛ ابدأ بالنتيجة نفسها.`);
    if ((box.match(/(?<![؀-ۿ])(?:و|ف)?قد(?![؀-ۿ])/g) ?? []).length > 2) warnings.push(`«لماذا يهمّ» سلسلة من «قد يؤدي… مما قد…»؛ نتيجة واحدة يذكرها مصدر أو تنتج عن أرقام الخبر.`);
  }

  // A key fact names what is measured, where and when; a weekday, a date or a source in brackets is not a fact.
  if (Array.isArray(draft.keyFacts)) {
    const labels = draft.keyFacts.map((f) => String(f?.label ?? "").trim());
    if (labels.some((l) => !l)) issues.push(`رقم رئيسي بلا عنوان؛ كل رقم يحمل عنواناً يسمّي ما يقيسه.`);
    const bracketed = labels.filter((l) => news && l.includes("("));
    if (bracketed.length) warnings.push(`عنوان رقم رئيسي يحمل المصدر بين قوسين («${bracketed[0]}»)؛ العنوان يسمّي ما يُقاس وأين ومتى، والمصدر في المتن.`);
    const dated = labels.filter((l) => /^(?:ال)?(?:تاريخ|موعد)/.test(l));
    if (dated.length) warnings.push(`رقم رئيسي هو تاريخ أو موعد («${dated[0]}»)؛ اليوم أو التاريخ ليس رقماً رئيسياً.`);
  }

  return { issues, warnings };
}
