import type { LearningProfile } from "@/lib/learningProfile";
import { createDefaultLearningProfile } from "@/lib/learningProfile";
import { createSupabaseServerClient } from "@/lib/usageLimits";

type MemoryMode = "hint" | "check_work" | "next_step" | "generate_practice" | "general";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type LearningMemoryInput = {
  userId: string;
  accessToken: string | null;
  sessionId?: string;
  profile: Partial<LearningProfile>;
  mode: MemoryMode;
  problem: string;
  studentMessage: string;
  assistantMessage?: string;
  topic?: string;
  skills?: string[];
  tutoringState?: string;
  mistakePatterns?: string[];
  conversationHistory?: ConversationMessage[];
};

type LearningSessionInput = {
  userId: string;
  accessToken: string | null;
  sessionId?: string;
  problem: string;
  studentMessage: string;
  mode: MemoryMode;
  profile: Partial<LearningProfile>;
  conversationHistory?: ConversationMessage[];
};

type RetrievedMemory = {
  profile: Partial<LearningProfile>;
  promptSummary: string;
  currentTopic: string;
  currentSubtopic: string;
  relevantMemoryCount: number;
};

type LearningMemoryRow = {
  user_id: string;
  session_id: string;
  topic: string;
  subtopic: string | null;
  skill: string | null;
  misconception: string | null;
  mistake_pattern: string | null;
  hint_level_needed: string;
  tutoring_summary: string;
  confidence_estimate: number;
};

type SafeMemorySummary = {
  topicPracticed: string;
  subtopicPracticed: string;
  conceptsMastered: string[];
  conceptsNeedingReinforcement: string[];
  hintDependency: "low" | "medium" | "high";
  pacingObservation: string;
  independenceLevel: LearningProfile["independenceLevel"];
  confidenceEstimate: number;
  recommendationSeeds: string[];
  evidence: {
    completedCheckpoint: boolean;
    mistakePatterns: string[];
    mode: MemoryMode;
  };
};

const defaultProfile = createDefaultLearningProfile();

export async function ensureLearningSession(input: LearningSessionInput) {
  const supabase = createSupabaseServerClient(input.accessToken);
  const sessionId = input.sessionId || crypto.randomUUID();
  const topic = identifyCurrentTopic(`${input.problem}\n${input.studentMessage}`);
  const now = new Date().toISOString();

  await Promise.all([
    supabase.from("learning_sessions").upsert(
      {
        id: sessionId,
        user_id: input.userId,
        topic: topic.topic,
        subtopic: topic.subtopic,
        status: "active",
        current_problem: input.problem,
        pinned_problem: input.problem,
        last_message_at: now,
        metadata: {
          mode: input.mode,
          startedFrom: "tutor_api",
          recentMessages: input.conversationHistory?.slice(-4) ?? [],
        },
        updated_at: now,
      },
      { onConflict: "id" }
    ),
    supabase.from("sessions").upsert(
      {
        id: sessionId,
        user_id: input.userId,
        topic: topic.topic,
        problem_text: input.problem,
        screenshot_url: null,
        hints_used: input.profile.problemHistory?.[0]?.hintsUsed ?? 0,
        completion_status: "active",
        updated_at: now,
      },
      { onConflict: "id" }
    ),
  ]);

  return {
    sessionId,
    topic: topic.topic,
    subtopic: topic.subtopic,
  };
}

export async function retrieveLearningMemory({
  userId,
  accessToken,
  currentProblem,
  studentMessage,
  clientProfile,
}: {
  userId: string;
  accessToken: string | null;
  currentProblem: string;
  studentMessage: string;
  clientProfile: Partial<LearningProfile>;
}): Promise<RetrievedMemory> {
  const supabase = createSupabaseServerClient(accessToken);
  const currentTopic = identifyCurrentTopic(`${currentProblem}\n${studentMessage}`);
  const keywords = getMemoryKeywords(
    `${currentProblem}\n${studentMessage}\n${currentTopic.topic}\n${currentTopic.subtopic}`
  );

  const [
    { data: profileRow },
    { data: recentSummaries },
    { data: recentSignals },
    { data: recentMemories },
  ] =
    await Promise.all([
      supabase
        .from("learning_profiles")
        .select(
          "profile, preferred_tutoring_style, pacing_preference, independence_level, hint_detail_preference, confidence_by_topic, recently_practiced_topics, evidence_count"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("tutoring_summaries")
        .select("summary, structured_summary, topics, skills, misconceptions, strengths, confidence_signal, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("learning_signals")
        .select("signal_type, topic, skill, confidence, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("learning_memories")
        .select(
          "topic, subtopic, skill, misconception, mistake_pattern, hint_level_needed, tutoring_summary, confidence_estimate, created_at"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const storedProfile = (profileRow?.profile ?? {}) as Partial<LearningProfile>;
  const mergedProfile: Partial<LearningProfile> = {
    ...defaultProfile,
    ...clientProfile,
    ...storedProfile,
    preferredTutoringStyle:
      profileRow?.preferred_tutoring_style ||
      storedProfile.preferredTutoringStyle ||
      clientProfile.preferredTutoringStyle,
    pacingPreference:
      profileRow?.pacing_preference ||
      storedProfile.pacingPreference ||
      clientProfile.pacingPreference,
    independenceLevel:
      profileRow?.independence_level ||
      storedProfile.independenceLevel ||
      clientProfile.independenceLevel,
    currentSubject:
      currentTopic.topic ||
      storedProfile.currentSubject ||
      clientProfile.currentSubject ||
      defaultProfile.currentSubject,
    recentConcepts: uniqueLimited(
      [
        currentTopic.subtopic,
        ...((profileRow?.recently_practiced_topics as string[] | null) ?? []),
        ...(storedProfile.recentConcepts ?? []),
        ...(clientProfile.recentConcepts ?? []),
      ],
      8
    ),
  };

  const relevantSummaries = (recentSummaries ?? [])
    .filter((summary) =>
      isRelevantMemory(
        keywords,
        [
          summary.summary,
          ...(summary.topics ?? []),
          ...(summary.skills ?? []),
          ...(summary.misconceptions ?? []),
        ].join(" ")
      )
    )
    .slice(0, 3);
  const relevantSignals = (recentSignals ?? [])
    .filter((signal) =>
      isRelevantMemory(
        keywords,
        [signal.topic, signal.skill, signal.signal_type, JSON.stringify(signal.metadata ?? {})].join(
          " "
        )
      )
    )
    .slice(0, 6);
  const relevantMemories = (recentMemories ?? [])
    .filter((memory) =>
      isRelevantMemory(
        keywords,
        [
          memory.topic,
          memory.subtopic,
          memory.skill,
          memory.misconception,
          memory.mistake_pattern,
          memory.hint_level_needed,
          memory.tutoring_summary,
        ].join(" ")
      )
    )
    .slice(0, 4);
  const confidenceByTopic = profileRow?.confidence_by_topic
    ? JSON.stringify(profileRow.confidence_by_topic)
    : "";
  const evidenceCount =
    typeof profileRow?.evidence_count === "number" ? profileRow.evidence_count : 0;
  const hasEarnedPersonalization = evidenceCount >= 2 || relevantMemories.length > 0;
  const softAdaptation = hasEarnedPersonalization
    ? buildSoftAdaptationGuidance({
        hintDetailPreference: profileRow?.hint_detail_preference ?? "balanced",
        independenceLevel: mergedProfile.independenceLevel,
        pacingPreference: mergedProfile.pacingPreference,
        memories: relevantMemories,
      })
    : [
        "Soft adaptation: not enough history yet. Use only the current conversation and avoid implying long-term knowledge.",
      ];

  return {
    profile: mergedProfile,
    currentTopic: currentTopic.topic,
    currentSubtopic: currentTopic.subtopic,
    relevantMemoryCount: relevantMemories.length,
    promptSummary: [
      `Current topic estimate: ${currentTopic.topic}${
        currentTopic.subtopic ? ` / ${currentTopic.subtopic}` : ""
      }.`,
      hasEarnedPersonalization
        ? `Persistent profile: style=${mergedProfile.preferredTutoringStyle}; pacing=${mergedProfile.pacingPreference}; independence=${mergedProfile.independenceLevel}; hint detail=${profileRow?.hint_detail_preference ?? "balanced"}.`
        : "Persistent profile: not enough history yet. Do not imply personalization beyond the current session.",
      hasEarnedPersonalization && confidenceByTopic
        ? `Confidence by topic: ${confidenceByTopic}`
        : "",
      relevantMemories.length
        ? `Relevant actionable memories:\n${relevantMemories
            .map((memory) => formatMemoryForPrompt(memory))
            .join("\n")}`
        : "",
      relevantSummaries.length
        ? `Relevant past tutoring summaries:\n${relevantSummaries
            .map((summary) => {
              const structuredSummary = summary.structured_summary
                ? JSON.stringify(summary.structured_summary)
                : "";

              return `- ${summary.summary}${
                structuredSummary ? ` | structured=${structuredSummary}` : ""
              }`;
            })
            .join("\n")}`
        : "",
      relevantSignals.length
        ? `Relevant learning signals:\n${relevantSignals
            .map((signal) =>
              `- ${signal.signal_type}: ${signal.skill || signal.topic || "general"}`
            )
            .join("\n")}`
        : "",
      softAdaptation.join("\n"),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function identifyCurrentTopic(text: string) {
  const lowerText = text.toLowerCase();

  if (/hyperbola|asymptote|conjugate axis|transverse axis/.test(lowerText)) {
    return { topic: "Precalculus", subtopic: "Hyperbolas" };
  }

  if (/ellipse|foci|major axis|minor axis/.test(lowerText)) {
    return { topic: "Precalculus", subtopic: "Ellipses" };
  }

  if (/parabola|directrix|focus|vertex|axis of symmetry/.test(lowerText)) {
    return { topic: "Precalculus", subtopic: "Parabolas" };
  }

  if (/conic|standard form|center|vertices/.test(lowerText)) {
    return { topic: "Precalculus", subtopic: "Conic sections" };
  }

  if (/derivative|integral|limit|differentiate|calculus/.test(lowerText)) {
    return { topic: "Calculus", subtopic: "Functions and rates" };
  }

  if (/triangle|angle|proof|congruence|similarity|geometry/.test(lowerText)) {
    return { topic: "Geometry", subtopic: "Diagram reasoning" };
  }

  if (/mean|median|probability|standard deviation|regression|statistics/.test(lowerText)) {
    return { topic: "Statistics", subtopic: "Data and probability" };
  }

  if (/sat|act|test prep/.test(lowerText)) {
    return { topic: "SAT Math", subtopic: "Test prep" };
  }

  if (/x\^2|x²|x2|quadratic|factor|polynomial/.test(lowerText)) {
    return { topic: "Algebra", subtopic: "Quadratics" };
  }

  if (/\bequation\b|\bsolve\b|\bx\b/.test(lowerText)) {
    return { topic: "Algebra", subtopic: "Equation solving" };
  }

  return { topic: "General tutoring", subtopic: "Reasoning practice" };
}

function formatMemoryForPrompt(memory: {
  skill?: string | null;
  misconception?: string | null;
  mistake_pattern?: string | null;
  hint_level_needed?: string | null;
  tutoring_summary?: string | null;
  confidence_estimate?: number | null;
}) {
  const pieces = [
    memory.skill ? `skill=${memory.skill}` : "",
    memory.misconception ? `misconception=${memory.misconception}` : "",
    memory.mistake_pattern ? `mistake=${memory.mistake_pattern}` : "",
    memory.hint_level_needed ? `hint=${memory.hint_level_needed}` : "",
    typeof memory.confidence_estimate === "number"
      ? `confidence=${memory.confidence_estimate.toFixed(2)}`
      : "",
    memory.tutoring_summary ? `summary=${memory.tutoring_summary}` : "",
  ].filter(Boolean);

  return `- ${pieces.join("; ")}`;
}

function buildSoftAdaptationGuidance({
  hintDetailPreference,
  independenceLevel,
  pacingPreference,
  memories,
}: {
  hintDetailPreference: string;
  independenceLevel?: LearningProfile["independenceLevel"];
  pacingPreference?: LearningProfile["pacingPreference"];
  memories: Array<{
    misconception?: string | null;
    mistake_pattern?: string | null;
    confidence_estimate?: number | null;
  }>;
}) {
  const hasRepeatedConfusion = memories.some(
    (memory) => memory.misconception || memory.mistake_pattern
  );
  const averageConfidence =
    memories.length > 0
      ? memories.reduce(
          (sum, memory) => sum + (Number(memory.confidence_estimate) || 0),
          0
        ) / memories.length
      : 0;
  const guidance = [
    "Soft adaptation rules: use these as hidden tutoring guidance, not as explicit claims.",
  ];

  if (hintDetailPreference === "concise") {
    guidance.push("Use shorter hints and let the student try sooner.");
  } else if (hintDetailPreference === "more scaffolded") {
    guidance.push("Use smaller scaffolded steps before asking for independent work.");
  }

  if (independenceLevel === "mostly_independent" || averageConfidence >= 0.75) {
    guidance.push("Invite a little more independence; avoid over-explaining.");
  }

  if (independenceLevel === "supported" || pacingPreference === "slow") {
    guidance.push("Use slower pacing and one concrete action at a time.");
  }

  if (hasRepeatedConfusion) {
    guidance.push(
      "Give a targeted reminder around the relevant mistake pattern without saying the student always struggles."
    );
  }

  guidance.push(
    "Only reference past learning if it feels natural and useful. Prefer subtle adaptation over explicit memory statements."
  );

  return guidance;
}

export async function recordLearningMemoryEvent(input: LearningMemoryInput) {
  const supabase = createSupabaseServerClient(input.accessToken);
  const topic = input.topic || input.profile.currentSubject || "General tutoring";
  const skills = uniqueLimited(
    [
      ...(input.skills ?? []),
      ...(input.profile.recentConcepts ?? []),
      ...(input.mistakePatterns ?? []),
    ],
    8
  );
  const sessionId = input.sessionId || crypto.randomUUID();
  const completed =
    input.tutoringState === "COMPLETION" ||
    /solved|finished|done|got it|final answer|therefore/i.test(input.studentMessage);
  const now = new Date().toISOString();
  const evidenceCount = getEvidenceCount(input.profile) + 1;
  const confidenceByTopic = buildConfidenceByTopic(input.profile, topic, completed);

  const updatedProfile = {
    ...defaultProfile,
    ...input.profile,
    currentSubject: topic,
    recentConcepts: skills.length
      ? uniqueLimited(skills, 8)
      : input.profile.recentConcepts ?? [],
    lastUpdated: now,
  };

  await supabase.from("learning_profiles").upsert(
    {
      user_id: input.userId,
      profile: updatedProfile,
      preferred_tutoring_style:
        input.profile.preferredTutoringStyle ?? defaultProfile.preferredTutoringStyle,
      pacing_preference: input.profile.pacingPreference ?? defaultProfile.pacingPreference,
      independence_level:
        input.profile.independenceLevel ?? defaultProfile.independenceLevel,
      hint_detail_preference: getHintDetailPreference(input.profile),
      confidence_by_topic: confidenceByTopic,
      recently_practiced_topics: uniqueLimited(
        [topic, ...(input.profile.recentConcepts ?? [])],
        8
      ),
      evidence_count: evidenceCount,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );

  await supabase.from("learning_sessions").upsert(
    {
      id: sessionId,
      user_id: input.userId,
      topic,
      subtopic: skills[0] ?? null,
      status: completed ? "completed" : "active",
      current_problem: input.problem,
      pinned_problem: input.problem,
      last_message_at: now,
      summary: buildSessionSummary(input),
      metadata: {
        mode: input.mode,
        tutoringState: input.tutoringState,
        structuredSummary: buildSafeMemorySummary(input, topic, skills, completed),
        recentMessages: input.conversationHistory?.slice(-6) ?? [],
      },
      ended_at: completed ? now : null,
      completed_at: completed ? now : null,
      updated_at: now,
    },
    { onConflict: "id" }
  );

  await supabase.from("sessions").upsert(
    {
      id: sessionId,
      user_id: input.userId,
      topic,
      problem_text: input.problem,
      screenshot_url: null,
      hints_used: input.profile.problemHistory?.[0]?.hintsUsed ?? 0,
      completion_status: completed ? "completed" : "active",
      updated_at: now,
    },
    { onConflict: "id" }
  );

  await supabase.from("learning_signals").insert(
    buildLearningSignals(input, sessionId, topic, skills, completed)
  );

  const learningMemories = buildLearningMemoryRows(
    input,
    sessionId,
    topic,
    skills,
    completed
  );

  if (learningMemories.length) {
    await supabase.from("learning_memories").insert(learningMemories);
  }

  if (shouldWriteSummary(input, completed)) {
    await supabase.from("tutoring_summaries").insert({
      user_id: input.userId,
      session_id: sessionId,
      summary: buildSessionSummary(input),
      structured_summary: buildSafeMemorySummary(input, topic, skills, completed),
      topics: [topic],
      skills,
      misconceptions: input.mistakePatterns ?? [],
      strengths: input.profile.strongSkills?.slice(0, 4) ?? [],
      confidence_signal: input.profile.confidenceLevel ?? defaultProfile.confidenceLevel,
    });
  }
}

function buildSafeMemorySummary(
  input: LearningMemoryInput,
  topic: string,
  skills: string[],
  completed: boolean
): SafeMemorySummary {
  const mistakes = uniqueLimited(input.mistakePatterns ?? [], 5);
  const reinforcedConcepts = uniqueLimited(
    [
      ...mistakes,
      ...(input.profile.conceptsNeedingReinforcement ?? []),
      ...(input.profile.formulaConfusions ?? []),
      ...(input.profile.setupMistakes ?? []),
    ],
    6
  );
  const masteredConcepts = completed
    ? uniqueLimited(
        [
          ...skills.slice(0, 3),
          ...(input.profile.strongSkills ?? []),
        ],
        5
      )
    : [];
  const hintDependency = input.profile.hintUsageFrequency ?? "low";
  const confidenceEstimate = confidenceScore(input.profile);
  const subtopic = skills[0] || input.profile.problemHistory?.[0]?.subtopic || topic;

  return {
    topicPracticed: topic,
    subtopicPracticed: subtopic,
    conceptsMastered: masteredConcepts,
    conceptsNeedingReinforcement: reinforcedConcepts,
    hintDependency,
    pacingObservation: getPacingObservation(input.profile, mistakes.length),
    independenceLevel: input.profile.independenceLevel ?? defaultProfile.independenceLevel,
    confidenceEstimate,
    recommendationSeeds: uniqueLimited(
      [
        ...reinforcedConcepts,
        ...skills,
        input.profile.spacedReviewQueue?.[0] ?? "",
      ],
      6
    ),
    evidence: {
      completedCheckpoint: completed,
      mistakePatterns: mistakes,
      mode: input.mode,
    },
  };
}

function getPacingObservation(
  profile: Partial<LearningProfile>,
  mistakeCount: number
) {
  if (profile.pacingPreference === "slow" || mistakeCount >= 2) {
    return "Use smaller steps and check one idea at a time.";
  }

  if (
    profile.independenceLevel === "mostly_independent" ||
    profile.difficultyComfortLevel === "ready for challenge"
  ) {
    return "Offer concise guidance and leave room for independent reasoning.";
  }

  if (profile.hintUsageFrequency === "high") {
    return "Start with a tiny hint, then scaffold if the student hesitates.";
  }

  return "Balanced pacing with one concrete next step.";
}

function buildLearningSignals(
  input: LearningMemoryInput,
  sessionId: string,
  topic: string,
  skills: string[],
  completed: boolean
) {
  const baseMetadata = {
    mode: input.mode,
    problem: input.problem.slice(0, 500),
    tutoringState: input.tutoringState,
  };
  const confidence = confidenceScore(input.profile);
  const signals = [
    {
      user_id: input.userId,
      session_id: sessionId,
      signal_type: completed ? "completed_problem" : "solved_step",
      topic,
      skill: skills[0] ?? null,
      confidence,
      metadata: baseMetadata,
    },
  ];

  for (const mistake of input.mistakePatterns ?? []) {
    signals.push({
      user_id: input.userId,
      session_id: sessionId,
      signal_type: "mistake_detected",
      topic,
      skill: mistake,
      confidence,
      metadata: baseMetadata,
    });

    if (/formula|standard form|squared|variable|axis|horizontal|vertical/i.test(mistake)) {
      signals.push({
        user_id: input.userId,
        session_id: sessionId,
        signal_type: "formula_confusion",
        topic,
        skill: mistake,
        confidence,
        metadata: baseMetadata,
      });
    }
  }

  if (input.mode === "hint") {
    signals.push({
      user_id: input.userId,
      session_id: sessionId,
      signal_type: "hint_used",
      topic,
      skill: skills[0] ?? null,
      confidence,
      metadata: baseMetadata,
    });
  }

  if (
    input.profile.confidenceLevel === "building" ||
    input.profile.independenceLevel === "supported"
  ) {
    signals.push({
      user_id: input.userId,
      session_id: sessionId,
      signal_type: "low_confidence",
      topic,
      skill: skills[0] ?? null,
      confidence,
      metadata: baseMetadata,
    });
  }

  if (
    input.profile.reasoningQuality === "strong" ||
    (completed && input.profile.hintUsageFrequency === "low")
  ) {
    signals.push({
      user_id: input.userId,
      session_id: sessionId,
      signal_type: "strong_reasoning",
      topic,
      skill: skills[0] ?? null,
      confidence,
      metadata: baseMetadata,
    });
  }

  return signals;
}

function buildLearningMemoryRows(
  input: LearningMemoryInput,
  sessionId: string,
  topic: string,
  skills: string[],
  completed: boolean
) {
  const confidence = confidenceScore(input.profile);
  const hintLevelNeeded = getHintDetailPreference(input.profile);
  const summary = buildSessionSummary(input);
  const firstSkill = skills[0] ?? null;
  const baseRow = {
    user_id: input.userId,
    session_id: sessionId,
    topic,
    subtopic: skills[1] ?? firstSkill,
    hint_level_needed: hintLevelNeeded,
    tutoring_summary: summary,
    confidence_estimate: confidence,
  };
  const rows: LearningMemoryRow[] = (input.mistakePatterns ?? []).map((mistake) => ({
    ...baseRow,
    skill: firstSkill,
    misconception: mistake,
    mistake_pattern: mistake,
  }));

  if (completed) {
    rows.push({
      ...baseRow,
      skill: firstSkill,
      misconception: null,
      mistake_pattern: null,
      tutoring_summary: firstSkill
        ? `Solved or reached a checkpoint on ${firstSkill}.`
        : "Solved or reached a tutoring checkpoint.",
    });
  }

  if (input.mode === "hint" && !rows.length) {
    rows.push({
      ...baseRow,
      skill: firstSkill,
      misconception: null,
      mistake_pattern: null,
      tutoring_summary: firstSkill
        ? `Needed ${hintLevelNeeded} hint support on ${firstSkill}.`
        : `Needed ${hintLevelNeeded} hint support.`,
    });
  }

  if (
    input.profile.independenceLevel === "mostly_independent" &&
    !rows.some((row) => row.tutoring_summary.includes("independent"))
  ) {
    rows.push({
      ...baseRow,
      skill: firstSkill,
      misconception: null,
      mistake_pattern: null,
      tutoring_summary: firstSkill
        ? `Solved ${firstSkill} with growing independence.`
        : "Worked with growing independence.",
    });
  }

  return rows;
}

function buildSessionSummary(input: LearningMemoryInput) {
  const skillText = input.skills?.slice(0, 3).join(", ") || input.profile.currentSubject;
  const mistakeText = input.mistakePatterns?.slice(0, 2).join(", ");

  return [
    `Worked on ${skillText || "a tutoring problem"}.`,
    mistakeText ? `Watch for ${mistakeText}.` : "",
    input.profile.lastReflection || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function shouldWriteSummary(input: LearningMemoryInput, completed: boolean) {
  return (
    completed ||
    input.mode === "generate_practice" ||
    (input.mistakePatterns?.length ?? 0) > 0
  );
}

function buildConfidenceByTopic(
  profile: Partial<LearningProfile>,
  topic: string,
  completed: boolean
) {
  const existing =
    typeof profile === "object" && profile
      ? ((profile as { confidenceByTopic?: Record<string, string> }).confidenceByTopic ??
          {})
      : {};
  const level = completed
    ? "growing"
    : profile.confidenceLevel === "building"
      ? "needs support"
      : profile.confidenceLevel ?? "steady";

  return {
    ...existing,
    [topic]: level,
  };
}

function getHintDetailPreference(profile: Partial<LearningProfile>) {
  if (profile.hintUsageFrequency === "high") return "more scaffolded";
  if (profile.independenceLevel === "mostly_independent") return "concise";
  return "balanced";
}

function getEvidenceCount(profile: Partial<LearningProfile>) {
  return (
    (profile.problemHistory?.length ?? 0) +
    (profile.tutoringStateHistory?.length ?? 0) +
    (profile.completedProblems ?? 0)
  );
}

function confidenceScore(profile: Partial<LearningProfile>) {
  if (profile.confidenceLevel === "confident") return 0.82;
  if (profile.confidenceLevel === "building") return 0.42;
  return 0.62;
}

function getMemoryKeywords(text: string) {
  return uniqueLimited(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
    10
  );
}

function isRelevantMemory(keywords: string[], text: string) {
  if (!keywords.length) return true;

  const normalizedText = text.toLowerCase();

  return keywords.some((keyword) => normalizedText.includes(keyword));
}

function uniqueLimited<T>(items: T[], limit: number) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit);
}
