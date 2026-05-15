export type ProblemSource =
  | "typed"
  | "uploaded_screenshot"
  | "generated_practice"
  | "unknown";

export type ProblemDifficulty = "Beginner" | "Intermediate" | "Advanced";

export type ProblemMemory = {
  id: string;
  topic: string;
  subtopic: string;
  problemType: string;
  difficulty: ProblemDifficulty;
  source: ProblemSource;
  extractedText: string;
  finalSolutionPath: string[];
  interactionHistory: {
    role: "student" | "tutor";
    content: string;
    mode?: LearningProfileUpdate["mode"];
    createdAt: string;
  }[];
  solvedIndependently: boolean;
  hintsUsed: number;
  mistakesMade: string[];
  completionStatus: "active" | "completed" | "needs_review";
  lastPracticedAt: string;
};

export type SkillMastery = {
  skill: string;
  level: "emerging" | "building" | "steady" | "strong";
  evidenceCount: number;
  lastPracticedAt: string;
};

export type LearningProfile = {
  currentSubject: string;
  recentConcepts: string[];
  conceptsNeedingReinforcement: string[];
  recurringMistakes: string[];
  strongSkills: string[];
  problemHistory: ProblemMemory[];
  skillMastery: SkillMastery[];
  formulaConfusions: string[];
  setupMistakes: string[];
  conceptualMisunderstandings: string[];
  independenceLevel: "supported" | "guided" | "mostly_independent";
  preferredTutoringStyle: string;
  pacingPreference: "slow" | "balanced" | "independent";
  reasoningQuality: "emerging" | "steady" | "strong";
  recentRecommendations: string[];
  spacedReviewQueue: string[];
  practiceTemplates: string[];
  lastReflection: string;
  hintUsageFrequency: "low" | "medium" | "high";
  difficultyComfortLevel: "building" | "comfortable" | "ready for challenge";
  confidenceLevel: "building" | "steady" | "confident";
  confidenceByTopic: Record<string, string>;
  completedProblems: number;
  subjectsStudied: string[];
  tutoringStateHistory: string[];
  lastUpdated: string;
};

export type LearningProfileUpdate = {
  subject?: string;
  skills?: string[];
  recommendation?: string;
  mode?: "hint" | "check_work" | "next_step" | "generate_practice" | "general";
  studentMessage?: string;
  uploadedContext?: string;
  assistantMessage?: string;
  problemText?: string;
  problemSource?: ProblemSource;
  difficulty?: ProblemDifficulty;
  incorrectAttempts?: number;
  hintRequests?: number;
  completedProblem?: boolean;
  mistakePatterns?: string[];
  tutoringState?: string;
};

export const learningProfileStorageKey = "study-buddies-learning-profile";

export function createDefaultLearningProfile(): LearningProfile {
  return {
    currentSubject: "Waiting for a problem",
    recentConcepts: [],
    conceptsNeedingReinforcement: [],
    recurringMistakes: [],
    strongSkills: [],
    problemHistory: [],
    skillMastery: [],
    formulaConfusions: [],
    setupMistakes: [],
    conceptualMisunderstandings: [],
    independenceLevel: "guided",
    preferredTutoringStyle: "guided hints",
    pacingPreference: "balanced",
    reasoningQuality: "steady",
    recentRecommendations: [],
    spacedReviewQueue: [],
    practiceTemplates: [],
    lastReflection: "",
    hintUsageFrequency: "low",
    difficultyComfortLevel: "comfortable",
    confidenceLevel: "steady",
    confidenceByTopic: {},
    completedProblems: 0,
    subjectsStudied: [],
    tutoringStateHistory: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function loadLearningProfile(): LearningProfile {
  if (typeof window === "undefined") {
    return createDefaultLearningProfile();
  }

  try {
    const savedProfile = window.localStorage.getItem(learningProfileStorageKey);

    if (!savedProfile) {
      return createDefaultLearningProfile();
    }

    return {
      ...createDefaultLearningProfile(),
      ...(JSON.parse(savedProfile) as Partial<LearningProfile>),
    };
  } catch {
    return createDefaultLearningProfile();
  }
}

export function saveLearningProfile(profile: LearningProfile) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(learningProfileStorageKey, JSON.stringify(profile));
}

export function updateLearningProfile(
  profile: LearningProfile,
  update: LearningProfileUpdate
): LearningProfile {
  const subject =
    update.subject && update.subject !== "Waiting for a problem"
      ? update.subject
      : profile.currentSubject;
  const skills = update.skills ?? [];
  const repeatedHelpSignals =
    (update.hintRequests ?? 0) >= 2 ||
    (update.incorrectAttempts ?? 0) >= 1 ||
    /i don't know|idk|stuck|confused|lost|not sure/i.test(
      update.studentMessage ?? ""
    );
  const completedProblem =
    update.completedProblem ||
    /solved|finished|done|got it|answer is|final answer|therefore/i.test(
      update.studentMessage ?? ""
    );
  const currentText = [
    update.problemText,
    update.uploadedContext,
    update.studentMessage,
    update.assistantMessage,
  ]
    .filter(Boolean)
    .join("\n");
  const conceptSignals = detectConceptSignals(currentText);
  const formulaSignals = detectFormulaConfusions(currentText);
  const setupSignals = detectSetupMistakes(currentText, update.mistakePatterns ?? []);
  const conceptualSignals = detectConceptualMisunderstandings(
    currentText,
    update.mistakePatterns ?? []
  );
  const nextStrongSkills =
    completedProblem || (!repeatedHelpSignals && update.mode === "check_work")
      ? uniqueLimited([...skills.slice(0, 2), ...profile.strongSkills], 5)
      : profile.strongSkills;
  const nextPacingPreference = repeatedHelpSignals
    ? "slow"
    : profile.confidenceLevel === "confident" || completedProblem
      ? "independent"
      : profile.pacingPreference;
  const nextReasoningQuality = repeatedHelpSignals
    ? "emerging"
    : completedProblem || update.mode === "check_work"
      ? "strong"
      : profile.reasoningQuality;
  const nextIndependenceLevel = repeatedHelpSignals
    ? "supported"
    : completedProblem && (update.hintRequests ?? 0) <= 1
      ? "mostly_independent"
      : profile.independenceLevel;
  const nextSkillMastery = updateSkillMastery({
    currentMastery: profile.skillMastery,
    skills,
    repeatedHelpSignals,
    completedProblem,
    timestamp: new Date().toISOString(),
  });
  const nextProblemHistory = updateProblemHistory({
    profile,
    update,
    subject,
    skills,
    repeatedHelpSignals,
    completedProblem,
    timestamp: new Date().toISOString(),
  });
  const latestProblemAlreadyCompleted =
    completedProblem &&
    nextProblemHistory[0]?.completionStatus === "completed" &&
    profile.problemHistory[0]?.completionStatus === "completed" &&
    normalizeText(nextProblemHistory[0]?.extractedText ?? "") ===
      normalizeText(profile.problemHistory[0]?.extractedText ?? "");
  const nextSpacedReviewQueue =
    repeatedHelpSignals || completedProblem
      ? uniqueLimited(
          [
            ...setupSignals,
            ...formulaSignals,
            ...skills.slice(0, repeatedHelpSignals ? 3 : 1),
            ...profile.spacedReviewQueue,
          ],
          8
        )
      : profile.spacedReviewQueue;
  const nextPracticeTemplates = update.problemText
    ? uniqueLimited([update.problemText, ...profile.practiceTemplates], 6)
    : profile.practiceTemplates;
  const nextLastReflection = getReflection({
    completedProblem,
    repeatedHelpSignals,
    skills,
    formulaSignals,
    setupSignals,
    profile,
  });

  return {
    ...profile,
    currentSubject: subject,
    recentConcepts: uniqueLimited(
      [...skills, ...conceptSignals, ...profile.recentConcepts],
      8
    ),
    strongSkills: nextStrongSkills,
    conceptsNeedingReinforcement: repeatedHelpSignals
      ? uniqueLimited(
          [
            ...setupSignals,
            ...formulaSignals,
            ...skills.slice(0, 2),
            ...profile.conceptsNeedingReinforcement,
          ],
          6
        )
      : profile.conceptsNeedingReinforcement,
    recurringMistakes: update.mistakePatterns?.length
      ? uniqueLimited([...update.mistakePatterns, ...profile.recurringMistakes], 5)
      : profile.recurringMistakes,
    problemHistory: nextProblemHistory,
    skillMastery: nextSkillMastery,
    formulaConfusions: uniqueLimited(
      [...formulaSignals, ...profile.formulaConfusions],
      6
    ),
    setupMistakes: uniqueLimited([...setupSignals, ...profile.setupMistakes], 6),
    conceptualMisunderstandings: uniqueLimited(
      [...conceptualSignals, ...profile.conceptualMisunderstandings],
      6
    ),
    independenceLevel: nextIndependenceLevel,
    recentRecommendations: update.recommendation
      ? uniqueLimited([update.recommendation, ...profile.recentRecommendations], 4)
      : profile.recentRecommendations,
    spacedReviewQueue: nextSpacedReviewQueue,
    practiceTemplates: nextPracticeTemplates,
    lastReflection: nextLastReflection,
    hintUsageFrequency:
      (update.hintRequests ?? 0) >= 3
        ? "high"
        : (update.hintRequests ?? 0) >= 1
          ? "medium"
          : profile.hintUsageFrequency,
    difficultyComfortLevel: repeatedHelpSignals
      ? "building"
      : update.mode === "generate_practice"
        ? "ready for challenge"
        : profile.difficultyComfortLevel,
    confidenceLevel: repeatedHelpSignals
      ? "building"
      : completedProblem
        ? "confident"
        : profile.confidenceLevel,
    pacingPreference: nextPacingPreference,
    reasoningQuality: nextReasoningQuality,
    completedProblems:
      profile.completedProblems +
      (completedProblem && !latestProblemAlreadyCompleted ? 1 : 0),
    subjectsStudied: uniqueLimited(
      subject === "Waiting for a problem"
        ? profile.subjectsStudied
        : [subject, ...profile.subjectsStudied],
      5
    ),
    tutoringStateHistory: update.tutoringState
      ? uniqueLimited([update.tutoringState, ...profile.tutoringStateHistory], 8)
      : profile.tutoringStateHistory,
    lastUpdated: new Date().toISOString(),
  };
}

function uniqueLimited(items: string[], limit: number) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit);
}

function updateSkillMastery({
  currentMastery,
  skills,
  repeatedHelpSignals,
  completedProblem,
  timestamp,
}: {
  currentMastery: SkillMastery[];
  skills: string[];
  repeatedHelpSignals: boolean;
  completedProblem: boolean;
  timestamp: string;
}) {
  const masteryMap = new Map(
    currentMastery.map((skillMemory) => [skillMemory.skill, skillMemory])
  );

  skills.forEach((skill) => {
    const current = masteryMap.get(skill);
    const evidenceCount = (current?.evidenceCount ?? 0) + 1;
    const level = repeatedHelpSignals
      ? evidenceCount >= 3
        ? "building"
        : "emerging"
      : completedProblem
        ? evidenceCount >= 3
          ? "strong"
          : "steady"
        : current?.level ?? "building";

    masteryMap.set(skill, {
      skill,
      level,
      evidenceCount,
      lastPracticedAt: timestamp,
    });
  });

  return Array.from(masteryMap.values())
    .sort((a, b) => b.lastPracticedAt.localeCompare(a.lastPracticedAt))
    .slice(0, 12);
}

function updateProblemHistory({
  profile,
  update,
  subject,
  skills,
  repeatedHelpSignals,
  completedProblem,
  timestamp,
}: {
  profile: LearningProfile;
  update: LearningProfileUpdate;
  subject: string;
  skills: string[];
  repeatedHelpSignals: boolean;
  completedProblem: boolean;
  timestamp: string;
}) {
  const extractedText =
    update.problemText?.trim() ||
    update.uploadedContext?.trim() ||
    profile.problemHistory[0]?.extractedText ||
    "";

  if (!extractedText) {
    return profile.problemHistory;
  }

  const latestProblem = profile.problemHistory[0];
  const isSameProblem =
    latestProblem &&
    normalizeText(latestProblem.extractedText) === normalizeText(extractedText);
  const baseProblem: ProblemMemory =
    isSameProblem && latestProblem
      ? latestProblem
      : {
          id: `${Date.now()}`,
          topic: subject,
          subtopic: skills[0] ?? "Problem setup",
          problemType: inferProblemType(extractedText, skills),
          difficulty: update.difficulty ?? "Intermediate",
          source: update.problemSource ?? "unknown",
          extractedText,
          finalSolutionPath: [],
          interactionHistory: [],
          solvedIndependently: false,
          hintsUsed: 0,
          mistakesMade: [],
          completionStatus: "active",
          lastPracticedAt: timestamp,
        };

  const nextInteractions = [
    ...baseProblem.interactionHistory,
    update.studentMessage
      ? {
          role: "student" as const,
          content: update.studentMessage,
          mode: update.mode,
          createdAt: timestamp,
        }
      : null,
    update.assistantMessage
      ? {
          role: "tutor" as const,
          content: update.assistantMessage,
          mode: update.mode,
          createdAt: timestamp,
        }
      : null,
  ].filter(Boolean) as ProblemMemory["interactionHistory"];

  const nextProblem: ProblemMemory = {
    ...baseProblem,
    topic: subject,
    subtopic: skills[0] ?? baseProblem.subtopic,
    problemType: inferProblemType(extractedText, skills),
    source: update.problemSource ?? baseProblem.source,
    difficulty: update.difficulty ?? baseProblem.difficulty,
    finalSolutionPath: update.assistantMessage
      ? uniqueLimited(
          [summarizeStep(update.assistantMessage), ...baseProblem.finalSolutionPath],
          8
        )
      : baseProblem.finalSolutionPath,
    interactionHistory: nextInteractions.slice(-16),
    solvedIndependently:
      completedProblem && !repeatedHelpSignals && (update.hintRequests ?? 0) <= 1,
    hintsUsed: Math.max(baseProblem.hintsUsed, update.hintRequests ?? 0),
    mistakesMade: uniqueLimited(
      [...(update.mistakePatterns ?? []), ...baseProblem.mistakesMade],
      8
    ),
    completionStatus: completedProblem
      ? "completed"
      : repeatedHelpSignals
        ? "needs_review"
        : "active",
    lastPracticedAt: timestamp,
  };

  return uniqueProblems([nextProblem, ...profile.problemHistory], 10);
}

function inferProblemType(text: string, skills: string[]) {
  const lowerText = text.toLowerCase();

  if (/focus|directrix|parabola/.test(lowerText)) return "Focus/directrix setup";
  if (/hyperbola|asymptote/.test(lowerText)) return "Hyperbola setup";
  if (/ellipse|foci|major axis/.test(lowerText)) return "Ellipse setup";
  if (/factor|x\^2|quadratic|polynomial/.test(lowerText)) return "Quadratic reasoning";
  if (/derivative|differentiate/.test(lowerText)) return "Derivative rules";
  if (/integral|antiderivative/.test(lowerText)) return "Integration pattern";
  if (/triangle|angle|proof|congruent/.test(lowerText)) return "Geometry reasoning";
  if (/probability|mean|median|standard deviation/.test(lowerText)) {
    return "Data interpretation";
  }

  return skills[0] ?? "Guided problem solving";
}

function detectConceptSignals(text: string) {
  const lowerText = text.toLowerCase();
  const concepts: string[] = [];

  if (/horizontal|vertical|axis|opens/.test(lowerText)) concepts.push("Orientation");
  if (/vertex|midpoint|halfway/.test(lowerText)) concepts.push("Vertex reasoning");
  if (/formula|form|equation structure/.test(lowerText)) concepts.push("Formula setup");
  if (/factor|quadratic|x\^2/.test(lowerText)) concepts.push("Quadratics");
  if (/proof|theorem|congruent|similar/.test(lowerText)) concepts.push("Proof reasoning");

  return concepts;
}

function detectFormulaConfusions(text: string) {
  const lowerText = text.toLowerCase();
  const signals: string[] = [];

  if (/forgot|don't remember|do not remember|what formula|which formula|formula do i use/.test(lowerText)) {
    signals.push("Formula recognition");
  }

  if (/(x-h)\^?2|(y-k)\^?2|horizontal|vertical|which variable/.test(lowerText)) {
    signals.push("Choosing the squared variable");
  }

  return signals;
}

function detectSetupMistakes(text: string, mistakePatterns: string[]) {
  const lowerText = text.toLowerCase();
  const signals: string[] = [];

  if (/setup|set up|model|translate|equation/.test(lowerText)) {
    signals.push("Problem setup");
  }

  if (mistakePatterns.includes("problem setup")) {
    signals.push("Problem setup");
  }

  if (/sign|negative|minus/.test(lowerText)) {
    signals.push("Sign handling");
  }

  return signals;
}

function detectConceptualMisunderstandings(text: string, mistakePatterns: string[]) {
  const lowerText = text.toLowerCase();
  const signals: string[] = [];

  if (/why|don't get|confused|stuck|lost|not sure/.test(lowerText)) {
    signals.push("Conceptual clarity");
  }

  if (mistakePatterns.includes("combining like terms")) {
    signals.push("Like-term reasoning");
  }

  if (mistakePatterns.includes("proof logic")) {
    signals.push("Proof logic");
  }

  return signals;
}

function getReflection({
  completedProblem,
  repeatedHelpSignals,
  skills,
  formulaSignals,
  setupSignals,
  profile,
}: {
  completedProblem: boolean;
  repeatedHelpSignals: boolean;
  skills: string[];
  formulaSignals: string[];
  setupSignals: string[];
  profile: LearningProfile;
}) {
  if (completedProblem && skills[0]) {
    return `${skills[0]} is becoming more steady.`;
  }

  if (repeatedHelpSignals && formulaSignals[0]) {
    return `${formulaSignals[0]} may need a slower setup step.`;
  }

  if (repeatedHelpSignals && setupSignals[0]) {
    return `${setupSignals[0]} is worth practicing in smaller steps.`;
  }

  return profile.lastReflection;
}

function uniqueProblems(problems: ProblemMemory[], limit: number) {
  const seen = new Set<string>();

  return problems
    .filter((problem) => {
      const key = normalizeText(problem.extractedText);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function summarizeStep(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}
