/**
 * The house's Arabic, made checkable.
 *
 * Built from reading the economics desks of الشرق الأوسط, الاقتصادية, الشرق بلومبرغ, CNBC عربية,
 * العربية, الجزيرة and أرقام on 2026-09-11, and the Arabic press style manuals: what the desks
 * cut, what betrays translation, and what betrays a machine. Two uses: `styleIssues()` feeds the
 * newsroom's revision loop with concrete, quoted problems, and `BANNED` is shared with the copy
 * desk so the same phrases are hunted everywhere. Rules that need judgement live in the prompts.
 */

/** Phrases the desks cut, each with the fix a sub-editor would make. `hard` forces a revision. */
export const BANNED = [
  { re: /يفهم القارئ|من خلال هذا المقال|في هذا المقال (?:سوف|سن)|دعونا نستكشف/g, fix: "اذكر المعلومة مباشرة بدلاً من وصف المقال أو مخاطبة القارئ", hard: true },
  // fillers and machine connectors
  { re: /في هذا السياق/g, fix: "احذفها أو ابدأ بـ«و»", hard: true },
  { re: /تجدر الإشارة(?: إلى)?|من الجدير بالذكر|جدير بالذكر|يُذكر أن|يذكر أن|هذا وقد|لا يخفى على أحد|لا يمكن إنكار/g, fix: "احذفها؛ ابدأ الفقرة بـ«وكان» أو بالواقعة نفسها", hard: true },
  { re: /في عالم اليوم|من المهم ملاحظة أن|من المهم الإشارة|في نهاية المطاف|في كثير من الأحيان/g, fix: "احذفها", hard: true },
  { re: /بالإضافة إلى ذلك|علاوة على ذلك|إضافة إلى ذلك/g, fix: "«كما» أو «و»", hard: true },
  { re: /من ناحية أخرى|على الجانب الآخر/g, fix: "«وفي المقابل»", hard: true },
  { re: /على الرغم من ذلك/g, fix: "«لكن» أو «ورغم»", hard: true },
  { re: /بناءً? على ذلك/g, fix: "«ولذلك»", hard: true },
  // calques of English
  { re: /(?<![؀-ۿ])تم(?:ت)? (?:ال)?[؀-ۿ]+/g, fix: "فعل مبني للمجهول أو فعل مع فاعله («اختُرق» لا «تم اختراق»)", hard: true },
  { re: /من قِ?بل/g, fix: "اجعل الفاعل فاعلاً: «رفع البنك» لا «رُفع من قبل البنك»", hard: true },
  { re: /(?:يقوم|تقوم|قام|قامت|يقومون) ب/g, fix: "الفعل نفسه («زار» لا «قام بزيارة»)", hard: true },
  { re: /(?:يلعب|تلعب|لعب|لعبت) دور/g, fix: "«يؤدي دوراً»", hard: true },
  { re: /بشكل (?:كبير|ملحوظ|ملموس|رئيسي|عام|واضح|خاص|مباشر|متزايد)/g, fix: "الرقم نفسه، أو «أساساً»/«كثيراً»", hard: true },
  { re: /على صعيد/g, fix: "«في»", hard: true },
  { re: /(?<![؀-ۿ])(?:يعتبر|تعتبر|يُعتبر|تُعتبر)(?![؀-ۿ])/g, fix: "اذكر الواقعة مباشرة، أو «يُعد» عند الضرورة", hard: true },
  { re: /(?<![؀-ۿ])بمثابة(?![؀-ۿ])/g, fix: "«هو»", hard: true },
  { re: /(?:يسلط|تسلط|سلط|سلطت) الضوء/g, fix: "«يبيّن»", hard: true },
  { re: /(?:يمهد|تمهد|مهد|مهدت) الطريق/g, fix: "قل ما الذي سيحدث فعلاً", hard: true },
  { re: /نقطة تحول|تحول جذري|تحولاً جذرياً/g, fix: "التغير الملموس نفسه", hard: true },
  { re: /مما يعكس|مما يشير/g, fix: "«ما يعكس» / «في مؤشر على»", hard: true },
  { re: /(?<![؀-ۿ])حوالي(?![؀-ۿ])/g, fix: "«نحو»", hard: false },
  { re: /في نفس (?:الوقت|السياق|الفترة)/g, fix: "«في الوقت نفسه»", hard: false },
  { re: /كافة (?:ال)[؀-ۿ]+/g, fix: "الاسم أولاً ثم «كافة» («القطاعات كافة»)", hard: false },
  { re: /(?<![؀-ۿ])مدراء(?![؀-ۿ])/g, fix: "«مديرو»", hard: false },
  { re: /(?<![؀-ۿ])(?:ساهم|ساهمت|يساهم|تساهم)(?![؀-ۿ])/g, fix: "«أسهم»", hard: false },
  { re: /(?<![؀-ۿ])هام(?:ة|ا|اً)?(?![؀-ۿ])/g, fix: "«مهم»", hard: false },
  { re: /أكد على/g, fix: "«أكد» بلا حرف جر", hard: false },
  { re: /(?<![؀-ۿ])(?:يعمل|تعمل|عمل|عملت) ك(?=[؀-ۿ])/g, fix: "الحال لا الكاف («يعمل مستشاراً»)", hard: false },
  { re: /(?:^|\n)\s*هناك /g, fix: "ابدأ بالفعل («ارتفع» لا «هناك ارتفاع في»)", hard: true },
  { re: /(?:^|\n)\s*(?:شهد|شهدت) [؀-ۿ]+ (?:ارتفاعاً|تراجعاً|انخفاضاً|زيادة|نمواً|هبوطاً|قفزة|صعوداً)/g, fix: "الفعل مباشرة («ارتفع النفط» لا «شهد النفط ارتفاعاً»)", hard: true },
];

const SENTENCE_SPLIT = /[.؟!]\s+|\n+/;

/**
 * Checks a draft against the rulebook. Returns { issues[], warnings[] } in the newsroom's Arabic
 * issue style: each issue quotes the offending text and says what to do.
 */
export function styleIssues(draft, { kind = "news" } = {}) {
  const issues = [];
  const warnings = [];
  const body = String(draft.body ?? "");
  const lede = String(draft.lede ?? "");
  const prose = [draft.title, draft.subtitle, lede, body, draft.whyItMatters].map((x) => String(x ?? "")).join("\n");

  for (const rule of BANNED) {
    const hits = [...new Set((prose.match(rule.re) ?? []).map((h) => h.trim()))];
    if (!hits.length) continue;
    const line = `عبارة مترجمة أو حشو: «${hits.slice(0, 3).join("»، «")}»؛ ${rule.fix}.`;
    if (rule.hard) issues.push(line);
    else warnings.push(line);
  }

  // The lede: one breath, under 45 words, and never a scene-setter.
  const ledeWords = lede.trim().split(/\s+/).filter(Boolean).length;
  if (kind === "news" && ledeWords > 55) issues.push(`المقدمة طويلة (${ledeWords} كلمة)؛ اجعلها جملتين إلى ثلاث بأقل من 45 كلمة: الفعل، الفاعل، الرقم، السبب.`);

  // Sentences that run past forty words are translation, not Arabic news.
  const sentences = body.split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const long = sentences.filter((s) => s.split(/\s+/).length > 45);
  if (long.length) issues.push(`جمل طويلة جداً (${long.length}): «${long[0].split(/\s+/).slice(0, 12).join(" ")}…»؛ اقسم كل جملة تتجاوز 40 كلمة إلى جملتين، فكرة واحدة في كل جملة.`);

  // A paragraph of five or more sentences is a wall; the desks write one to three.
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("## "));
  const walls = paragraphs.filter((p) => p.split(SENTENCE_SPLIT).filter((s) => s.trim().split(/\s+/).length >= 3).length >= 5);
  if (walls.length) warnings.push(`فقرات طويلة (${walls.length}) من خمس جمل أو أكثر؛ الفقرة في الصحافة العربية جملة إلى ثلاث.`);

  // Every paragraph opening with the same «و» reads as a machine; the desks vary the joint.
  const wawOpeners = paragraphs.filter((p) => /^و(?!كان|في|جاء|يأتي|تأتي|رغم|قال|قالت|أضاف|أضافت|أشار|أشارت|أوضح|أوضحت|بحسب|وفق)/.test(p)).length;
  if (paragraphs.length >= 4 && wawOpeners / paragraphs.length > 0.6) warnings.push(`أكثر من نصف الفقرات تبدأ بواو العطف المجردة؛ نوّع المفاصل: «وكان»، «وفي المقابل»، «ويأتي»، «ورغم»، «وقال».`);

  // Speech: قال takes إن, never أن.
  const qalAn = prose.match(/(?:قال|قالت|وقال|وقالت)\s+[^.،\n]{0,40}?\s+أن\s/g) ?? [];
  if (qalAn.length) warnings.push(`«قال … أن» (${qalAn.length}): بعد «قال» تأتي «إن» لا «أن».`);

  return { issues, warnings };
}
