"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent, PointerEvent } from "react";
import AccountMenu from "@/components/AccountMenu";
import BrandLogo from "@/components/BrandLogo";
import HelpFeedbackButton from "@/components/HelpFeedbackButton";
import {
  createDefaultLearningProfile,
  loadLearningProfile,
  saveLearningProfile,
  updateLearningProfile,
} from "@/lib/learningProfile";
import type { LearningProfile, ProblemSource } from "@/lib/learningProfile";
import {
  deriveTutoringState,
  detectMistakePatterns,
  getPacingGuidance,
} from "@/lib/tutoringState";
import { supabase } from "@/lib/supabaseClient";

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type HelpMode =
  | "hint"
  | "check_work"
  | "next_step"
  | "generate_practice"
  | "general";

type PracticeOptions = {
  hintLevel?: HintLevel;
  practiceTopic?: string;
  practiceDifficulty?: string;
  practiceType?: string;
};

type HintLevel =
  | "tiny"
  | "bigger"
  | "similar_example"
  | "explain_concept"
  | "reveal_next_step";

type HomeworkAnalysisResponse = {
  message?: string;
  currentProblem?: string;
  confidence?: number;
  needsUserSelection?: boolean;
  lowConfidenceReason?: string;
  visualSummary?: string;
  problems?: DetectedHomeworkProblem[];
  sessionId?: string;
  anonymousUsage?: AnonymousUsagePayload;
  used?: number;
  limit?: number;
};

type TutorHelpResponse = {
  message?: string;
  anonymousUsage?: AnonymousUsagePayload;
  used?: number;
  limit?: number;
  sessionId?: string;
};

type ConversationSummary = {
  id: string;
  topic: string | null;
  subtopic: string | null;
  status: string;
  current_problem: string | null;
  pinned_problem?: string | null;
  uploaded_assets?: unknown;
  tutor_thread?: unknown;
  metadata?: unknown;
  summary: string | null;
  started_at: string;
  last_message_at?: string | null;
  updated_at: string;
  completed_at?: string | null;
};

type ConversationMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type AnonymousUsagePayload = {
  used: number;
  limit: number;
};

type DetectedHomeworkProblem = {
  id: string;
  label: string;
  extractedText: string;
  confidence: number;
  subject: string;
  skills: string[];
  regionHint: string;
  visualContext: string;
  needsConfirmation: boolean;
};

type WorksheetContext = {
  fileName?: string;
  fileType?: string;
  visualSummary?: string;
  currentProblem?: string;
  problems?: DetectedHomeworkProblem[];
  lastTargetPrompt?: string;
  updatedAt?: string;
};

type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropDraft = CropRegion & {
  startX: number;
  startY: number;
};

type LearningRecommendation = {
  title: string;
  description: string;
  topic: string;
  difficulty: string;
  style: string;
  skills: string[];
  suggestedNext: string;
};

const DEMO_LIMIT = 5;
const anonymousDemoUsageCookie = "stepwise_demo_usage";

const focusAreas = ["Problem setup", "Step-by-step reasoning", "Accuracy check"];

const emptyStatePrompts = [
  "Can you explain this step?",
  "What formula should I use?",
  "Can you check my reasoning?",
  "Can you check my answer?",
];

const emptyFocusHints = [
  "Ready to help you think through the next step.",
  "StepWise adapts as you solve.",
  "Focus updates as you learn.",
];

const initialTutorMessage =
  "Let’s work through it together.\nPaste a problem, upload homework, or show me where you got stuck. I’ll help you reason through the next step.";

function getAnonymousDemoUsageFromCookie() {
  if (typeof document === "undefined") return 0;

  const rawCookie = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${anonymousDemoUsageCookie}=`));

  if (!rawCookie) return 0;

  try {
    const parsed = JSON.parse(
      decodeURIComponent(rawCookie.slice(anonymousDemoUsageCookie.length + 1))
    ) as { used?: number };
    const used = Number(parsed.used);

    if (!Number.isFinite(used) || used < 0) return 0;

    return Math.min(Math.floor(used), DEMO_LIMIT);
  } catch {
    return 0;
  }
}

const practiceTopics = [
  "Algebra",
  "Geometry",
  "Precalculus",
  "Calculus",
  "Statistics",
  "SAT Math",
];

const practiceFocusSkillsByTopic: Record<string, string[]> = {
  Algebra: [
    "Fractions",
    "Factoring",
    "Quadratics",
    "Systems of equations",
    "Inequalities",
    "Word problem setup",
  ],
  Geometry: [
    "Triangle properties",
    "Circle theorems",
    "Angle relationships",
    "Congruence and similarity",
    "Coordinate geometry",
    "Proofs",
  ],
  Precalculus: [
    "Functions",
    "Trigonometry",
    "Logarithms",
    "Exponential functions",
    "Polynomial functions",
    "Rational functions",
  ],
  Calculus: [
    "Limits",
    "Derivatives",
    "Integrals",
    "Chain rule",
    "Optimization",
    "Related rates",
  ],
  Statistics: [
    "Probability",
    "Distributions",
    "Mean and standard deviation",
    "Regression",
    "Hypothesis testing",
    "Data interpretation",
  ],
  "SAT Math": [
    "Linear equations",
    "Quadratics",
    "Systems of equations",
    "Ratios and percents",
    "Word problem setup",
    "Data analysis",
  ],
};

const practiceSubjectOptions = [
  "Algebra",
  "Geometry",
  "Precalculus",
  "Calculus",
  "Statistics",
  "SAT Math",
];

const practiceDifficulties = ["Beginner", "Intermediate", "Advanced"];

const starterPracticeStyles = [
  "Guided step-by-step tutoring",
  "Quick warm-up problems",
  "Challenge problems",
  "SAT-style practice",
  "Concept review",
  "Practice with hints",
  "Mostly independent practice",
];

const activePracticeStyles = [
  "Explain the Current Step",
  "Smaller Hint",
  "Check My Setup",
  "Concept Check",
];

const checkpointPracticeStyles = [
  "Similar Problems",
  "Practice This Skill",
  "Try Another Like This",
  "Reinforce Weak Areas",
  "Harder Version",
  "Retry With Less Help",
  "Mixed Review",
];

const hintOptions: Array<{
  label: string;
  level: HintLevel;
  prompt: string;
}> = [
  {
    label: "Tiny Hint",
    level: "tiny",
    prompt: "Give me the smallest possible hint.",
  },
  {
    label: "Bigger Hint",
    level: "bigger",
    prompt: "Give me a clearer hint, but do not solve it.",
  },
  {
    label: "Similar Example",
    level: "similar_example",
    prompt: "Show me a similar example before I try this one.",
  },
  {
    label: "Explain Concept",
    level: "explain_concept",
    prompt: "Explain the concept behind this step.",
  },
  {
    label: "Reveal Next Step",
    level: "reveal_next_step",
    prompt: "Reveal only the next step, not the full solution.",
  },
];

function normalizeMathContent(content: string) {
  const dollarMathContent = content
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math) => `$${math}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math) => `$$${math}$$`);

  return dollarMathContent
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)
    .map((part) => {
      if (part.startsWith("$")) return part;

      return part.replace(/\b([A-Za-z])\^(\d+)\b/g, (_match, base, exponent) => {
        return `$${base}^{${exponent}}$`;
      });
    })
    .join("");
}

function MathMessage({ content }: { content: string }) {
  return (
    <div className="space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => (
            <ul className="ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
        }}
      >
        {normalizeMathContent(content)}
      </ReactMarkdown>
    </div>
  );
}

function detectFocus(text: string) {
  const lowerText = text.toLowerCase();

  if (/hyperbola|asymptote|conjugate axis|transverse axis/.test(lowerText)) {
    return {
      subject: "Precalculus",
      skills: ["Conic sections", "Hyperbolas", "Asymptotes"],
    };
  }

  if (/ellipse|foci|major axis|minor axis/.test(lowerText)) {
    return {
      subject: "Precalculus",
      skills: ["Conic sections", "Ellipses", "Foci"],
    };
  }

  if (/parabola|directrix|focus|vertex|axis of symmetry/.test(lowerText)) {
    return {
      subject: "Precalculus",
      skills: ["Conic sections", "Parabolas", "Vertex form"],
    };
  }

  if (/conic|standard form|center|vertices/.test(lowerText)) {
    return {
      subject: "Precalculus",
      skills: ["Conic sections", "Equation structure", "Graph features"],
    };
  }

  if (/circle|radius|diameter|center/.test(lowerText)) {
    return {
      subject: "Geometry",
      skills: ["Circle properties", "Coordinate geometry", "Equation setup"],
    };
  }

  if (
    /x\^2|x²|x2|quadratic|factor|polynomial|\bequation\b|\bsolve\b|\bx\b/.test(
      lowerText
    )
  ) {
    return {
      subject: "Algebra",
      skills:
        /x\^2|x²|x2|quadratic|factor|polynomial|parabola/.test(lowerText)
          ? ["Factoring", "Quadratics", "Polynomial equations"]
          : ["Equation setup", "Isolating variables", "Accuracy check"],
    };
  }

  if (/derivative|integral|limit|differentiate|calculus/.test(lowerText)) {
    return {
      subject: "Calculus",
      skills: ["Rates of change", "Functions", "Step-by-step reasoning"],
    };
  }

  if (/sin|cos|tan|trig|log|exponential|precalculus/.test(lowerText)) {
    return {
      subject: "Precalculus",
      skills: ["Functions", "Trigonometry", "Equation setup"],
    };
  }

  if (/triangle|circle|angle|area|volume|proof|geometry/.test(lowerText)) {
    return {
      subject: "Geometry",
      skills: ["Diagram reasoning", "Properties", "Proof setup"],
    };
  }

  if (/mean|median|probability|standard deviation|regression|statistics/.test(lowerText)) {
    return {
      subject: "Statistics",
      skills: ["Data interpretation", "Probability", "Accuracy check"],
    };
  }

  if (/force|velocity|acceleration|energy|mass|physics/.test(lowerText)) {
    return {
      subject: "Physics",
      skills: ["Word problem setup", "Units", "Formula selection"],
    };
  }

  if (/sat|act|test prep/.test(lowerText)) {
    return {
      subject: "SAT Math",
      skills: ["Test strategy", "Problem setup", "Accuracy check"],
    };
  }

  if (/word problem|story problem|real-world|real world/.test(lowerText)) {
    return {
      subject: "Math",
      skills: ["Problem setup", "Relevant information", "Equation building"],
    };
  }

  if (lowerText.trim()) {
    return {
      subject: "Math",
      skills: focusAreas,
    };
  }

  return {
    subject: "Waiting for a problem",
    skills: focusAreas,
  };
}

function hasFullAttemptSignal(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) return false;

  return (
    /(?:^|\s)(?:x|y|[a-z])\s*=/.test(trimmedText) ||
    /=/.test(trimmedText) ||
    /answer is|final answer|therefore|i got|is this right|does this work/i.test(
      trimmedText
    ) ||
    trimmedText.split(/\s+/).length >= 12
  );
}

function hasAnswerCheckIntent(text: string) {
  return /check (?:my )?(?:answer|work)|can you check|verify|did i get (?:this|it)?\s*right|is (?:this|that|it|my answer|the answer)(?:\b|[^a-z])|is (?:the\s+)?answer\s+(?:for|to)\s+#?\d+[a-z]?|is this (?:right|correct)|is my answer|does this (?:work|look right)|would this be|my answer is|answer is|i got|final answer|correct\?/i.test(
    text
  );
}

function getLearningRecommendation({
  text,
  subject,
  skills,
  hintRequests,
  incorrectAttempts,
  attemptCount,
  interactions,
  learningProfile,
}: {
  text: string;
  subject: string;
  skills: string[];
  hintRequests: number;
  incorrectAttempts: number;
  attemptCount: number;
  interactions: number;
  learningProfile: LearningProfile;
}): LearningRecommendation | null {
  if (!text.trim() || interactions === 0) return null;

  const memorySkill =
    learningProfile.spacedReviewQueue[0] ||
    learningProfile.conceptsNeedingReinforcement[0] ||
    learningProfile.formulaConfusions[0] ||
    learningProfile.setupMistakes[0];
  const needsMoreScaffolding =
    hintRequests >= 2 ||
    incorrectAttempts >= 1 ||
    /i don't know|idk|stuck|confused|lost|not sure/.test(text);
  const isMovingQuickly =
    interactions >= 2 && attemptCount > 0 && hintRequests === 0 && incorrectAttempts === 0;
  const difficulty = needsMoreScaffolding
    ? "Beginner"
    : isMovingQuickly
      ? "Advanced"
      : "Intermediate";
  const style = needsMoreScaffolding
    ? "Easier version"
    : isMovingQuickly
      ? "Exam-style question"
      : "Similar problem";

  if (memorySkill) {
    return {
      title: `Practice ${memorySkill.toLowerCase()}.`,
      description:
        "This connects to your recent tutoring work, so it should feel like a useful next step instead of random practice.",
      topic: subject === "Waiting for a problem" ? learningProfile.currentSubject : subject,
      difficulty,
      style: needsMoreScaffolding ? "Easier version" : "Reinforce Weak Areas",
      skills: uniqueLimited([memorySkill, ...skills], 3),
      suggestedNext: learningProfile.problemHistory[0]?.problemType ?? skills[1] ?? "Try one more focused step",
    };
  }

  if (/factor|quadratic|x\^2|x²|x2|polynomial|parabola/.test(text)) {
    return {
      title: "Try one more factoring problem.",
      description:
        "A related quadratic will help strengthen the pattern before moving to a harder setup.",
      topic: "Algebra",
      difficulty,
      style,
      skills: ["Factoring quadratics", "Polynomial equations", "Step-by-step reasoning"],
      suggestedNext: "Completing the square",
    };
  }

  if (/formula|which equation|what equation|what formula/.test(text)) {
    return {
      title: "Practice choosing the right setup.",
      description:
        "A short formula-recognition problem can make the next step feel clearer.",
      topic: subject === "Waiting for a problem" ? "Algebra" : subject,
      difficulty,
      style: needsMoreScaffolding ? "Easier version" : "Mixed review",
      skills: ["Formula recognition", "Problem setup", "Accuracy check"],
      suggestedNext: "Translate the question into a plan",
    };
  }

  if (/derivative|differentiate|power rule/.test(text)) {
    return {
      title: "Reinforce the derivative rule.",
      description:
        "One focused power-rule problem can help lock in the pattern before combining rules.",
      topic: "Calculus",
      difficulty,
      style,
      skills: ["Derivatives", "Power rule", "Function notation"],
      suggestedNext: "Product and chain rule practice",
    };
  }

  if (/integral|antiderivative|area under/.test(text)) {
    return {
      title: "Build fluency with integrals.",
      description:
        "Try a nearby integration problem so the reverse-power pattern becomes more automatic.",
      topic: "Calculus",
      difficulty,
      style,
      skills: ["Integrals", "Antiderivatives", "Pattern recognition"],
      suggestedNext: "Definite integrals",
    };
  }

  if (/triangle|circle|angle|proof|geometry/.test(text)) {
    return {
      title: "Practice the diagram reasoning.",
      description:
        "A similar geometry prompt can help you decide which property or theorem applies.",
      topic: "Geometry",
      difficulty,
      style,
      skills: ["Diagram reasoning", "Angle relationships", "Proof setup"],
      suggestedNext: "Explain why each relationship is true",
    };
  }

  if (/mean|median|probability|standard deviation|regression/.test(text)) {
    return {
      title: "Practice interpreting the data.",
      description:
        "A short statistics question can help connect the calculation to what it means.",
      topic: "Statistics",
      difficulty,
      style,
      skills: ["Data interpretation", "Probability", "Accuracy check"],
      suggestedNext: "Explain the result in context",
    };
  }

  return {
    title: `Practice ${skills[0]?.toLowerCase() ?? "the next step"}.`,
    description:
      "A related problem can help turn this step into something you can do with more confidence.",
    topic: subject === "Waiting for a problem" ? "Algebra" : subject,
    difficulty,
    style,
    skills,
    suggestedNext: skills[1] ?? "Try a similar problem",
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function uniqueLimited(items: string[], limit: number) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, limit);
}

function normalizeCropRegion(crop: CropRegion) {
  return {
    x: Math.round(clampPercent(crop.x)),
    y: Math.round(clampPercent(crop.y)),
    width: Math.round(clampPercent(crop.width)),
    height: Math.round(clampPercent(crop.height)),
  };
}

export default function DemoPage() {
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [problem, setProblem] = useState("");
  const [currentProblem, setCurrentProblem] = useState("");
  const [attempt, setAttempt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      content: initialTutorMessage,
    },
  ]);
  const [interactions, setInteractions] = useState(0);
  const [attemptCount, setAttemptCount] = useState(0);
  const [incorrectAttempts, setIncorrectAttempts] = useState(0);
  const [learningProfile, setLearningProfile] = useState<LearningProfile>(
    createDefaultLearningProfile
  );
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileDataUrl, setUploadedFileDataUrl] = useState("");
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const [homeworkAnalysis, setHomeworkAnalysis] =
    useState<HomeworkAnalysisResponse | null>(null);
  const [activeWorksheetContext, setActiveWorksheetContext] =
    useState<WorksheetContext | null>(null);
  const [selectedHomeworkProblemId, setSelectedHomeworkProblemId] =
    useState("");
  const [editedExtractedProblem, setEditedExtractedProblem] = useState("");
  const [cropModeOpen, setCropModeOpen] = useState(false);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [isCropDragging, setIsCropDragging] = useState(false);
  const [confirmedUploadProblem, setConfirmedUploadProblem] = useState(false);
  const [showUploadConfirmation, setShowUploadConfirmation] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isTutorRequestPending, setIsTutorRequestPending] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState(
    "Let's think through this together."
  );
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profileSyncReady, setProfileSyncReady] = useState(false);
  const [serverLimitReached, setServerLimitReached] = useState(false);
  const [serverLimitMessage, setServerLimitMessage] = useState("");
  const [hintRequests, setHintRequests] = useState(0);
  const [hintMenuOpen, setHintMenuOpen] = useState(false);
  const [lastTutorMode, setLastTutorMode] = useState<HelpMode | null>(null);
  const [practicePickerOpen, setPracticePickerOpen] = useState(false);
  const [checkpointPracticeState, setCheckpointPracticeState] = useState<
    "available" | "generating" | "practice_started" | "dismissed"
  >("available");
  const [usedCheckpointKey, setUsedCheckpointKey] = useState("");
  const [conversationHistory, setConversationHistory] = useState<
    ConversationSummary[]
  >([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");
  const [selectedPracticeTopic, setSelectedPracticeTopic] = useState("Algebra");
  const [selectedPracticeDifficulty, setSelectedPracticeDifficulty] =
    useState("Intermediate");
  const [selectedPracticeStyle, setSelectedPracticeStyle] =
    useState("Guided step-by-step tutoring");
  const [practiceGoal, setPracticeGoal] = useState("");
  const [selectedPracticeFocus, setSelectedPracticeFocus] = useState("");
  const [practiceContext, setPracticeContext] = useState("");

  useEffect(() => {
    setLearningProfile(loadLearningProfile());
  }, []);

  useEffect(() => {
    saveLearningProfile(learningProfile);

    if (!currentUserId || !profileSyncReady) return;

    const syncTimer = window.setTimeout(() => {
      void supabase.from("learning_profiles").upsert(
        {
          user_id: currentUserId,
          profile: learningProfile,
          preferred_tutoring_style: learningProfile.preferredTutoringStyle,
          pacing_preference: learningProfile.pacingPreference,
          independence_level: learningProfile.independenceLevel,
          hint_detail_preference:
            learningProfile.hintUsageFrequency === "high"
              ? "more scaffolded"
              : learningProfile.independenceLevel === "mostly_independent"
                ? "concise"
                : "balanced",
          confidence_by_topic: learningProfile.confidenceByTopic,
          recently_practiced_topics: learningProfile.recentConcepts.slice(0, 8),
          evidence_count:
            learningProfile.problemHistory.length +
            learningProfile.tutoringStateHistory.length +
            learningProfile.completedProblems,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    }, 500);

    return () => window.clearTimeout(syncTimer);
  }, [learningProfile, currentUserId, profileSyncReady]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id ?? null;
      const resumeSessionId = getSessionIdFromUrl();
      setIsLoggedIn(Boolean(data.session?.access_token));
      setCurrentUserId(userId);
      setProfileSyncReady(false);

      if (userId) {
        void loadRemoteLearningProfile(userId).finally(() => {
          setProfileSyncReady(true);
        });
        if (resumeSessionId) {
          void loadConversation(resumeSessionId);
        }
      } else {
        setInteractions(getAnonymousDemoUsageFromCookie());
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      const resumeSessionId = getSessionIdFromUrl();
      setIsLoggedIn(Boolean(session?.access_token));
      setCurrentUserId(userId);
      setProfileSyncReady(false);

      if (userId) {
        void loadRemoteLearningProfile(userId).finally(() => {
          setProfileSyncReady(true);
        });
        if (resumeSessionId) {
          void loadConversation(resumeSessionId);
        }
      } else {
        setInteractions(getAnonymousDemoUsageFromCookie());
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  function getSessionIdFromUrl() {
    if (typeof window === "undefined") return "";

    return new URLSearchParams(window.location.search).get("sessionId") ?? "";
  }

  async function loadRemoteLearningProfile(userId: string) {
    const { data } = await supabase
      .from("learning_profiles")
      .select("profile")
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.profile) {
      setLearningProfile({
        ...createDefaultLearningProfile(),
        ...(data.profile as Partial<LearningProfile>),
      });
    }
  }

  function getStoredWorksheetContext(
    session: Pick<ConversationSummary, "tutor_thread" | "metadata"> | undefined
  ): WorksheetContext | null {
    if (!session) return null;

    const tutorThread = session.tutor_thread as
      | { worksheetContext?: unknown }
      | null
      | undefined;
    const metadata = session.metadata as
      | { worksheetContext?: unknown }
      | null
      | undefined;

    return (
      normalizeWorksheetContext(tutorThread?.worksheetContext) ||
      normalizeWorksheetContext(metadata?.worksheetContext)
    );
  }

  function normalizeWorksheetContext(value: unknown): WorksheetContext | null {
    if (!value || typeof value !== "object") return null;

    const context = value as Partial<WorksheetContext>;
    const problems = Array.isArray(context.problems)
      ? context.problems
          .filter(
            (problem): problem is DetectedHomeworkProblem =>
              Boolean(problem) &&
              typeof problem === "object" &&
              typeof (problem as DetectedHomeworkProblem).extractedText ===
                "string" &&
              Boolean((problem as DetectedHomeworkProblem).extractedText.trim())
          )
          .slice(0, 20)
      : [];

    if (!problems.length && !context.currentProblem && !context.visualSummary) {
      return null;
    }

    return {
      fileName: typeof context.fileName === "string" ? context.fileName : "",
      fileType: typeof context.fileType === "string" ? context.fileType : "",
      visualSummary:
        typeof context.visualSummary === "string" ? context.visualSummary : "",
      currentProblem:
        typeof context.currentProblem === "string" ? context.currentProblem : "",
      problems,
      lastTargetPrompt:
        typeof context.lastTargetPrompt === "string" ? context.lastTargetPrompt : "",
      updatedAt: typeof context.updatedAt === "string" ? context.updatedAt : "",
    };
  }

  const reachedDemoLimit = interactions >= DEMO_LIMIT;
  const localDemoLocked = !isLoggedIn && reachedDemoLimit;
  const usageLimitReached = localDemoLocked || serverLimitReached;
  const needsReasoningPractice = incorrectAttempts >= 2;
  const hasActiveSession =
    interactions > 0 ||
    messages.length > 1 ||
    messages.some((message) => message.role === "user");
  const latestUserMessage =
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? "";
  const sessionContext =
    currentProblem.trim() ||
    problem.trim() ||
    activeWorksheetContext?.fileName ||
    uploadedFile?.name ||
    "Getting started";
  const hasLearningContext = Boolean(
    currentProblem.trim() ||
      problem.trim() ||
      activeWorksheetContext ||
      latestUserMessage.trim()
  );
  const waitingForProblem =
    !hasLearningContext && !uploadedFile && !activeWorksheetContext && !practiceContext;
  const selectedHomeworkProblem =
    homeworkAnalysis?.problems?.find(
      (detectedProblem) => detectedProblem.id === selectedHomeworkProblemId
    ) ?? homeworkAnalysis?.problems?.[0];
  const uploadNeedsConfirmation = Boolean(
    showUploadConfirmation &&
      uploadedFile &&
      homeworkAnalysis &&
      !confirmedUploadProblem
  );
  const detectedFocus = detectFocus(
    [
      currentProblem,
      problem,
      attempt,
      latestUserMessage,
      uploadedFile?.name ?? "",
      activeWorksheetContext?.visualSummary ?? "",
      practiceContext,
    ].join(" ")
  );
  const visibleMessages = hasActiveSession
    ? messages.filter((message) => message.id !== 1)
    : messages;
  const learningSignalText = [
    currentProblem,
    problem,
    attempt,
    practiceContext,
    ...messages.map((message) => message.content),
  ]
    .join(" ")
    .toLowerCase();
  const learningRecommendation = hasLearningContext
    ? getLearningRecommendation({
        text: learningSignalText,
        subject: detectedFocus.subject,
        skills: detectedFocus.skills,
        hintRequests,
        incorrectAttempts,
        attemptCount,
        interactions,
        learningProfile,
      })
    : null;
  const latestUserMessageLower = latestUserMessage.toLowerCase();
  const activeConfusionSignal =
    /i don't know|idk|stuck|confused|lost|not sure|help me|get started/.test(
      latestUserMessageLower
    );
  const completionSignal =
    /solved|finished|done|got it|answer is|i got|final answer|therefore/.test(
      latestUserMessageLower
    ) || /(?:so|therefore)\s+[a-z]\s*=/.test(latestUserMessageLower);
  const fullAttemptSignal = hasFullAttemptSignal(latestUserMessage);
  const answerCheckSignal = hasAnswerCheckIntent(latestUserMessage);
  const confidentAttemptSignal =
    /i got|i think|final answer|answer is|is this right|does this work/.test(
      latestUserMessageLower
    );
  const currentTutoringSignals = {
    hintRequests,
    attemptCount,
    incorrectAttempts,
    conversationTurns: messages.length,
    lastTutorMode,
    activeConfusionSignal,
    completionSignal,
    fullAttemptSignal,
    answerCheckSignal,
    confidentAttemptSignal,
    requestedPracticeSignal:
      /practice|another|similar|harder|easier|review|next problem/.test(
        latestUserMessageLower
      ),
  };
  const activeTutoringState = deriveTutoringState({
    mode: lastTutorMode ?? "general",
    studentMessage: latestUserMessage || attempt || problem,
    learningProfile,
    tutoringSignals: currentTutoringSignals,
  });
  const activePacingGuidance = getPacingGuidance({
    state: activeTutoringState,
    learningProfile,
  });
  const activePacingLabel = activePacingGuidance.includes("slow")
    ? "Slow, guided pacing"
    : activePacingGuidance.includes("independent")
      ? "Independent pacing"
      : "Balanced pacing";
  const demonstratedUnderstandingSignal =
    attemptCount >= 2 && incorrectAttempts === 0 && interactions >= 2;
  const reachedLearningCheckpoint =
    completionSignal || demonstratedUnderstandingSignal;
  const suppressRecommendation =
    activeConfusionSignal ||
    isThinking ||
    lastTutorMode === "hint" ||
    (lastTutorMode === "check_work" &&
      !completionSignal &&
      !demonstratedUnderstandingSignal);
  const shouldShowRecommendation = Boolean(
    hasActiveSession &&
      hasLearningContext &&
      learningRecommendation &&
      reachedLearningCheckpoint &&
      !suppressRecommendation &&
      checkpointPracticeState === "available" &&
      usedCheckpointKey !== getCheckpointKey(learningRecommendation) &&
      !usageLimitReached
  );
  const practiceState = !hasActiveSession && !currentProblem && !uploadedFile
    ? "starter"
    : reachedLearningCheckpoint
      ? "checkpoint"
      : "active";
  const availablePracticeStyles =
    practiceState === "starter"
      ? starterPracticeStyles
      : practiceState === "checkpoint"
        ? checkpointPracticeStyles
        : activePracticeStyles;
  const practiceTitle =
    practiceState === "starter"
      ? "What would you like to practice today?"
      : practiceState === "checkpoint"
        ? "Practice what comes next"
        : "Focus on the current problem";
  const practiceDescription =
    practiceState === "starter"
      ? "Tell StepWise what you are studying before it creates anything."
      : practiceState === "checkpoint"
        ? "StepWise can now use your tutoring progress to suggest focused practice."
        : "Stay with this problem first. StepWise can support the next step without jumping ahead.";

  useEffect(() => {
    if (!learningRecommendation) return;

    const checkpointKey = getCheckpointKey(learningRecommendation);
    if (checkpointKey !== usedCheckpointKey) {
      setCheckpointPracticeState("available");
    }
  }, [learningRecommendation, usedCheckpointKey]);

  const availablePracticeFocusSkills =
    practiceFocusSkillsByTopic[selectedPracticeTopic] ??
    practiceFocusSkillsByTopic.Algebra;
  const latestAssistantMessageId = [...visibleMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.id !== 1)?.id;
  const displaySubject = waitingForProblem
    ? "Ready to adapt"
    : detectedFocus.subject;
  const reasoningChecksPassed = Math.max(0, attemptCount - incorrectAttempts);
  const stepsCompleted = attemptCount + Math.max(0, interactions - hintRequests);
  const skillsPracticed = waitingForProblem ? 0 : detectedFocus.skills.length;
  const adaptiveMemoryMessage = (() => {
    if (learningProfile.lastReflection) return learningProfile.lastReflection;
    if (learningProfile.spacedReviewQueue[0]) {
      return `${learningProfile.spacedReviewQueue[0]} is ready for a short refresh soon.`;
    }
    if (learningProfile.recurringMistakes[0]) {
      return `${learningProfile.recurringMistakes[0]} is worth checking carefully.`;
    }
    if (learningProfile.conceptsNeedingReinforcement[0]) {
      return `${learningProfile.conceptsNeedingReinforcement[0]} may need a slower step.`;
    }
    if (learningProfile.strongSkills[0]) {
      return `${learningProfile.strongSkills[0]} is becoming more steady.`;
    }
    if (reasoningChecksPassed > 0) {
      return "Your reasoning checks are getting stronger.";
    }
    if (learningProfile.recentConcepts[0]) {
      return `Recently practiced ${learningProfile.recentConcepts[0].toLowerCase()}.`;
    }
    return "StepWise learns how you reason over time.";
  })();
  const latestAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.content ?? "";
  const showFeedbackNudge =
    /trouble|confusing|not fully sure|temporary issue|longer than usual|try again|limit|couldn’t|couldn't|stuck/i.test(
      latestAssistantMessage
    );
  const feedbackContext = {
    source: "demo_workspace",
    currentProblem: currentProblem || problem || "",
    sessionContext,
    detectedFocus,
    tutoringState: activeTutoringState,
    pacing: activePacingLabel,
    usage: {
      interactions,
      demoLimit: DEMO_LIMIT,
      isLoggedIn,
      serverLimitReached,
    },
    upload: uploadedFile
      ? {
          fileName: uploadedFile.name,
          fileType: uploadedFile.type,
          confirmedUploadProblem,
          hasPreview: Boolean(uploadPreviewUrl),
          latestAnalysisMessage: homeworkAnalysis?.message ?? "",
        }
      : null,
    recentMessages: messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    learningMemory: {
      recentConcepts: learningProfile.recentConcepts.slice(0, 5),
      recurringMistakes: learningProfile.recurringMistakes.slice(0, 5),
      conceptsNeedingReinforcement:
        learningProfile.conceptsNeedingReinforcement.slice(0, 5),
      independenceLevel: learningProfile.independenceLevel,
      lastReflection: learningProfile.lastReflection,
    },
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, isThinking, shouldShowRecommendation]);

  useEffect(() => {
    if (!availablePracticeStyles.includes(selectedPracticeStyle)) {
      setSelectedPracticeStyle(availablePracticeStyles[0]);
    }
  }, [availablePracticeStyles, selectedPracticeStyle]);

  useEffect(() => {
    if (
      selectedPracticeFocus &&
      !availablePracticeFocusSkills.includes(selectedPracticeFocus)
    ) {
      setSelectedPracticeFocus("");
    }
  }, [availablePracticeFocusSkills, selectedPracticeFocus]);

  useEffect(() => {
    if (!currentUserId) {
      setConversationHistory([]);
      return;
    }

    void loadConversationHistory();
  }, [currentUserId]);

  function addMessage(role: Message["role"], content: string) {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: Date.now() + currentMessages.length,
        role,
        content,
      },
    ]);
  }

  function showDemoLimitMessage() {
    if (
      messages[messages.length - 1]?.content !==
      "You've used the free demo sessions. Create a free account to continue learning."
    ) {
      addMessage(
        "assistant",
        "You've used the free demo sessions. Create a free account to continue learning."
      );
    }
  }

  function canUseDemo() {
    if (serverLimitReached) {
      showServerLimitMessage(serverLimitMessage);
      return false;
    }

    if (isLoggedIn) {
      return true;
    }

    if (localDemoLocked) {
      showDemoLimitMessage();
      return false;
    }

    return true;
  }

  function syncInteractionUsage(data: {
    anonymousUsage?: AnonymousUsagePayload;
    used?: number;
    limit?: number;
  }) {
    if (isLoggedIn) {
      setInteractions((currentInteractions) => currentInteractions + 1);
      return;
    }

    if (data.anonymousUsage) {
      setInteractions(data.anonymousUsage.used);
    }
  }

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    setIsLoggedIn(Boolean(accessToken));

    return accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : {};
  }

  async function loadConversationHistory() {
    try {
      setIsLoadingHistory(true);
      setHistoryMessage("");
      const authHeaders = await getAuthHeaders();

      if (!authHeaders.Authorization) {
        setConversationHistory([]);
        return;
      }

      const response = await fetch("/api/conversations", {
        headers: authHeaders,
      });
      const data = (await response.json()) as {
        conversations?: ConversationSummary[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || "Conversation history could not load.");
      }

      setConversationHistory(data.conversations ?? []);
    } catch (error) {
      console.error(error);
      setHistoryMessage(
        getFriendlyClientError(
          error,
          "I couldn’t load conversation history right now."
        )
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function loadConversation(sessionIdToLoad: string) {
    try {
      setIsLoadingHistory(true);
      setHistoryMessage("");
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        `/api/conversations?sessionId=${encodeURIComponent(sessionIdToLoad)}`,
        {
          headers: authHeaders,
        }
      );
      const data = (await response.json()) as {
        session?: ConversationSummary;
        messages?: ConversationMessageRow[];
        message?: string;
      };

      if (!response.ok || !data.session) {
        throw new Error(data.message || "Conversation could not load.");
      }

      const loadedMessages = (data.messages ?? []).map((message, index) => ({
        id: Date.parse(message.created_at) + index,
        role: message.role,
        content: message.content,
      }));

      setSessionId(data.session.id);
      const restoredProblem =
        data.session.pinned_problem ?? data.session.current_problem ?? "";

      setCurrentProblem(restoredProblem);
      setProblem(restoredProblem);
      setUploadedFile(null);
      setUploadedFileDataUrl("");
      setUploadPreviewUrl("");
      setActiveWorksheetContext(getStoredWorksheetContext(data.session));
      setConfirmedUploadProblem(Boolean(restoredProblem));
      setShowUploadConfirmation(false);
      setMessages(
        loadedMessages.length
          ? loadedMessages
          : [
              {
                id: 1,
                role: "assistant",
                content: initialTutorMessage,
              },
            ]
      );
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          `/demo?sessionId=${encodeURIComponent(data.session.id)}`
        );
      }
    } catch (error) {
      console.error(error);
      setHistoryMessage(
        getFriendlyClientError(
          error,
          "I couldn’t load that conversation right now."
        )
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }

  function startNewConversation() {
    setSessionId(crypto.randomUUID());
    setProblem("");
    setCurrentProblem("");
    setAttempt("");
    setUploadedFile(null);
    setUploadedFileDataUrl("");
    setUploadPreviewUrl("");
    setHomeworkAnalysis(null);
    setActiveWorksheetContext(null);
    setCheckpointPracticeState("available");
    setUsedCheckpointKey("");
    setSelectedHomeworkProblemId("");
    setEditedExtractedProblem("");
    setConfirmedUploadProblem(false);
    setShowUploadConfirmation(false);
    setHintMenuOpen(false);
    setPracticePickerOpen(false);
    setMessages([
      {
        id: 1,
        role: "assistant",
        content: initialTutorMessage,
      },
    ]);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/demo");
    }
  }

  async function finishCurrentSession() {
    if (!isLoggedIn || !sessionId) return;

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/conversations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          sessionId,
          status: "completed",
        }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message || "Session could not be finished.");
      }

      addMessage(
        "assistant",
        "Nice work. I marked this session complete, so the dashboard will suggest what to do next instead of reopening this exact thread."
      );
      void loadConversationHistory();
    } catch (error) {
      console.error(error);
      addMessage(
        "assistant",
        getFriendlyClientError(
          error,
          "I couldn’t finish that session right now. Try again in a moment."
        )
      );
    }
  }

  function getConversationTitle(conversation: ConversationSummary) {
    return (
      conversation.pinned_problem?.slice(0, 80) ||
      conversation.current_problem?.slice(0, 80) ||
      conversation.subtopic ||
      conversation.topic ||
      "Tutoring session"
    );
  }

  function getConversationMeta(conversation: ConversationSummary) {
    const date = new Date(
      conversation.last_message_at || conversation.updated_at || conversation.started_at
    );
    const dateLabel = Number.isNaN(date.getTime())
      ? "Recent"
      : date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });

    return [conversation.subtopic || conversation.topic, dateLabel]
      .filter(Boolean)
      .join(" · ");
  }

  function showServerLimitMessage(message?: string) {
    const friendlyMessage =
      message ||
      "You've reached today's free tutoring limit. Come back later or create an account to keep learning.";

    setServerLimitReached(true);
    setServerLimitMessage(friendlyMessage);
    if (messages[messages.length - 1]?.content !== friendlyMessage) {
      addMessage("assistant", friendlyMessage);
    }
  }

  function getThinkingLabel(mode: HelpMode, options: PracticeOptions = {}) {
    if (mode === "check_work") return "Checking your reasoning...";
    if (mode === "generate_practice") return "Building a practice problem...";
    if (mode === "next_step") return "Looking for the next small step...";

    if (mode === "hint") {
      if (options.hintLevel === "tiny") return "Finding a tiny hint...";
      if (options.hintLevel === "bigger") return "Making the hint clearer...";
      if (options.hintLevel === "similar_example") {
        return "Finding a similar example...";
      }
      if (options.hintLevel === "explain_concept") {
        return "Explaining the concept...";
      }
      if (options.hintLevel === "reveal_next_step") {
        return "Revealing just the next step...";
      }

      return "Thinking of a helpful hint...";
    }

    return "Let's think through this together...";
  }

  function showThinkingAfterDelay(label: string) {
    return window.setTimeout(() => {
      setThinkingLabel(label);
      setIsThinking(true);
    }, 450);
  }

  async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMessage: string
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(timeoutMessage);
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getFriendlyClientError(error: unknown, fallback: string) {
    if (!(error instanceof Error)) return fallback;

    const safePrefixes = [
      "I ",
      "I’m",
      "I've",
      "You've",
      "StepWise is",
      "Stepwise is",
    ];

    return safePrefixes.some((prefix) => error.message.startsWith(prefix))
      ? error.message
      : fallback;
  }

  function getProblemSource(mode: HelpMode, uploadedContext?: string): ProblemSource {
    if (mode === "generate_practice") return "generated_practice";
    if (uploadedContext || uploadedFile) return "uploaded_screenshot";
    if (currentProblem.trim() || problem.trim()) return "typed";
    return "unknown";
  }

  function rememberLearningEvent(
    mode: HelpMode,
    studentMessage: string,
    uploadedContext?: string,
    assistantMessage?: string
  ) {
    const eventFocus = uploadedContext ? detectFocus(uploadedContext) : detectedFocus;
    const eventMistakes = detectMistakePatterns(
      `${currentProblem}\n${problem}\n${studentMessage}\n${uploadedContext ?? ""}\n${
        assistantMessage ?? ""
      }`
    );
    const eventTutoringState = deriveTutoringState({
      mode,
      studentMessage,
      learningProfile,
      tutoringSignals: {
        ...currentTutoringSignals,
        activeConfusionSignal:
          currentTutoringSignals.activeConfusionSignal ||
          /i don't know|idk|stuck|confused|lost|not sure|don't get|no idea|help/i.test(
            studentMessage
          ),
        completionSignal:
          currentTutoringSignals.completionSignal ||
          /solved|finished|done|got it|answer is|i got|final answer|therefore/i.test(
            studentMessage
          ) ||
          /(?:so|therefore)\s+[a-z]\s*=/i.test(studentMessage),
        fullAttemptSignal:
          currentTutoringSignals.fullAttemptSignal ||
          hasFullAttemptSignal(studentMessage),
        answerCheckSignal:
          currentTutoringSignals.answerCheckSignal ||
          hasAnswerCheckIntent(studentMessage),
        confidentAttemptSignal:
          currentTutoringSignals.confidentAttemptSignal ||
          /i got|i think|final answer|answer is|is this right|does this work/i.test(
            studentMessage
          ),
      },
    });

    setLearningProfile((currentProfile) =>
      updateLearningProfile(currentProfile, {
        subject: eventFocus.subject,
        skills: learningRecommendation?.skills ?? eventFocus.skills,
        recommendation: shouldShowRecommendation ? learningRecommendation?.title : undefined,
        mode,
        studentMessage,
        uploadedContext,
        assistantMessage,
        problemText:
          currentProblem.trim() ||
          problem.trim() ||
          uploadedContext?.trim() ||
          (mode === "generate_practice" ? practiceContext.trim() : studentMessage.trim()),
        problemSource: getProblemSource(mode, uploadedContext),
        difficulty:
          selectedPracticeDifficulty === "Beginner" ||
          selectedPracticeDifficulty === "Intermediate" ||
          selectedPracticeDifficulty === "Advanced"
            ? selectedPracticeDifficulty
            : "Intermediate",
        incorrectAttempts,
        hintRequests,
        completedProblem: eventTutoringState === "COMPLETION",
        mistakePatterns: eventMistakes,
        tutoringState: eventTutoringState,
      })
    );
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function enhanceHomeworkImageDataUrl(
    file: File,
    cropRegion?: CropRegion | null
  ) {
    if (!file.type.startsWith("image/")) {
      return readFileAsDataUrl(file);
    }

    const sourceUrl = URL.createObjectURL(file);

    try {
      const image = await loadImage(sourceUrl);
      const crop = getImageCropBox(image, cropRegion);
      const longestSide = Math.max(crop.width, crop.height);
      const upscaleFactor = longestSide < 1400 ? 1400 / longestSide : 1;
      const scale = Math.min(2.25, upscaleFactor);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(crop.width * scale);
      canvas.height = Math.round(crop.height * scale);

      const context = canvas.getContext("2d");
      if (!context) {
        return readFileAsDataUrl(file);
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.filter = "grayscale(1) contrast(1.22) brightness(1.04)";
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
      context.filter = "none";
      sharpenCanvas(context, canvas.width, canvas.height);

      return await canvasToDataUrl(canvas);
    } catch (error) {
      console.warn("Image enhancement failed, using original upload.", error);
      return readFileAsDataUrl(file);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  function loadImage(sourceUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image could not be loaded."));
      image.src = sourceUrl;
    });
  }

  function getImageCropBox(
    image: HTMLImageElement,
    cropRegion?: CropRegion | null
  ) {
    if (!cropRegion) {
      return {
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    }

    const paddingPercent = 3;
    const xPercent = clampPercent(cropRegion.x - paddingPercent);
    const yPercent = clampPercent(cropRegion.y - paddingPercent);
    const rightPercent = clampPercent(
      cropRegion.x + cropRegion.width + paddingPercent
    );
    const bottomPercent = clampPercent(
      cropRegion.y + cropRegion.height + paddingPercent
    );

    return {
      x: Math.round((xPercent / 100) * image.naturalWidth),
      y: Math.round((yPercent / 100) * image.naturalHeight),
      width: Math.max(
        1,
        Math.round(((rightPercent - xPercent) / 100) * image.naturalWidth)
      ),
      height: Math.max(
        1,
        Math.round(((bottomPercent - yPercent) / 100) * image.naturalHeight)
      ),
    };
  }

  function sharpenCanvas(
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ) {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const average = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const boosted = average > 184 ? Math.min(255, average + 18) : average * 0.9;
      pixels[index] = boosted;
      pixels[index + 1] = boosted;
      pixels[index + 2] = boosted;
    }

    context.putImageData(imageData, 0, 0);
  }

  function canvasToDataUrl(canvas: HTMLCanvasElement) {
    return new Promise<string>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(canvas.toDataURL("image/jpeg", 0.92));
            return;
          }

          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        0.92
      );
    });
  }

  async function analyzeUploadedHomework(
    file: File,
    fileDataUrl: string,
    cropRegion?: CropRegion | null,
    targetPrompt?: string,
    mode: "extract" | "targeted_tutoring" = "extract"
  ) {
    const authHeaders = await getAuthHeaders();
    const response = await fetchWithTimeout(
      "/api/analyze-homework",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          fileDataUrl,
          mode,
          targetPrompt,
          cropRegion,
          sessionId,
          learningProfile,
          conversationHistory: messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      },
      "I’m taking longer than usual to read that image. Try again in a moment, or crop the specific problem you want help with."
    );
    const data = (await response.json()) as HomeworkAnalysisResponse;

    if (response.status === 403) {
      if (!isLoggedIn && typeof data.used === "number") {
        setInteractions(Math.min(data.used, data.limit ?? DEMO_LIMIT));
      }
      showServerLimitMessage(data.message);
      return null;
    }

    if (!response.ok) {
      throw new Error(data.message || "StepWise could not analyze the upload.");
    }

    return data;
  }

  function buildWorksheetContext(
    file: File,
    analysis: HomeworkAnalysisResponse,
    targetPrompt = ""
  ): WorksheetContext {
    return {
      fileName: file.name,
      fileType: file.type,
      visualSummary: analysis.visualSummary ?? "",
      currentProblem: analysis.currentProblem ?? "",
      problems: analysis.problems ?? [],
      lastTargetPrompt: targetPrompt,
      updatedAt: new Date().toISOString(),
    };
  }

  function updateActiveWorksheetContext(
    file: File,
    analysis: HomeworkAnalysisResponse,
    targetPrompt = ""
  ) {
    const incomingContext = buildWorksheetContext(file, analysis, targetPrompt);
    let mergedContext = incomingContext;

    setActiveWorksheetContext((currentContext) => {
      mergedContext = mergeWorksheetContexts(currentContext, incomingContext);
      return mergedContext;
    });

    if (analysis.sessionId) {
      setSessionId(analysis.sessionId);
    }

    return mergedContext;
  }

  function mergeWorksheetContexts(
    currentContext: WorksheetContext | null,
    incomingContext: WorksheetContext
  ): WorksheetContext {
    if (!currentContext) return incomingContext;

    return {
      ...currentContext,
      ...incomingContext,
      visualSummary:
        incomingContext.visualSummary || currentContext.visualSummary || "",
      currentProblem:
        incomingContext.currentProblem || currentContext.currentProblem || "",
      problems: mergeWorksheetProblems(
        currentContext.problems ?? [],
        incomingContext.problems ?? []
      ),
      updatedAt: incomingContext.updatedAt,
    };
  }

  function mergeWorksheetProblems(
    currentProblems: DetectedHomeworkProblem[],
    incomingProblems: DetectedHomeworkProblem[]
  ) {
    const mergedProblems = [...currentProblems];

    for (const incomingProblem of incomingProblems) {
      const existingIndex = mergedProblems.findIndex(
        (currentProblem) =>
          normalizeText(currentProblem.label) === normalizeText(incomingProblem.label) ||
          normalizeText(currentProblem.id) === normalizeText(incomingProblem.id) ||
          normalizeText(currentProblem.extractedText) ===
            normalizeText(incomingProblem.extractedText)
      );

      if (existingIndex >= 0) {
        mergedProblems[existingIndex] = {
          ...mergedProblems[existingIndex],
          ...incomingProblem,
          extractedText:
            incomingProblem.extractedText ||
            mergedProblems[existingIndex].extractedText,
        };
      } else {
        mergedProblems.push(incomingProblem);
      }
    }

    return mergedProblems.slice(0, 20);
  }

  async function handleUploadedFile(file: File) {
    if (!canUseDemo()) return;

    setUploadedFile(file);
    setConfirmedUploadProblem(false);
    setHomeworkAnalysis(null);
    setActiveWorksheetContext(null);
    setSelectedHomeworkProblemId("");
    setEditedExtractedProblem("");
    setCropModeOpen(false);
    setCropDraft(null);
    setShowUploadConfirmation(false);
    setUploadPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      return file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    });
    setIsExtracting(true);
    addMessage(
      "assistant",
      "Got it — I can see the worksheet. Which problem would you like to work on?"
    );

    try {
      const fileDataUrl = await enhanceHomeworkImageDataUrl(file);
      setUploadedFileDataUrl(fileDataUrl);
      const data = await analyzeUploadedHomework(file, fileDataUrl);

      if (data) {
        updateActiveWorksheetContext(file, data);
        setHomeworkAnalysis(data);
        setSelectedHomeworkProblemId(data.problems?.[0]?.id ?? "");
        setEditedExtractedProblem(data.problems?.[0]?.extractedText ?? "");
        setShowUploadConfirmation(false);
        syncInteractionUsage(data);
      }
    } catch (error) {
      console.error(error);
      addMessage(
        "assistant",
        "I had trouble reading that upload. Try a clearer screenshot, or paste one problem here and I’ll help step by step."
      );
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleAnalyzeSelectedArea() {
    if (!uploadedFile || !uploadedFileDataUrl || !cropDraft || !canUseDemo()) {
      return;
    }

    setIsExtracting(true);

    try {
      const cropRegion = normalizeCropRegion(cropDraft);
      const croppedFileDataUrl = await enhanceHomeworkImageDataUrl(
        uploadedFile,
        cropRegion
      );
      const data = await analyzeUploadedHomework(
        uploadedFile,
        croppedFileDataUrl,
        cropRegion
      );

      if (!data) return;

      updateActiveWorksheetContext(uploadedFile, data);
      setHomeworkAnalysis(data);
      setSelectedHomeworkProblemId(data.problems?.[0]?.id ?? "");
      setEditedExtractedProblem(data.problems?.[0]?.extractedText ?? "");
      setCropModeOpen(false);
      addMessage(
        "assistant",
        data.message ||
          "I re-read the selected area. Please confirm the extracted problem before we start."
      );
      syncInteractionUsage(data);
    } catch (error) {
      console.error(error);
      addMessage(
        "assistant",
        getFriendlyClientError(
          error,
          "I had trouble reading that selected area. Try a tighter crop or paste the problem text."
        )
      );
    } finally {
      setIsExtracting(false);
    }
  }

  function handleSelectDetectedProblem(detectedProblem: DetectedHomeworkProblem) {
    setSelectedHomeworkProblemId(detectedProblem.id);
    setEditedExtractedProblem(detectedProblem.extractedText);
  }

  function handleConfirmDetectedProblem() {
    const confirmedProblem = editedExtractedProblem.trim();

    if (!confirmedProblem) return;

    setCurrentProblem(confirmedProblem);
    setProblem(confirmedProblem);
    setActiveWorksheetContext((currentContext) =>
      currentContext
        ? {
            ...currentContext,
            currentProblem: confirmedProblem,
          }
        : currentContext
    );
    setConfirmedUploadProblem(true);
    setHomeworkAnalysis(null);
    addMessage("user", `I want help with this problem: ${confirmedProblem}`);
    void requestTutorHelp(
      "general",
      `The student confirmed this uploaded problem: ${confirmedProblem}. Start tutoring by briefly orienting them to the problem type, naming the next goal, explaining why that goal matters, then asking one focused question. Do not solve it immediately.`
    );
  }

  async function handleUploadedHomeworkQuestion(studentMessage: string) {
    if (
      !uploadedFile ||
      !uploadedFileDataUrl ||
      isTutorRequestPending ||
      !canUseDemo()
    ) {
      return;
    }

    setIsTutorRequestPending(true);
    const thinkingTimer = showThinkingAfterDelay("Reading the uploaded problem...");

    try {
      const data = await analyzeUploadedHomework(
        uploadedFile,
        uploadedFileDataUrl,
        null,
        studentMessage,
        "targeted_tutoring"
      );

      if (!data) return;

      updateActiveWorksheetContext(uploadedFile, data, studentMessage);
      const extractedProblem = data.currentProblem?.trim();
      const shouldAskClarifyingQuestion =
        data.needsUserSelection || !extractedProblem || (data.confidence ?? 0) < 0.68;

      if (shouldAskClarifyingQuestion) {
        setHomeworkAnalysis(data);
        setSelectedHomeworkProblemId(data.problems?.[0]?.id ?? "");
        setEditedExtractedProblem(extractedProblem || data.problems?.[0]?.extractedText || "");
        setShowUploadConfirmation(false);
        addMessage(
          "assistant",
          data.message ||
            "I see the upload, but I’m not fully sure which problem you mean. Which number or area should we work on?"
        );
        return;
      }

      setCurrentProblem(extractedProblem);
      setProblem(extractedProblem);
      setConfirmedUploadProblem(true);
      setHomeworkAnalysis(null);
      setShowUploadConfirmation(false);
      const tutorMessage =
        data.message ||
        `I found it: ${extractedProblem}. Let’s work through it one step at a time. What do you notice first?`;

      addMessage("assistant", tutorMessage);
      rememberLearningEvent("general", studentMessage, extractedProblem, tutorMessage);
      setLastTutorMode("general");
      syncInteractionUsage(data);
    } catch (error) {
      console.error(error);
      addMessage(
        "assistant",
        getFriendlyClientError(
          error,
          "I had trouble reading that specific problem. Could you say the problem number again, crop the area, or paste the problem text?"
        )
      );
    } finally {
      window.clearTimeout(thinkingTimer);
      setIsTutorRequestPending(false);
      setIsThinking(false);
    }
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    const region = getPointerRegion(event);

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsCropDragging(true);
    setCropDraft({
      ...region,
      width: 0,
      height: 0,
      startX: region.x,
      startY: region.y,
    });
  }

  function handleCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!cropDraft || !isCropDragging) return;

    const region = getPointerRegion(event);

    setCropDraft({
      ...cropDraft,
      x: Math.min(cropDraft.startX, region.x),
      y: Math.min(cropDraft.startY, region.y),
      width: Math.abs(region.x - cropDraft.startX),
      height: Math.abs(region.y - cropDraft.startY),
    });
  }

  function handleCropPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsCropDragging(false);
  }

  function getPointerRegion(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();

    return {
      x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100),
      width: 0,
      height: 0,
    };
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      void handleUploadedFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsComposerDragActive(false);

    const file = event.dataTransfer.files[0];

    if (file) {
      void handleUploadedFile(file);
    }
  }

  function handleComposerDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isComposerDragActive) {
      setIsComposerDragActive(true);
    }
  }

  function handleComposerDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsComposerDragActive(false);
    }
  }

  function resolveWorksheetProblemReference(
    studentMessage: string,
    worksheetContext: WorksheetContext | null,
    activeProblem: string
  ) {
    const problems = worksheetContext?.problems ?? [];
    if (!problems.length) return null;

    const numberMatch =
      studentMessage.match(/#\s*(\d+[a-z]?)/i) ||
      studentMessage.match(/\b(?:problem|number|question)\s*(\d+[a-z]?)\b/i);
    const requestedNumber = numberMatch?.[1]?.toLowerCase();

    if (requestedNumber) {
      return (
        problems.find((detectedProblem) =>
          [
            detectedProblem.label,
            detectedProblem.id,
            detectedProblem.extractedText,
          ].some((value) =>
            new RegExp(
              `(?:^|[^0-9a-z])#?${escapeRegExp(requestedNumber)}(?:[^0-9a-z]|$)`,
              "i"
            ).test(value)
          )
        ) ??
        findProblemByInferredWorksheetNumber(problems, requestedNumber)
      );
    }

    if (
      /\bnext (?:one|problem|question)\b|\bwhat about the next\b/i.test(
        studentMessage
      )
    ) {
      const currentIndex = activeProblem
        ? problems.findIndex(
            (detectedProblem) =>
              normalizeText(detectedProblemText(detectedProblem)) ===
                normalizeText(activeProblem) ||
              normalizeText(activeProblem).includes(
                normalizeText(detectedProblemText(detectedProblem)).slice(0, 80)
              )
          )
        : -1;

      return problems[Math.min(currentIndex + 1, problems.length - 1)] ?? null;
    }

    return null;
  }

  function detectedProblemText(problem: DetectedHomeworkProblem) {
    return problem.extractedText;
  }

  function findProblemByInferredWorksheetNumber(
    problems: DetectedHomeworkProblem[],
    requestedNumber: string
  ) {
    const requestedNumeric = Number.parseInt(requestedNumber, 10);
    if (!Number.isFinite(requestedNumeric)) return null;

    const firstKnownIndex = problems.findIndex((problem) =>
      Boolean(getProblemNumber(problem))
    );
    const firstKnownNumber =
      firstKnownIndex >= 0 ? getProblemNumber(problems[firstKnownIndex]) : null;

    if (!firstKnownNumber) return null;

    const inferredIndex = firstKnownIndex + requestedNumeric - firstKnownNumber;
    return problems[inferredIndex] ?? null;
  }

  function getProblemNumber(problem: DetectedHomeworkProblem) {
    const match = [problem.label, problem.id, problem.extractedText]
      .join(" ")
      .match(/(?:^|[^0-9])#?(\d+)[a-z]?(?:[^0-9]|$)/i);

    return match ? Number.parseInt(match[1], 10) : null;
  }

  function normalizeText(text: string) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getCheckpointKey(
    recommendation: NonNullable<typeof learningRecommendation>
  ) {
    return [
      recommendation.topic,
      recommendation.difficulty,
      recommendation.suggestedNext,
      ...recommendation.skills,
    ].join("|");
  }

  async function requestTutorHelp(
    mode: HelpMode,
    studentMessage: string,
    options: PracticeOptions = {}
  ) {
    if (isThinking || isTutorRequestPending || !canUseDemo()) return;

    const referencedWorksheetProblem = resolveWorksheetProblemReference(
      studentMessage,
      activeWorksheetContext,
      currentProblem.trim() || problem.trim()
    );
    const effectiveCurrentProblem =
      referencedWorksheetProblem?.extractedText ||
      currentProblem.trim() ||
      problem.trim() ||
      activeWorksheetContext?.currentProblem?.trim() ||
      activeWorksheetContext?.problems?.[0]?.extractedText?.trim() ||
      studentMessage.trim();

    if (
      referencedWorksheetProblem?.extractedText &&
      referencedWorksheetProblem.extractedText !== currentProblem.trim()
    ) {
      setCurrentProblem(referencedWorksheetProblem.extractedText);
      setProblem(referencedWorksheetProblem.extractedText);
      setActiveWorksheetContext((currentContext) =>
        currentContext
          ? {
              ...currentContext,
              currentProblem: referencedWorksheetProblem.extractedText,
            }
          : currentContext
      );
    }

    setIsTutorRequestPending(true);
    const thinkingTimer = showThinkingAfterDelay(getThinkingLabel(mode, options));

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetchWithTimeout(
        "/api/demo-help",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            problem,
            currentProblem: effectiveCurrentProblem,
            message: studentMessage,
            mode,
            sessionId,
            worksheetContext: activeWorksheetContext,
            ...options,
            learningProfile,
            tutoringSignals: {
              ...currentTutoringSignals,
              activeConfusionSignal:
                currentTutoringSignals.activeConfusionSignal ||
                /i don't know|idk|stuck|confused|lost|not sure|don't get|no idea|help/i.test(
                  studentMessage
                ),
              completionSignal:
                currentTutoringSignals.completionSignal ||
                /solved|finished|done|got it|answer is|i got|final answer|therefore/i.test(
                  studentMessage
                ) || /(?:so|therefore)\s+[a-z]\s*=/i.test(studentMessage),
              fullAttemptSignal:
                currentTutoringSignals.fullAttemptSignal ||
                hasFullAttemptSignal(studentMessage),
              answerCheckSignal:
                currentTutoringSignals.answerCheckSignal ||
                hasAnswerCheckIntent(studentMessage),
              confidentAttemptSignal:
                currentTutoringSignals.confidentAttemptSignal ||
                /i got|i think|final answer|answer is|is this right|does this work/i.test(
                  studentMessage
                ),
              requestedPracticeSignal:
                currentTutoringSignals.requestedPracticeSignal ||
                /practice|another|similar|harder|easier|review|next problem/i.test(
                  studentMessage
                ),
            },
            conversationHistory: [
              ...messages,
              ...(studentMessage.trim()
                ? [{ role: "user" as const, content: studentMessage }]
                : []),
            ].map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        },
        "I’m taking longer than usual to think through this problem. Try sending the message again in a moment."
      );

      const data = (await response.json()) as TutorHelpResponse;

      if (response.status === 403) {
        if (!isLoggedIn && typeof data.used === "number") {
          setInteractions(Math.min(data.used, data.limit ?? DEMO_LIMIT));
        }
        showServerLimitMessage(data.message);
        return;
      }

      if (!response.ok) {
        throw new Error(data.message || "StepWise could not respond.");
      }

      const tutorMessage =
        data.message ||
        "I can help, but I need a little more detail first. What have you tried?";

      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      addMessage("assistant", tutorMessage);
      rememberLearningEvent(mode, studentMessage, undefined, tutorMessage);
      setLastTutorMode(mode);
      syncInteractionUsage(data);
      if (isLoggedIn) {
        void loadConversationHistory();
      }
      setHintMenuOpen(false);
    } catch (error) {
      console.error(error);
      addMessage(
        "assistant",
        getFriendlyClientError(
          error,
          "I hit a temporary issue while generating the explanation. Try sending the message again."
        )
      );
    } finally {
      window.clearTimeout(thinkingTimer);
      setIsTutorRequestPending(false);
      setIsThinking(false);
    }
  }

  function handleHint(level: HintLevel = "tiny") {
    setHintRequests((currentCount) => currentCount + 1);
    setHintMenuOpen(false);

    if (!currentProblem.trim() && problem.trim()) {
      setCurrentProblem(problem.trim());
    }

    if (!problem.trim()) {
      void requestTutorHelp("hint", "I need help getting started.", {
        hintLevel: level,
      });
      return;
    }

    const selectedHint = hintOptions.find((hint) => hint.level === level);
    const hintPrompt = attempt.trim()
      ? `${selectedHint?.prompt ?? "Give me a hint"} My current thought is: ${attempt}`
      : selectedHint?.prompt ?? "Give me a hint.";

    void requestTutorHelp("hint", hintPrompt, {
      hintLevel: level,
    });
  }

  function handleCheck() {
    const trimmedAttempt = attempt.trim();

    if (!trimmedAttempt) {
      void requestTutorHelp(
        "general",
        "I want to check my work, but I have not typed my attempt yet."
      );
      return;
    }

    const hasEnoughReasoning = trimmedAttempt.length >= 12;

    if (!currentProblem.trim() && problem.trim()) {
      setCurrentProblem(problem.trim());
    } else if (!currentProblem.trim()) {
      setCurrentProblem(trimmedAttempt);
    }

    setAttemptCount((currentCount) => currentCount + 1);
    addMessage("user", trimmedAttempt);

    if (!hasEnoughReasoning) {
      setIncorrectAttempts((currentCount) => currentCount + 1);
    }

    void requestTutorHelp("check_work", trimmedAttempt);
    setAttempt("");
  }

  function handleGenerateSimilarPractice() {
    if (
      !practicePickerOpen &&
      practiceState === "checkpoint" &&
      shouldShowRecommendation &&
      learningRecommendation
    ) {
      const recommendedTopic = practiceTopics.includes(learningRecommendation.topic)
        ? learningRecommendation.topic
        : selectedPracticeTopic;

      setSelectedPracticeTopic(recommendedTopic);
      setSelectedPracticeDifficulty(learningRecommendation.difficulty);
      setSelectedPracticeStyle(
        availablePracticeStyles.includes(learningRecommendation.style)
          ? learningRecommendation.style
          : "Reinforce Weak Areas"
      );
    }

    if (!practicePickerOpen && hasLearningContext) {
      const detectedTopic = practiceTopics.includes(detectedFocus.subject)
        ? detectedFocus.subject
        : selectedPracticeTopic;

      setSelectedPracticeTopic(detectedTopic);
    }

    setPracticePickerOpen((isOpen) => !isOpen);
  }

  function handlePracticeGenerate() {
    if (isThinking || !canUseDemo()) return;

    if (!currentProblem.trim() && problem.trim()) {
      setCurrentProblem(problem.trim());
    }

    const topic = hasLearningContext
      ? selectedPracticeTopic || detectedFocus.subject
      : selectedPracticeTopic;
    const focus = selectedPracticeFocus.trim();
    const goal = [practiceGoal.trim() || topic, focus].filter(Boolean).join(" with focus on ");
    const memoryContext = [
      learningProfile.spacedReviewQueue[0]
        ? `spaced review: ${learningProfile.spacedReviewQueue[0]}`
        : "",
      learningProfile.problemHistory[0]?.problemType
        ? `recent pattern: ${learningProfile.problemHistory[0].problemType}`
        : "",
      learningProfile.formulaConfusions[0]
        ? `formula support: ${learningProfile.formulaConfusions[0]}`
        : "",
      learningProfile.independenceLevel
        ? `independence: ${learningProfile.independenceLevel}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    const message =
      practiceState === "starter"
        ? `I want to study ${goal || topic}. Use ${selectedPracticeStyle.toLowerCase()} at a ${selectedPracticeDifficulty.toLowerCase()} level. Ask one setup question if you need clarification, otherwise start with a short guided prompt.`
        : practiceState === "checkpoint"
          ? `Generate ${selectedPracticeStyle.toLowerCase()} based on my tutoring progress and the skills I just practiced. Use my learning memory if helpful: ${memoryContext || "no strong memory signal yet"}.`
          : `Help me stay focused on the current problem using ${selectedPracticeStyle.toLowerCase()}. Do not introduce a new problem or recommend what to do after this.`;

    setPracticeContext(
      `${goal || topic} ${selectedPracticeDifficulty} ${selectedPracticeStyle}`
    );
    setPracticePickerOpen(false);
    addMessage("user", message);
    void requestTutorHelp(
      practiceState === "active" ? "general" : "generate_practice",
      message,
      {
        practiceTopic: topic,
        practiceDifficulty: selectedPracticeDifficulty,
        practiceType: selectedPracticeStyle,
      }
    );
  }

  function handleRecommendedPractice() {
    if (!learningRecommendation || isThinking || !canUseDemo()) return;

    if (!currentProblem.trim() && problem.trim()) {
      setCurrentProblem(problem.trim());
    }

    const topic = practiceTopics.includes(learningRecommendation.topic)
      ? learningRecommendation.topic
      : "Algebra";
    const checkpointKey = getCheckpointKey(learningRecommendation);
    const message = [
      "Structured app action: practice_this.",
      `Checkpoint skill: ${learningRecommendation.skills.join(", ")}.`,
      `Topic: ${topic}.`,
      `Difficulty: ${learningRecommendation.difficulty}.`,
      `Practice style: ${learningRecommendation.style}.`,
      `Source session: ${sessionId}.`,
      "Generate one targeted practice problem now. Do not validate this request. Do not say it is correct. Do not show another checkpoint card.",
    ].join(" ");

    setCheckpointPracticeState("generating");
    setUsedCheckpointKey(checkpointKey);
    setSelectedPracticeTopic(topic);
    setSelectedPracticeDifficulty(learningRecommendation.difficulty);
    setSelectedPracticeStyle(
      checkpointPracticeStyles.includes(learningRecommendation.style)
        ? learningRecommendation.style
        : "Reinforce Weak Areas"
    );
    setPracticeContext(
      `${topic} ${learningRecommendation.difficulty} ${learningRecommendation.style} ${learningRecommendation.skills.join(
        " "
      )}`
    );
    setPracticePickerOpen(false);
    void requestTutorHelp("generate_practice", message, {
      practiceTopic: topic,
      practiceDifficulty: learningRecommendation.difficulty,
      practiceType: learningRecommendation.style,
    }).finally(() => {
      setCheckpointPracticeState("practice_started");
    });
  }

  function handleSendMessage() {
    const trimmedAttempt = attempt.trim();

    if (!trimmedAttempt) {
      addMessage(
        "assistant",
        "I’m not fully sure what you want help with yet. Try sending the problem number, question, or screenshot."
      );
      return;
    }

    if (
      uploadedFile &&
      uploadedFileDataUrl &&
      !confirmedUploadProblem &&
      !activeWorksheetContext
    ) {
      addMessage("user", trimmedAttempt);
      setAttempt("");
      void handleUploadedHomeworkQuestion(trimmedAttempt);
      return;
    }

    if (!currentProblem.trim() && !problem.trim()) {
      setCurrentProblem(trimmedAttempt);
    } else if (!currentProblem.trim() && problem.trim()) {
      setCurrentProblem(problem.trim());
    }

    addMessage("user", trimmedAttempt);
    const shouldCheckAnswer =
      hasAnswerCheckIntent(trimmedAttempt) ||
      ((Boolean(currentProblem.trim()) || Boolean(problem.trim())) &&
        hasFullAttemptSignal(trimmedAttempt));

    if (shouldCheckAnswer) {
      setAttemptCount((currentCount) => currentCount + 1);
    }

    void requestTutorHelp(
      shouldCheckAnswer ? "check_work" : "general",
      trimmedAttempt
    );
    setAttempt("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    handleSendMessage();
  }

  return (
    <main className="min-h-screen bg-[#f7fafc] text-slate-900">
      <nav className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="StepWise home">
          <BrandLogo className="text-xl" />
        </Link>

        <AccountMenu />
      </nav>

      <section className="grid min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[220px_1fr] lg:overflow-hidden">
        <aside className="border-b border-slate-200 bg-white px-5 py-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Detected Focus
            </p>
            <div className="mt-3 rounded-3xl bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Subject</span>
                <span className="font-semibold text-slate-900">
                  {displaySubject}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {waitingForProblem ? (
                  emptyFocusHints.map((hint) => (
                    <span
                      key={hint}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm"
                    >
                      {hint}
                    </span>
                  ))
                ) : (
                  detectedFocus.skills.map((area) => (
                    <span
                      key={area}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
                    >
                      {area}
                    </span>
                  ))
                )}
              </div>

              {!waitingForProblem && learningRecommendation && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Session focus
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {shouldShowRecommendation
                      ? learningRecommendation.suggestedNext
                      : `Focus: ${detectedFocus.skills
                          .slice(0, 2)
                          .join(" + ")}. Work through this one step at a time.`}
                  </p>
                </div>
              )}

              {needsReasoningPractice && (
                <p className="mt-4 text-xs leading-5 text-amber-800">
                  Slow down here: explain why the next step works before moving
                  ahead.
                </p>
              )}
            </div>
          </div>

          <div className="mt-8">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Learning Memory
            </p>
            <div className="mt-3 rounded-3xl bg-slate-50 p-4 text-sm">
              <p className="text-xs leading-5 text-slate-500">
                {learningProfile.recentConcepts.length > 0
                  ? "StepWise is adapting to your recent work."
                  : "Your tutor adapts as you solve."}
              </p>

              {learningProfile.recentConcepts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {learningProfile.recentConcepts.slice(0, 3).map((concept) => (
                    <span
                      key={concept}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              )}

              {!waitingForProblem && (
                <div className="mt-3 grid gap-2 text-xs">
                  <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                    <span className="font-semibold text-slate-700">
                      Tutoring state
                    </span>
                    <p className="mt-0.5 text-slate-500">
                      {activeTutoringState
                        .toLowerCase()
                        .replace("_", " ")}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                    <span className="font-semibold text-slate-700">
                      Pacing
                    </span>
                    <p className="mt-0.5 text-slate-500">
                      {activePacingLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                    <span className="font-semibold text-slate-700">
                      Independence
                    </span>
                    <p className="mt-0.5 text-slate-500">
                      {learningProfile.independenceLevel.replace("_", " ")}
                    </p>
                  </div>
                </div>
              )}

              <p className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs leading-5 text-slate-600 shadow-sm">
                {adaptiveMemoryMessage}
              </p>

              {learningProfile.spacedReviewQueue.length > 0 && (
                <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs shadow-sm">
                  <span className="font-semibold text-slate-700">
                    Review soon
                  </span>
                  <p className="mt-1 leading-5 text-slate-500">
                    {learningProfile.spacedReviewQueue.slice(0, 2).join(" + ")}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Recent Chats
              </p>
              {isLoggedIn && (
                <button
                  onClick={() => void loadConversationHistory()}
                  disabled={isLoadingHistory}
                  className="text-xs font-semibold text-cyan-700 hover:text-cyan-800 disabled:text-slate-400"
                >
                  Refresh
                </button>
              )}
            </div>

            <div className="mt-3 rounded-3xl bg-slate-50 p-3 text-sm">
              {isLoggedIn ? (
                <>
                  <button
                    onClick={startNewConversation}
                    className="w-full rounded-2xl bg-white px-3 py-2.5 text-left text-xs font-semibold text-cyan-800 shadow-sm transition hover:bg-cyan-50"
                  >
                    Start a new tutoring chat
                  </button>

                  <div className="mt-2 space-y-1.5">
                    {isLoadingHistory ? (
                      <p className="rounded-2xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
                        Loading recent chats...
                      </p>
                    ) : historyMessage ? (
                      <p className="rounded-2xl bg-white px-3 py-2 text-xs leading-5 text-slate-500 shadow-sm">
                        {historyMessage}
                      </p>
                    ) : conversationHistory.length ? (
                      conversationHistory.slice(0, 5).map((conversation) => (
                        <button
                          key={conversation.id}
                          onClick={() => void loadConversation(conversation.id)}
                          className={`w-full rounded-2xl px-3 py-2 text-left transition ${
                            conversation.id === sessionId
                              ? "bg-cyan-50 text-cyan-900 ring-1 ring-cyan-100"
                              : "bg-white text-slate-700 shadow-sm hover:bg-cyan-50 hover:text-cyan-800"
                          }`}
                        >
                          <span className="line-clamp-2 text-xs font-semibold leading-5">
                            {getConversationTitle(conversation)}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                            {getConversationMeta(conversation)}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="rounded-2xl bg-white px-3 py-2 text-xs leading-5 text-slate-500 shadow-sm">
                        Your saved tutoring chats will appear here after you send
                        a message.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="rounded-2xl bg-white px-3 py-2 text-xs leading-5 text-slate-500 shadow-sm">
                  Sign in to save and revisit tutoring chats.
                </p>
              )}
            </div>
          </div>

          <div className="mt-8">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Progress
            </p>
            <div className="mt-3 space-y-2 rounded-3xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Steps completed</span>
                <span className="font-semibold text-slate-900">
                  {stepsCompleted}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Reasoning checks</span>
                <span className="font-semibold text-slate-900">
                  {reasoningChecksPassed}/{attemptCount}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Skills practiced</span>
                <span className="font-semibold text-slate-900">
                  {skillsPracticed}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Problems completed</span>
                <span className="font-semibold text-slate-900">
                  {learningProfile.completedProblems}
                </span>
              </div>
              {!isLoggedIn && (
                <div className="flex justify-between text-slate-500">
                  <span>Demo used</span>
                  <span className="font-semibold text-slate-700">
                    {interactions}/{DEMO_LIMIT}
                  </span>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:overflow-hidden">
          <div className="flex min-h-0 flex-1 px-5 py-3 sm:px-8 lg:px-10">
            <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-col">
              {hasActiveSession && (
                <div className="mb-2.5 shrink-0">
                  <div className="rounded-2xl bg-white/80 px-3.5 py-2.5 shadow-sm ring-1 ring-slate-200">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase text-slate-500">
                          Pinned
                        </span>
                        <p className="truncate text-sm font-medium text-slate-800">
                          {sessionContext}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {detectedFocus.subject}
                        </span>
                        {detectedFocus.skills.slice(0, 2).map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500"
                          >
                            {skill}
                          </span>
                        ))}
                        {uploadedFile && (
                          <span className="max-w-[160px] truncate rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                            {uploadedFile.name}
                          </span>
                        )}
                        {isLoggedIn && (
                          <button
                            onClick={finishCurrentSession}
                            className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-800"
                          >
                            Finish
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="min-h-[260px] flex-1 overflow-y-auto rounded-[1.5rem] bg-white/55 px-3 py-4 sm:px-5 sm:py-5 lg:min-h-0">
                <div className="mx-auto max-w-3xl space-y-3.5">
                  {!hasActiveSession && (
                    <div className="mx-auto max-w-2xl text-center">
                      <p className="text-sm font-semibold text-slate-700">
                        Ready to help you think through the next step.
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Paste a problem, upload homework, or show where your
                        reasoning started to feel uncertain.
                      </p>
                    </div>
                  )}

                  {visibleMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`stepwise-chat-message flex items-start gap-3 ${
                        message.role === "user" ? "justify-end pr-3" : "pl-1"
                      } ${message.id === 1 ? "justify-center pl-0 pr-0" : ""}`}
                    >
                      {message.role === "assistant" && message.id !== 1 && (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">
                          AI
                        </div>
                      )}

                      <div
                        className={`rounded-3xl px-6 py-5 text-base leading-7 shadow-sm ${
                          message.role === "user"
                            ? "max-w-[62%] rounded-tr-md bg-slate-950 px-5 py-3.5 text-white"
                            : message.id === 1
                              ? "max-w-2xl bg-white px-7 py-5 text-center text-slate-800"
                              : "max-w-[72%] rounded-tl-md bg-white px-5 py-4 text-slate-800"
                        } ${
                          message.id === latestAssistantMessageId
                            ? "stepwise-live-response"
                            : ""
                      }`}
                    >
                      <MathMessage content={message.content} />
                    </div>
                  </div>
                ))}

                  {shouldShowRecommendation && learningRecommendation && (
                    <div className="mx-auto flex max-w-2xl flex-col gap-2.5 rounded-2xl bg-white/80 px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
                      <p className="leading-6 text-slate-600">
                        <span className="font-semibold text-slate-900">
                          Checkpoint reached:
                        </span>{" "}
                        {learningRecommendation.suggestedNext}
                      </p>
                      <button
                        onClick={handleRecommendedPractice}
                        disabled={
                          isThinking ||
                          usageLimitReached ||
                          checkpointPracticeState === "generating"
                        }
                        className="shrink-0 rounded-full bg-cyan-50 px-3.5 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {checkpointPracticeState === "generating"
                          ? "Generating..."
                          : "Practice This"}
                      </button>
                    </div>
                  )}

                  {!hasActiveSession && (
                    <div className="mx-auto max-w-2xl rounded-[1.5rem] bg-slate-50 px-5 py-3">
                      <p className="text-sm font-semibold text-slate-700">
                        Try asking
                      </p>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {emptyStatePrompts.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => setAttempt(prompt)}
                            className="rounded-2xl bg-white px-4 py-2 text-left text-sm text-slate-600 shadow-sm hover:text-slate-950"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isThinking && (
                    <div className="flex items-start gap-3 pl-1">
                      <div className="stepwise-thinking-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">
                        AI
                      </div>
                      <div className="rounded-3xl rounded-tl-md bg-white px-5 py-3.5 text-sm text-slate-600 shadow-sm">
                        <span>{thinkingLabel}</span>
                        <span className="stepwise-thinking-dots" aria-hidden="true">
                          ...
                        </span>
                      </div>
                    </div>
                  )}

                  {usageLimitReached && (
                    <div className="mx-auto max-w-xl rounded-[1.75rem] bg-white p-6 text-center text-slate-900 shadow-sm ring-1 ring-slate-200">
                      <p className="text-lg font-semibold text-slate-950">
                        {serverLimitReached
                          ? "Your free tutoring limit is reached for now."
                          : "Create a free account to continue your tutoring session."}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {serverLimitReached
                          ? serverLimitMessage ||
                            "Come back later or create an account to keep your tutoring memory."
                          : "Save homework, upload files, track progress, and keep learning step by step."}
                      </p>
                      <Link
                        href="/login"
                        className="mt-4 inline-block rounded-full bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-400"
                      >
                        {serverLimitReached ? "View Account" : "Create Free Account"}
                      </Link>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-2.5 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-5xl">
              <div
                onDragOver={handleComposerDragOver}
                onDragLeave={handleComposerDragLeave}
                onDrop={handleDrop}
                className={`relative rounded-[1.5rem] border bg-white p-2 shadow-sm shadow-slate-100 transition focus-within:border-cyan-200 focus-within:ring-2 focus-within:ring-cyan-50 ${
                  isComposerDragActive
                    ? "border-cyan-300 ring-4 ring-cyan-100"
                    : "border-slate-200"
                }`}
              >
                {isComposerDragActive && (
                  <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-[1.25rem] bg-cyan-50/90 text-sm font-semibold text-cyan-800 ring-1 ring-cyan-100">
                    Drop your homework here
                  </div>
                )}
                <textarea
                  className="stepwise-input-caret max-h-28 min-h-10 w-full resize-none px-3 py-1.5 text-sm leading-6 text-slate-800 outline-none"
                  placeholder="Type a problem, question, or where you got stuck..."
                  value={attempt}
                  onChange={(event) => setAttempt(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />

                {hintMenuOpen && (
                  <div className="border-t border-slate-100 px-2 py-2">
                    <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                      Guided hints
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {hintOptions.map((hint) => (
                        <button
                          key={hint.level}
                          onClick={() => handleHint(hint.level)}
                          disabled={isThinking || usageLimitReached}
                          className="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                          {hint.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 px-2 pt-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-cyan-50 hover:text-cyan-700 hover:ring-cyan-100">
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={handleFileInput}
                      />
                      <span aria-hidden="true" className="text-base leading-none">
                        +
                      </span>
                      Attach
                    </label>

                    {uploadedFile && (
                      <span className="max-w-[180px] truncate rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-800 sm:max-w-xs">
                        {isExtracting
                          ? "Reading upload..."
                          : confirmedUploadProblem
                            ? `Ready: ${uploadedFile.name}`
                            : uploadedFile.name}
                      </span>
                    )}

                    <p className="text-xs text-slate-500">
                      {isLoggedIn
                        ? "Free account limits apply · Enter to send"
                        : `Free demo: ${interactions}/${DEMO_LIMIT} · Enter to send`}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setHintMenuOpen((isOpen) => !isOpen)}
                      disabled={isThinking || usageLimitReached}
                      className="rounded-full bg-cyan-50 px-3.5 py-1.5 text-sm font-semibold text-cyan-800 transition hover:-translate-y-0.5 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      Hints
                    </button>

                    <button
                      onClick={handleCheck}
                      disabled={isThinking || usageLimitReached}
                      className="rounded-full bg-slate-950 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                    >
                      Check Reasoning
                    </button>

                    <button
                      onClick={handleGenerateSimilarPractice}
                      disabled={isThinking || usageLimitReached}
                      className="rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-500 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      Practice
                    </button>

                    <button
                      onClick={handleSendMessage}
                      disabled={isThinking || usageLimitReached || !attempt.trim()}
                      className="rounded-full bg-cyan-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>

              {usageLimitReached && (
                <div className="mt-3 text-center">
                  <Link
                    href="/login"
                    className="text-sm font-semibold text-cyan-700 hover:text-cyan-800"
                  >
                    {serverLimitReached
                      ? "View account options"
                      : "Create a free account to continue"}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {uploadNeedsConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-base font-semibold text-slate-950">
                  Confirm the problem first
                </p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  StepWise reads the image before tutoring. Choose the problem,
                  edit the text if needed, then confirm so the tutor does not
                  solve the wrong question.
                </p>
              </div>

              <button
                onClick={() => setHomeworkAnalysis(null)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                <div className="rounded-[1.5rem] bg-slate-50 p-3 ring-1 ring-slate-200">
                  {uploadPreviewUrl ? (
                    <div
                      className="relative h-72 overflow-hidden rounded-[1.25rem] bg-white bg-contain bg-center bg-no-repeat ring-1 ring-slate-200"
                      style={{ backgroundImage: `url(${uploadPreviewUrl})` }}
                      onPointerDown={
                        cropModeOpen ? handleCropPointerDown : undefined
                      }
                      onPointerMove={
                        cropModeOpen ? handleCropPointerMove : undefined
                      }
                      onPointerUp={cropModeOpen ? handleCropPointerUp : undefined}
                    >
                      {cropModeOpen && (
                        <div className="absolute inset-0 cursor-crosshair bg-slate-950/10">
                          <div className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                            Drag around one problem
                          </div>
                        </div>
                      )}

                      {cropDraft && (
                        <div
                          className="absolute border-2 border-cyan-400 bg-cyan-400/15"
                          style={{
                            left: `${cropDraft.x}%`,
                            top: `${cropDraft.y}%`,
                            width: `${cropDraft.width}%`,
                            height: `${cropDraft.height}%`,
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="rounded-[1.25rem] bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200">
                      PDF uploaded. For this MVP, upload a screenshot of the
                      specific page or paste the problem text.
                    </div>
                  )}
                </div>

                <div className="rounded-[1.5rem] bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-800">
                      Extraction confidence
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                      {Math.round((homeworkAnalysis?.confidence ?? 0) * 100)}%
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {homeworkAnalysis?.visualSummary ||
                      "StepWise is checking the page layout and visible math."}
                  </p>
                  {homeworkAnalysis?.lowConfidenceReason && (
                    <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      {homeworkAnalysis.lowConfidenceReason}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Detected problems
                  </p>
                  <div className="mt-2 grid gap-2">
                    {homeworkAnalysis?.problems?.length ? (
                      (homeworkAnalysis.problems ?? []).map((detectedProblem) => (
                        <button
                          key={detectedProblem.id}
                          onClick={() =>
                            handleSelectDetectedProblem(detectedProblem)
                          }
                          className={`rounded-2xl px-4 py-3 text-left text-sm transition ${
                            selectedHomeworkProblem?.id === detectedProblem.id
                              ? "bg-cyan-50 text-slate-900 ring-1 ring-cyan-200"
                              : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold">
                              {detectedProblem.label}
                            </span>
                            <span className="text-xs text-slate-500">
                              {Math.round(detectedProblem.confidence * 100)}%
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {detectedProblem.extractedText}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm">
                              {detectedProblem.subject}
                            </span>
                            {detectedProblem.skills.slice(0, 2).map((skill) => (
                              <span
                                key={skill}
                                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                        I’m not fully confident I separated a problem from this
                        image. Crop the exact question or paste it below.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirmed-problem"
                    className="text-xs font-semibold uppercase text-slate-400"
                  >
                    Extracted problem to confirm
                  </label>
                  <textarea
                    id="confirmed-problem"
                    value={editedExtractedProblem}
                    onChange={(event) =>
                      setEditedExtractedProblem(event.target.value)
                    }
                    className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
                    placeholder="Paste or correct the exact problem here..."
                  />
                </div>

                {selectedHomeworkProblem?.visualContext && (
                  <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                    {selectedHomeworkProblem.visualContext}
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setCropModeOpen((isOpen) => !isOpen)}
                      disabled={!uploadPreviewUrl || isExtracting}
                      className="rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {cropModeOpen ? "Cancel Crop" : "Select Different Area"}
                    </button>
                    {cropModeOpen && (
                      <button
                        onClick={handleAnalyzeSelectedArea}
                        disabled={
                          isExtracting ||
                          !cropDraft ||
                          cropDraft.width < 5 ||
                          cropDraft.height < 5
                        }
                        className="rounded-full bg-cyan-50 px-4 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        Analyze Selected Area
                      </button>
                    )}
                  </div>

                  <button
                    onClick={handleConfirmDetectedProblem}
                    disabled={isThinking || isExtracting || !editedExtractedProblem.trim()}
                    className="rounded-full bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-cyan-100 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                  >
                    Correct - Start Tutoring
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {practicePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-4 py-6 backdrop-blur-sm"
          onClick={() => setPracticePickerOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-[2rem] bg-white p-5 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-950">
                  {practiceTitle}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {practiceDescription}
                </p>
              </div>

              <button
                onClick={() => setPracticePickerOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-[1.35rem] bg-slate-50 p-3 ring-1 ring-slate-200/70">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                  {practiceState === "starter"
                    ? "Ready to personalize your practice"
                    : practiceState === "checkpoint"
                      ? "Adaptive practice unlocked"
                      : "Current problem first"}
                </span>
                {practiceState !== "starter" &&
                  detectedFocus.skills.slice(0, 3).map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-cyan-800 shadow-sm"
                    >
                      {skill}
                    </span>
                  ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {practiceState === "starter"
                  ? "StepWise will ask what you want to work on before generating practice."
                  : practiceState === "checkpoint"
                    ? "Practice is now based on what StepWise has seen in this session."
                    : "StepWise will support this step without introducing another problem."}
              </p>
            </div>

            {shouldShowRecommendation && learningRecommendation && (
              <div className="mt-4 rounded-[1.5rem] bg-cyan-50 p-4 ring-1 ring-cyan-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-cyan-700">
                      Recommended for you
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {learningRecommendation.difficulty}{" "}
                      {learningRecommendation.topic} -{" "}
                      {learningRecommendation.skills[0]}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {learningRecommendation.description}
                    </p>
                  </div>

                  <button
                    onClick={handleRecommendedPractice}
                    disabled={
                      isThinking ||
                      usageLimitReached ||
                      checkpointPracticeState === "generating"
                    }
                    className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold text-cyan-800 shadow-sm hover:bg-cyan-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {checkpointPracticeState === "generating"
                      ? "Generating..."
                      : "Use This"}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Difficulty
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {practiceDifficulties.map((difficulty) => (
                    <button
                      key={difficulty}
                      onClick={() => setSelectedPracticeDifficulty(difficulty)}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                        selectedPracticeDifficulty === difficulty
                          ? "bg-slate-950 text-white"
                          : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {difficulty}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {practiceState === "starter"
                    ? "Topic"
                    : "Subject"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(practiceState === "starter"
                    ? practiceTopics
                    : practiceSubjectOptions
                  ).map((topic) => (
                    <button
                      key={topic}
                      onClick={() => {
                        setSelectedPracticeTopic(topic);
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                        selectedPracticeTopic === topic
                          ? "bg-cyan-500 text-white shadow-sm shadow-cyan-100"
                          : "bg-slate-50 text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
                      }`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              {practiceState === "starter" && (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">
                      Optional focus skill
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {availablePracticeFocusSkills.map((skill) => (
                        <button
                          key={skill}
                          onClick={() =>
                            setSelectedPracticeFocus((currentFocus) =>
                              currentFocus === skill ? "" : skill
                            )
                          }
                          className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                            selectedPracticeFocus === skill
                              ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200"
                              : "bg-slate-50 text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
                          }`}
                        >
                          {skill}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="practice-goal"
                      className="text-xs font-semibold uppercase text-slate-400"
                    >
                      Or describe what you&apos;re stuck on
                    </label>
                    <input
                      id="practice-goal"
                      value={practiceGoal}
                      onChange={(event) => setPracticeGoal(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
                      placeholder="I struggle with fractions in equations, SAT quadratics, negatives..."
                    />
                  </div>
                </>
              )}

              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">
                  {practiceState === "starter"
                    ? "How would you like to learn this?"
                    : "Practice style"}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {availablePracticeStyles.map((style) => (
                    <button
                      key={style}
                      onClick={() => setSelectedPracticeStyle(style)}
                      className={`rounded-2xl px-3.5 py-2.5 text-left text-xs font-semibold transition ${
                        selectedPracticeStyle === style
                          ? "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200"
                          : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                {practiceState === "starter"
                  ? "StepWise will use your topic and support style before creating practice."
                  : practiceState === "checkpoint"
                    ? "Practice now follows your progress, mistakes, and confidence."
                    : "Reasoning comes first. Finish this problem before moving ahead."}
              </p>

              <button
                onClick={handlePracticeGenerate}
                disabled={isThinking || usageLimitReached}
                className="rounded-full bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-cyan-100 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {practiceState === "starter"
                  ? "Start Practicing"
                  : practiceState === "checkpoint"
                    ? "Generate Adaptive Practice"
                    : "Support This Step"}
              </button>
            </div>
          </div>
        </div>
      )}

      <HelpFeedbackButton
        context={feedbackContext}
        showNudge={showFeedbackNudge}
        className="bottom-24 right-4 sm:bottom-6 sm:right-6"
      />
    </main>
  );
}
