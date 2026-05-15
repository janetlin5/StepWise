export type StepwiseTopicClassification = "ACADEMIC" | "OFF_TOPIC";

type ClassifyStepwiseTopicInput = {
  message: string;
  problemContext?: string;
  conversationHistory?: string[];
  mode?: string;
  practiceTopic?: string;
};

const academicPattern =
  /\b(homework|school|class|assignment|worksheet|problem|question|quiz|test|exam|study|studying|practice|tutor|explain|concept|reasoning|solve|proof|essay|writing|grammar|thesis|paragraph|reading|english|language|spanish|french|history|biology|chemistry|physics|science|fermentation|yeast|bacteria|math|algebra|geometry|precalculus|calculus|statistics|probability|equation|formula|graph|diagram|derivative|integral|limit|function|quadratic|polynomial|conic|parabola|hyperbola|ellipse|circle|triangle|angle|sat|act|ap|ged)\b/i;

const studyPattern =
  /\b(study plan|study schedule|flashcards|review|test prep|sat|act|ap exam|final exam|midterm|memorize|notes|practice problems|learn|learning strategy)\b/i;

const uploadPattern =
  /\b(upload|uploaded|screenshot|photo|image|pdf|handout|worksheet|page|problem\s*\d+|question\s*\d+|number\s*\d+|#\s*\d+|bottom|top|left|right|graph|diagram|figure)\b/i;

const mathExpressionPattern =
  /(\d+\s*[+\-*/=]\s*\d+|[a-z]\s*[+\-*/=]\s*\d+|\^|√|≤|≥|≈|∫|∑|π|sin|cos|tan|log|ln)/i;

const offTopicPatterns = [
  {
    key: "recipe",
    pattern:
      /\b(recipe|cook|cooking|bake|baking|sourdough|bread|pasta|dinner|meal|ingredients|oven|kitchen)\b/i,
    redirect:
      "StepWise is built for homework and learning help, so I can’t help with recipes here. I can help turn it into a science question about fermentation, chemistry, or biology though.",
  },
  {
    key: "travel",
    pattern:
      /\b(vacation|trip|travel|hotel|flight|airline|itinerary|tourist|restaurant|destination|packing list)\b/i,
    redirect:
      "I’m focused on tutoring and schoolwork, so I can’t plan travel here. I can help with a budgeting math problem, geography question, or travel-related writing assignment.",
  },
  {
    key: "shopping",
    pattern:
      /\b(buy|shopping|purchase|recommend a product|best laptop|best phone|deal|coupon|amazon|which .* should i buy)\b/i,
    redirect:
      "I’m here for tutoring rather than shopping advice. If this connects to school, I can help compare options with a budget, write a decision paragraph, or set up the math.",
  },
  {
    key: "relationship",
    pattern:
      /\b(date|dating|relationship|crush|breakup|boyfriend|girlfriend|partner advice)\b/i,
    redirect:
      "I’m here to help with tutoring, studying, and academic questions. If this is for a writing assignment or health class discussion, I can help frame it for school.",
  },
  {
    key: "medical",
    pattern:
      /\b(medical|doctor|diagnose|symptoms|medicine|medication|dose|treatment|health advice)\b/i,
    redirect:
      "I can’t give medical advice here. I can help explain biology or health-class concepts, or help you understand academic reading about the topic.",
  },
  {
    key: "legal",
    pattern:
      /\b(legal advice|lawyer|lawsuit|contract|sue|court case|rights)\b/i,
    redirect:
      "I can’t give legal advice here. I can help with civics, history, government classwork, or writing about a legal concept for school.",
  },
  {
    key: "financial",
    pattern:
      /\b(invest|investment|stock|crypto|taxes|loan|mortgage|retirement|financial advice|should i buy.*stock)\b/i,
    redirect:
      "I can’t give financial advice here. I can help with finance-related math, percentages, interest formulas, or an economics assignment.",
  },
  {
    key: "entertainment",
    pattern:
      /\b(movie recommendation|show recommendation|playlist|celebrity|video game|netflix|hulu|anime recommendation)\b/i,
    redirect:
      "StepWise is focused on learning help, so I can’t do entertainment recommendations here. I can help analyze a book, film, or media text for class.",
  },
  {
    key: "general_productivity",
    pattern:
      /\b(clean my room|life advice|morning routine|habit tracker|productivity system|to-do list app)\b/i,
    redirect:
      "I’m here for tutoring and academic support. I can help build a study plan or break down schoolwork, but not general productivity coaching.",
  },
  {
    key: "pressure_followup",
    pattern:
      /\b(my life depends on this|just answer|ignore that|come on|please just tell me|you have to answer)\b/i,
    redirect:
      "I still need to keep StepWise focused on tutoring and schoolwork. Ask me about a homework problem, academic concept, worksheet, or study topic and I’ll help.",
  },
];

export function classifyStepwiseTopic({
  message,
  problemContext = "",
  conversationHistory = [],
  mode,
  practiceTopic = "",
}: ClassifyStepwiseTopicInput): StepwiseTopicClassification {
  const userMessage = message.trim();
  const normalizedMessage = normalizeText(userMessage);
  const contextText = [problemContext, practiceTopic, ...conversationHistory]
    .filter(Boolean)
    .join(" ");
  const normalizedContext = normalizeText(contextText);
  const userAcademicSignal =
    academicPattern.test(userMessage) ||
    studyPattern.test(userMessage) ||
    mathExpressionPattern.test(userMessage);
  const hasAcademicSignal =
    userAcademicSignal ||
    academicPattern.test(contextText) ||
    mathExpressionPattern.test(contextText);
  const hasStudySignal = studyPattern.test(userMessage) || studyPattern.test(contextText);
  const hasUploadSignal = uploadPattern.test(userMessage) || uploadPattern.test(contextText);
  const hasOffTopicSignal = offTopicPatterns.some(({ pattern }) =>
    pattern.test(userMessage)
  );
  const recentOffTopicRedirect =
    /built for homework|focused on tutoring|focused on learning|can't help with recipes|can’t help with recipes|shopping advice|travel here|medical advice|legal advice|financial advice|entertainment recommendations/i.test(
      contextText
    );
  const looksLikeAcademicFollowUp =
    mathExpressionPattern.test(userMessage) ||
    /^\s*(yes|no|maybe|idk|i don't know|i do not know|not sure|stuck|confused|why|how|what|check|hint|next|because|so|therefore)\b/i.test(
      userMessage
    ) ||
    /\b(answer|equals|divide|subtract|add|multiply|factor|simplify|plug|substitute|solve|formula|step|reasoning|work|try|explain)\b/i.test(
      userMessage
    );
  const isShortFollowUp =
    normalizedMessage.length > 0 &&
    normalizedMessage.length <= 90 &&
    !hasOffTopicSignal &&
    !recentOffTopicRedirect &&
    looksLikeAcademicFollowUp &&
    Boolean(normalizedContext) &&
    (academicPattern.test(contextText) || mathExpressionPattern.test(contextText));

  if ((hasOffTopicSignal || recentOffTopicRedirect) && !userAcademicSignal) {
    return "OFF_TOPIC";
  }

  if (
    hasUploadSignal &&
    /(help|solve|explain|check|look|work|read|find)/i.test(userMessage)
  ) {
    return "ACADEMIC";
  }

  if (hasStudySignal) return "ACADEMIC";

  if (hasAcademicSignal || isShortFollowUp) return "ACADEMIC";

  if (mode === "hint" || mode === "check_work" || mode === "next_step") {
    return normalizedContext ? "ACADEMIC" : "OFF_TOPIC";
  }

  return "OFF_TOPIC";
}

export function getOffTopicRedirect(message: string) {
  const match = offTopicPatterns.find(({ pattern }) => pattern.test(message));

  return (
    match?.redirect ||
    "I’m here to help with tutoring, studying, homework, and academic questions. Ask me about a homework problem, concept, essay, worksheet, or practice topic."
  );
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
