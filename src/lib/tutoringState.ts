import type { LearningProfile } from "@/lib/learningProfile";

export type TutoringMode =
  | "hint"
  | "check_work"
  | "next_step"
  | "generate_practice"
  | "general";

export type TutoringState =
  | "EXPLORING"
  | "GUIDED_REASONING"
  | "STRUGGLING"
  | "CONFIDENT"
  | "REPEATED_MISTAKE"
  | "COMPLETION";

export type TutoringSignals = {
  hintRequests?: number;
  attemptCount?: number;
  incorrectAttempts?: number;
  conversationTurns?: number;
  lastTutorMode?: TutoringMode | null;
  activeConfusionSignal?: boolean;
  completionSignal?: boolean;
  fullAttemptSignal?: boolean;
  confidentAttemptSignal?: boolean;
  answerCheckSignal?: boolean;
  requestedPracticeSignal?: boolean;
};

type TutoringStateInput = {
  mode: TutoringMode;
  studentMessage: string;
  learningProfile?: Partial<LearningProfile>;
  tutoringSignals?: TutoringSignals;
};

export function detectMistakePatterns(text: string) {
  const lowerText = text.toLowerCase();
  const patterns: string[] = [];

  if (/negative|minus|sign|opposite|subtract/.test(lowerText)) {
    patterns.push("sign handling");
  }

  if (/distribute|parentheses|\(|\)/.test(lowerText)) {
    patterns.push("distribution");
  }

  if (/like terms|combine|terms/.test(lowerText)) {
    patterns.push("combining like terms");
  }

  if (/setup|equation|formula|model/.test(lowerText)) {
    patterns.push("problem setup");
  }

  if (/order of operations|pemdas|exponent|square|power/.test(lowerText)) {
    patterns.push("order of operations");
  }

  if (/proof|because|therefore|congruent|similar/.test(lowerText)) {
    patterns.push("proof logic");
  }

  if (/arithmetic|calculate|computed|equals|=/.test(lowerText)) {
    patterns.push("arithmetic accuracy");
  }

  return uniqueLimited(patterns, 4);
}

export function deriveTutoringState({
  mode,
  studentMessage,
  learningProfile,
  tutoringSignals = {},
}: TutoringStateInput): TutoringState {
  const lowerMessage = studentMessage.toLowerCase();
  const hintRequests = tutoringSignals.hintRequests ?? 0;
  const attemptCount = tutoringSignals.attemptCount ?? 0;
  const incorrectAttempts = tutoringSignals.incorrectAttempts ?? 0;
  const conversationTurns = tutoringSignals.conversationTurns ?? 0;
  const mistakePatterns = detectMistakePatterns(studentMessage);

  const soundsConfused =
    tutoringSignals.activeConfusionSignal ||
    /i don't know|idk|stuck|confused|lost|not sure|don't get|no idea|help|overwhelmed/.test(
      lowerMessage
    );

  const showsCompletion =
    tutoringSignals.completionSignal ||
    /solved|finished|done|got it|answer is|final answer|therefore/.test(
      lowerMessage
    );
  const showsFullAttempt =
    tutoringSignals.answerCheckSignal ||
    tutoringSignals.fullAttemptSignal ||
    /^(x|y|[a-z])\s*=|answer is|final answer|therefore|i got|i think|is this right|does this work|=/.test(
      lowerMessage
    );

  if (showsCompletion) {
    return "COMPLETION";
  }

  if (
    showsFullAttempt &&
    !soundsConfused &&
    incorrectAttempts === 0 &&
    hintRequests <= 1
  ) {
    return "CONFIDENT";
  }

  if (
    incorrectAttempts >= 2 ||
    (mistakePatterns.length > 0 && incorrectAttempts >= 1) ||
    (learningProfile?.conceptsNeedingReinforcement?.length ?? 0) >= 3
  ) {
    return "REPEATED_MISTAKE";
  }

  if (
    soundsConfused ||
    hintRequests >= 2 ||
    learningProfile?.confidenceLevel === "building" ||
    learningProfile?.difficultyComfortLevel === "building"
  ) {
    return "STRUGGLING";
  }

  if (
    attemptCount >= 1 &&
    incorrectAttempts === 0 &&
    hintRequests === 0 &&
    (mode === "check_work" ||
      learningProfile?.confidenceLevel === "confident" ||
      learningProfile?.difficultyComfortLevel === "ready for challenge")
  ) {
    return "CONFIDENT";
  }

  if (conversationTurns <= 2 || attemptCount === 0) {
    return "EXPLORING";
  }

  return "GUIDED_REASONING";
}

export function deriveHintEscalationLevel({
  hintRequests = 0,
  incorrectAttempts = 0,
  activeConfusionSignal = false,
}: TutoringSignals) {
  if (incorrectAttempts >= 2 || hintRequests >= 3) return 4;
  if (incorrectAttempts >= 1 || hintRequests >= 2) return 3;
  if (hintRequests >= 1 || activeConfusionSignal) return 2;
  return 1;
}

export function getTutoringStateInstructions(state: TutoringState) {
  const instructions: Record<TutoringState, string> = {
    EXPLORING:
      "State: EXPLORING. Use a tiny first step: quick acknowledgement, one immediate goal, then one short, concrete question about an exact piece. Reveal only the concept needed right now. Do not test formula memory early; provide formula structure first if needed. Avoid broad planning prompts, formal definitions, derivations, solving, or over-explaining.",
    GUIDED_REASONING:
      "State: GUIDED_REASONING. Coach one step at a time. Trust established context, keep it lightweight, use spoken phrasing, introduce only the next needed idea, ask about one exact piece, scaffold formulas before asking abstract questions, wait for participation, and reveal at most one new step.",
    STRUGGLING:
      "State: STRUGGLING. Slow down. Reduce cognitive load, use smaller steps, add reassurance, and ask an easier question about one visible part of the problem.",
    CONFIDENT:
      "State: CONFIDENT. The student may be submitting a full or confident attempt. Evaluate their work first. If correct, confirm briefly and offer a next action. If partially correct, name the correct part and isolate the weak step. If incorrect, identify the likely misconception and shift into focused guidance. Use fewer hints and avoid unnecessary scaffolding.",
    REPEATED_MISTAKE:
      "State: REPEATED_MISTAKE. Name the likely misconception directly and gently. Do not repeat the same explanation. Use a smaller subproblem or isolate the source of confusion.",
    COMPLETION:
      "State: COMPLETION. Reinforce specific progress, summarize the reasoning pattern, and only now unlock contextual next practice or a harder version.",
  };

  return instructions[state];
}

export function getHintEscalationInstructions(level: number) {
  if (level <= 1) {
    return "Hint escalation level 1: Tiny Hint. Give only a small directional nudge, preferably as a question.";
  }

  if (level === 2) {
    return "Hint escalation level 2: Guided Hint. Be more specific about the next move, but still ask the student to perform it.";
  }

  if (level === 3) {
    return "Hint escalation level 3: Structured Hint. Scaffold the next step clearly without finishing the whole problem.";
  }

  return "Hint escalation level 4: Worked Support. Walk through only the current step, then ask the student to continue from there.";
}

export function getPacingGuidance({
  state,
  learningProfile,
}: {
  state: TutoringState;
  learningProfile?: Partial<LearningProfile>;
}) {
  if (
    state === "STRUGGLING" ||
    state === "REPEATED_MISTAKE" ||
    learningProfile?.confidenceLevel === "building"
  ) {
    return "Pacing: slow. Use short sentences, one micro-step, and reassuring language. Do not move ahead until the student responds.";
  }

  if (
    state === "CONFIDENT" ||
    learningProfile?.difficultyComfortLevel === "ready for challenge"
  ) {
    return "Pacing: independent. Ask for justification or prediction before giving help. Avoid unnecessary scaffolding.";
  }

  return "Pacing: balanced. Keep momentum while checking understanding before each new step.";
}

export function summarizeLearningMemory(profile?: Partial<LearningProfile>) {
  if (!profile) return "No long-term learning memory yet.";

  const memoryParts = [
    profile.currentSubject ? `Current subject: ${profile.currentSubject}` : "",
    profile.strongSkills?.length
      ? `Strong skills: ${profile.strongSkills.slice(0, 3).join(", ")}`
      : "",
    profile.conceptsNeedingReinforcement?.length
      ? `Needs reinforcement: ${profile.conceptsNeedingReinforcement
          .slice(0, 3)
          .join(", ")}`
      : "",
    profile.recurringMistakes?.length
      ? `Recurring mistakes: ${profile.recurringMistakes.slice(0, 3).join(", ")}`
      : "",
    profile.formulaConfusions?.length
      ? `Formula support needed: ${profile.formulaConfusions
          .slice(0, 3)
          .join(", ")}`
      : "",
    profile.setupMistakes?.length
      ? `Setup patterns to support: ${profile.setupMistakes.slice(0, 3).join(", ")}`
      : "",
    profile.conceptualMisunderstandings?.length
      ? `Concepts to clarify gently: ${profile.conceptualMisunderstandings
          .slice(0, 3)
          .join(", ")}`
      : "",
    profile.spacedReviewQueue?.length
      ? `Spaced review queue: ${profile.spacedReviewQueue.slice(0, 3).join(", ")}`
      : "",
    profile.problemHistory?.[0]
      ? `Recent problem pattern: ${profile.problemHistory[0].problemType} (${profile.problemHistory[0].topic})`
      : "",
    profile.independenceLevel
      ? `Independence level: ${profile.independenceLevel}`
      : "",
    profile.lastReflection ? `Recent reflection: ${profile.lastReflection}` : "",
    profile.pacingPreference ? `Pacing: ${profile.pacingPreference}` : "",
    profile.preferredTutoringStyle
      ? `Preferred style: ${profile.preferredTutoringStyle}`
      : "",
  ].filter(Boolean);

  return memoryParts.length
    ? memoryParts.join("\n")
    : "No long-term learning memory yet.";
}

function uniqueLimited(items: string[], limit: number) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit);
}
