/** Synthetic calibration material, never published. Labels stay outside the critic's input. */
const source = (text) => [{ sourceName: "بيان اختباري", sourceNameEn: "Synthetic official statement", lang: "en", title: "Synthetic evaluation material, not a real event", text }];
const story = (title, subtitle, lede, body, whyItMatters) => ({ title, subtitle, lede, body, whyItMatters, keyFacts: [], chart: null, table: null });
const waiverSources = source("On Friday, President Nader issued an executive order waiving new sanctions and an additional 100% tariff under a recently enacted law before they took effect. The law authorises this waiver upon the president certifying to parliament that it serves the national interest. The waiver concerns Russian goods and goods from the five largest buyers of Russian oil and gas. Existing sanctions imposed under earlier executive orders remain unchanged. The law's stated purpose was to put economic pressure on Russia over the war in Ukraine. Nader certified to parliament that the waiver serves the national interest. There is no fixed expiry; the waiver lasts until the president decides further action is appropriate.");
const bankSources = source("On Thursday, the Central Bank of the fictional country Nour reduced its deposit rate from 19% to 18% and its lending rate from 20% to 19%, effective Sunday. Its statement said the decision follows annual inflation slowing from 15% to 10% over six months, while remaining above its 7% target. The bank said lower policy rates are intended to ease financing costs as inflation recedes, but that further decisions depend on incoming inflation data. The rates apply to overnight deposits and loans between the bank and commercial banks; they do not set retail borrowing rates directly. The next policy meeting is in December.");
const salesSources = source("Madar, a fictional retailer, reported on Thursday that quarterly sales rose 8% to 540 million dinars from 500 million a year earlier. It opened five branches, taking its network to 40. The company said the new branches accounted for the sales increase, while sales at existing branches were unchanged. Net profit was 30 million dinars against 28 million a year earlier. The statement did not disclose the new branches' costs. Management plans two further openings next quarter, subject to obtaining licences. These results do not establish that consumer spending across the country has risen.");

export const editorialCases = [
  {
    id: "waiver-unclear-scope", expected: "revise", area: "scope",
    diagnosis: "The broad exemption headline and unchanged-sanctions dek need an early distinction between new and existing measures.",
    sources: waiverSources,
    draft: story("نادر يمنح إعفاءً من عقوبات ورسوم مرتبطة بروسيا", "العقوبات المفروضة بموجب أوامر سابقة تبقى دون تغيير", "أصدر الرئيس نادر الجمعة أمراً يمنح إعفاءً من عقوبات ورسوم مرتبطة بروسيا قبل سريانها.", "وشمل الإعفاء رسوماً إضافية بنسبة 100% على السلع الروسية وسلع أكبر خمسة مشترين للنفط والغاز الروسي.\n\nويتيح القانون للرئيس منح الإعفاء بإفادة يقدمها إلى البرلمان. وقدّم نادر إفادة بأن الإعفاء يخدم المصلحة الوطنية.\n\nولم يحدد الأمر موعداً لانتهاء الإعفاء، الذي يستمر إلى أن يقرر الرئيس اتخاذ إجراء إضافي.", "يجنّب الإعفاء كبار مشتري الطاقة الروسية الرسوم الجديدة على سلعهم المصدّرة إلى البلاد."),
  },
  {
    id: "waiver-clear-scope", expected: "publish",
    diagnosis: "A qualification repeated from the dek into the opening resolves the scope; it is useful explanation, not empty duplication.",
    sources: waiverSources,
    draft: story("نادر يوقف تطبيق عقوبات جديدة مرتبطة بروسيا", "الإعفاء يشمل الرسوم على كبار مشتري الطاقة الروسية", "أعفى الرئيس نادر الجمعة السلع الروسية من رسوم وعقوبات جديدة قبل سريانها. ويقتصر القرار على التدابير التي أقرها القانون الجديد، فيما تبقى العقوبات المفروضة بأوامر سابقة سارية.", "ومن التدابير التي أوقفها القرار رسوم إضافية بنسبة 100% على السلع الروسية، وسلع أكبر خمسة مشترين للنفط والغاز الروسي. وهذه الرسوم تستهدف السلع القادمة من تلك الدول، وليس مشترياتها من الطاقة وحدها.\n\nوأقر القانون لزيادة الضغط الاقتصادي على روسيا بسبب حرب أوكرانيا. لكن نادر أبلغ البرلمان أن منح الإعفاء يخدم المصلحة الوطنية، مستخدماً الصلاحية التي يتيحها له القانون.\n\nوللإعفاء مدة مفتوحة، إذ يستمر إلى أن يقرر الرئيس أن اتخاذ إجراء إضافي بات مناسباً.", "يجنّب القرار كبار مشتري النفط والغاز الروسي رسوماً جديدة على صادراتهم إلى البلاد، مع استمرار القيود السابقة على روسيا."),
  },
  {
    id: "rates-missing-context", expected: "revise", area: "context",
    diagnosis: "The source explains the central bank's rates and inflation comparison; the draft is an unexplained sequence of technical rates and omits that meaning.",
    sources: bankSources,
    draft: story("المركزي يخفض الفائدة على الإيداع إلى 18%", "القرار يسري الأحد والاجتماع المقبل في ديسمبر", "خفض البنك المركزي في دولة نور سعر الفائدة على الإيداع من 19% إلى 18% الخميس، والإقراض من 20% إلى 19%.", "وقال البنك إن القرار يسري الأحد.\n\nوقال البنك إن الفائدة على الإيداع تبلغ 18% بعد الخفض.\n\nوقال البنك إن الفائدة على الإقراض تبلغ 19% بعد الخفض.\n\nويعقد البنك اجتماعه المقبل في ديسمبر.", "يسري القرار الأحد ويعقد البنك اجتماعه المقبل في ديسمبر."),
  },
  {
    id: "rates-explained", expected: "publish",
    diagnosis: "Context belongs beside the decision, forecasts remain conditional, and policy rates are not confused with household loan prices.",
    sources: bankSources,
    draft: story("مركزي نور يخفض فائدة الإيداع إلى 18% مع تباطؤ التضخم", "البنك يربط قراراته المقبلة ببيانات الأسعار", "خفض البنك المركزي في دولة نور الخميس فائدة الإيداع من 19% إلى 18%، والإقراض من 20% إلى 19%، على أن يسري القرار الأحد. وقال إن الخفض جاء بعدما تراجع التضخم السنوي من 15% إلى 10% خلال ستة أشهر.", "وبقي التضخم أعلى من مستهدف البنك البالغ 7%. وقال البنك إن قراراته المقبلة تعتمد على بيانات الأسعار، معتبراً أن انحسار التضخم يتيح تخفيف كلفة التمويل.\n\nوتخص الأسعار المعلنة الودائع والقروض لليلة واحدة بين البنك المركزي والمصارف التجارية، ولا تحدد مباشرة أسعار قروض الأفراد. ويعقد البنك اجتماع السياسة النقدية المقبل في ديسمبر.", "يستهدف الخفض تخفيف كلفة التمويل مع تباطؤ التضخم، لكن أثره على أسعار قروض الأفراد يمر عبر المصارف التجارية، ولا يعني تغييراً مباشراً لها."),
  },
  {
    id: "sales-empty-repetition", expected: "revise", area: "flow",
    diagnosis: "The same sales increase is repeatedly restated without development, including in the significance box.",
    sources: salesSources,
    draft: story("مبيعات مدار ترتفع 8% إلى 540 مليون دينار", "الشركة توسع شبكة فروعها إلى 40", "ارتفعت مبيعات شركة مدار للتجزئة 8% إلى 540 مليون دينار خلال الربع، مقابل 500 مليون قبل عام، بحسب نتائجها الصادرة الخميس.", "وقالت الشركة إن مبيعاتها ارتفعت 8%.\n\nوأوضحت أن المبيعات بلغت 540 مليون دينار، مقابل 500 مليون دينار في الفترة المماثلة.\n\nوأضافت أن الزيادة في المبيعات بلغت 8% على أساس سنوي.\n\nوشملت النتائج فتح خمسة فروع ليصل عدد الفروع إلى 40.", "ارتفاع المبيعات يعني أن الشركة باعت أكثر من العام السابق. فقد بلغت المبيعات 540 مليون دينار مقابل 500 مليون."),
  },
  {
    id: "sales-useful-development", expected: "publish",
    diagnosis: "Returning to sales to explain new versus existing branches adds meaning; do not reject useful repetition or demand an invented consumer-spending story.",
    sources: salesSources,
    draft: story("مبيعات مدار ترتفع 8% بدعم من فروع جديدة", "مبيعات الفروع القائمة تستقر رغم نمو الإجمالي", "ارتفعت مبيعات شركة مدار للتجزئة 8% إلى 540 مليون دينار خلال الربع، مقابل 500 مليون قبل عام، وفق نتائجها الصادرة الخميس. وعزت الشركة الزيادة إلى خمسة فروع افتتحتها خلال الفترة.", "وتوسعت شبكة مدار إلى 40 فرعاً، لكن مبيعات الفروع القائمة لم تتغير. وبذلك جاء نمو المبيعات من اتساع الشبكة، لا من زيادة مبيعات متاجرها السابقة.\n\nوبلغ صافي الربح 30 مليون دينار مقابل 28 مليوناً قبل عام. ولم تكشف الشركة كلفة الفروع الجديدة، وتعتزم فتح فرعين آخرين في الربع المقبل، رهناً بالحصول على التراخيص.", "استقرار مبيعات المتاجر القائمة يوضح حدود نمو الشركة: زيادة الإيرادات اعتمدت على الفروع الجديدة، فيما لم تفصح النتائج عن كلفة افتتاحها."),
  },
  {
    id: "survey-population", expected: "revise", area: "precision",
    diagnosis: "A survey of large organisations is generalised to all UAE companies in the headline and opening.",
    sources: source("A survey commissioned by fictional technology firm Nizam interviewed 200 executives at large UAE organisations employing at least 1,000 people. Of those respondents, 75% said an AI incident in their organisation had reached senior management. An incident included data exposure or errors in AI-supported decisions. This is not an estimate for all UAE businesses. Nizam's director Samer Rami said governance must accompany deployment. The study did not measure the financial cost of the incidents."),
    draft: story("75% من شركات الإمارات تواجه حوادث الذكاء الاصطناعي", "دراسة ترصد أخطاء في القرارات وانكشاف بيانات", "واجهت 75% من شركات الإمارات حوادث مرتبطة بالذكاء الاصطناعي وصلت إلى قياداتها العليا، وفق دراسة أجرتها شركة نظام.", "وشملت الدراسة 200 مسؤول تنفيذي في مؤسسات تضم ألف موظف على الأقل. وتناولت الحوادث انكشاف البيانات وأخطاء القرارات المدعومة بالذكاء الاصطناعي.\n\nوقال مدير الشركة سامر رامي إن الحوكمة يجب أن ترافق استخدام التقنية. ولم تقس الدراسة الكلفة المالية لهذه الحوادث.", "توضح الحوادث الحاجة إلى ضوابط لاستخدام التقنية، وفق مدير الشركة، فيما لم تحدد الدراسة خسائرها المالية."),
  },
  {
    id: "honest-short-brief", expected: "publish",
    diagnosis: "A clear sourced brief with an attributed purpose needs no invented history, street scene, quote or Arab consequence.",
    sources: source("On Thursday, fictional Port of Safa announced a 12 million dinar contract to replace three cranes with electrically powered cranes. Installation is scheduled for January; the old cranes remain in use until then. The port authority says replacement is intended to reduce diesel use at the terminal. It has not disclosed projected savings or the supplier's name. No information on employment effects or handling capacity was provided."),
    draft: story("ميناء الصفا يتعاقد على ثلاث رافعات كهربائية بـ12 مليون دينار", "التركيب مقرر في يناير والرافعات الحالية تبقى في الخدمة حتى ذلك الحين", "أعلن ميناء الصفا الخميس عقداً بقيمة 12 مليون دينار لاستبدال ثلاث رافعات برافعات كهربائية، على أن يبدأ تركيبها في يناير.", "وتبقى الرافعات الحالية في الخدمة حتى موعد التركيب، بحسب هيئة الميناء، التي لم تكشف اسم المورد أو الوفر المتوقع.", "يستهدف المشروع تقليل اعتماد المحطة على الديزل، لكن الهيئة لم تعلن تقديراً للوفر المنتظر."),
  },
];
