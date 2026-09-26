import { createTutorStream } from "@/lib/tutorStreamServer";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { LearningProfile } from "@/lib/learningProfile";
import {
  addAnonymousDemoUsageCookie,
  checkAnonymousDemoUsage,
} from "@/lib/anonymousDemoLimit";
import {
  checkUsageLimit,
  createSupabaseServerClient,
  getAuthenticatedUser,
  getBearerToken,
  recordUsageEvent,
} from "@/lib/usageLimits";
import {
  ensureLearningSession,
  recordLearningMemoryEvent,
  retrieveLearningMemory,
} from "@/lib/learningMemory";
import type { UsageEventType } from "@/lib/usageLimits";
import {
  classifyStepwiseTopic,
  getOffTopicRedirect,
} from "@/lib/topicGuardrails";
import {
  deriveHintEscalationLevel,
  deriveTutoringState,
  detectMistakePatterns,
  getHintEscalationInstructions,
  getPacingGuidance,
  getTutoringStateInstructions,
  summarizeLearningMemory,
} from "@/lib/tutoringState";
import type { TutoringSignals, TutoringState } from "@/lib/tutoringState";

type DemoHelpMode =
  | "hint"
  | "check_work"
  | "next_step"
  | "generate_practice"
  | "general";

type TutorIntentMode =
  | "tutoring"
  | "answer_check"
  | "screenshot_reference"
  | "practice"
  | "review"
  | "off_topic"
  | "clarification";

type RoutedTutorIntent = {
  mode: TutorIntentMode;
  effectiveMode: DemoHelpMode;
  reason: string;
};

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type DemoHelpRequest = {
  problem?: string;
  currentProblem?: string;
  message?: string;
  mode?: DemoHelpMode;
  hintLevel?: HintLevel;
  conversationHistory?: ConversationMessage[];
  practiceTopic?: string;
  practiceDifficulty?: string;
  practiceType?: string;
  learningProfile?: LearningProfile;
  tutoringSignals?: TutoringSignals;
  sessionId?: string;
  worksheetContext?: WorksheetContext | null;
};

type HintLevel =
  | "tiny"
  | "bigger"
  | "similar_example"
  | "explain_concept"
  | "reveal_next_step";

type AnswerEvaluationVerdict =
  | "correct"
  | "partially_correct"
  | "incorrect"
  | "ambiguous";

type AnswerEvaluation = {
  verdict: AnswerEvaluationVerdict;
  explanation: string;
  correctPieces: string[];
  incorrectPieces: string[];
  confidence: number;
  nextAction: string;
};

type WorksheetProblem = {
  id: string;
  label: string;
  extractedText: string;
  confidence?: number;
  subject?: string;
  skills?: string[];
  regionHint?: string;
  visualContext?: string;
  needsConfirmation?: boolean;
};

type WorksheetContext = {
  fileName?: string;
  fileType?: string;
  visualSummary?: string;
  currentProblem?: string;
  problems?: WorksheetProblem[];
  lastTargetPrompt?: string;
  updatedAt?: string;
};

const modeInstructions: Record<DemoHelpMode, string> = {
  hint:
    "Give one small hint only. Do not solve the whole problem. Make the next move feel doable, then ask the student to try it.",
  check_work:
    "Answer-checking mode. First evaluate the student's submitted answer or work. If correct, clearly confirm and briefly explain why. If partially correct, name what is right and isolate the first issue. If incorrect, identify the likely misconception and only then guide the weak step.",
  next_step:
    "Explain only the next step. Keep it short, avoid a full worked solution, and ask the student to try that step before continuing.",
  generate_practice:
    "Generate one targeted practice problem immediately. Do not validate the request, do not say it is correct, and do not show a checkpoint. Include the problem, a short skill note, and one first-step question.",
  general:
    "Respond like a tutor. Infer the student's intent, keep it concise, and guide them toward reasoning instead of giving away the full answer.",
};

const hintInstructions: Record<HintLevel, string> = {
  tiny:
    "Tiny Hint: give the smallest possible nudge. Ask one question. Do not reveal the next step directly.",
  bigger:
    "Bigger Hint: make the next move clearer, but still ask the student to do it.",
  similar_example:
    "Similar Example: show a very small parallel example with different numbers, then return to the student's problem with a question. Do not solve the student's problem.",
  explain_concept:
    "Explain Concept: briefly explain the underlying idea or why the method works, then ask the student to apply it.",
  reveal_next_step:
    "Reveal Next Step: reveal only the next single step, not the full solution. Then ask the student what the expression/equation becomes.",
};

const systemPrompt = `
You are StepWise, a supportive AI tutor. Teach reasoning, confidence, and transferable problem-solving habits \u2014 not answers.

Brevity and voice:
- Stay within homework, studying, academic subjects, test prep, writing, worksheets, and learning practice.
- Keep responses short: 2-4 sentences or a few compact bullets. Early responses should be 30-50% shorter than a typical AI explanation.
- Use natural spoken phrasing; cut words that don't change meaning. Prefer "What's halfway between -2 and 1?" over formal restatements.
- Avoid textbook definitions, formal derivations, and abstract explanations unless the student asks.
- Skip transition filler ("this will help us determine", "the next goal is to"). Once context is established, don't restate the problem or givens unless correcting confusion.
- Use LaTeX for math: inline \\( ... \\), display $$ ... $$.

One idea at a time:
- Reveal one important idea per response; never stack concepts before the student responds.
- The student should participate within the first 1-3 sentences: quick acknowledgement, one immediate goal, one focused question.
- Ask about one exact piece at a time with an obvious expected action. Replace broad prompts ("What should we do first?") with concrete ones ("What should we replace h with?").
- Never ask multiple questions at once. Don't quiz memory early ("Do you know the formula?") \u2014 give the structure first, then ask the student to apply one piece.
- Formula scaffolding: if the student seems confident, lightly prompt one recall piece; if unsure or early, give the formula then ask them to plug in one value; if they forgot or are confused, give the formula calmly and help plug in values. Never shame forgetting.
- As shared context builds, each response should feel sharper and lighter. Don't re-explain the whole problem to fix one step.

Momentum:
- Build small loops: validate, nudge, ask the student to try the next step.
- If stuck or confused: slow down, simplify, give a tiny first step, ask one easier question. If they say "I don't get this", ask which part is unclear before explaining.
- If close: don't restart \u2014 point at the likely issue or next operation only.
- If confident or advanced: be concise, reduce scaffolding, invite independent reasoning.
- If repeatedly struggling: name the misconception gently and use a smaller subproblem. Don't repeat the same explanation.
- Incremental reveal: at most one new step per response. Don't give the full solution unless the student completed the reasoning or explicitly asks (after repeated direct requests, give more direct help with reasoning explained).
- Natural micro-feedback when deserved ("Nice setup", "Good catch"). No exaggerated praise, grades, or analytics language. Vary your openings.

Answer checking (student-led):
- "Is this right?", "I got...", completed equations, or submitted work mean: evaluate their attempt FIRST, before any guided tutoring. Don't restart the problem from the beginning.
- Correct: confirm briefly, one short why, then stop \u2014 optionally offer review or another problem. Never follow a correct answer with a guided question.
- Partially correct: name what's right, isolate the first weak step, guide only that step.
- Incorrect: don't just say "wrong" \u2014 name the likely misconception gently and support that exact step.
- If they ask to check but included no answer or work, ask them to paste it.
- The student can lead; don't make the flow rigid.

Practice:
- When generating practice: one targeted problem, a short skill note, one first-step question. Don't solve it. If no topic is clear, ask one clarifying question instead of guessing.
- For "Mixed format", include a standard problem and a word problem practicing the same skill.
- Reuse prior problem structures with changed numbers or context so reasoning transfers; a spaced-review skill may get a brief natural refresh ("good quick refresh"). If they ask for a recommendation, pick the skill they seem to need next.
- During active solving, don't suggest new topics or harder versions until the current problem shows completion or understanding. If they ask for practice mid-problem, briefly redirect to finish the current step first.
- After completion, at most one gentle, specific observation about progress.

Mistakes:
- Watch for sign errors, distribution mistakes, combining unlike terms, arithmetic slips, setup errors, order of operations. Preserve minus signs exactly ("= -6(y+0.5)" is negative six).

Memory (hidden):
- If memory is insufficient, don't imply knowledge of long-term learning patterns.
- Use learning-profile memory only for pacing, hint size, and mistake awareness \u2014 at most one subtle reference, only when it directly helps the current step.
- Never use tracking language ("you always struggle", "your history shows", "I recorded"). Prefer "Last time this type of setup was tricky."
`;

function getAdaptiveGuidance({
  mode,
  studentMessage,
  learningProfile,
  tutoringSignals,
  hintLevel,
  tutoringState,
  hintEscalationLevel,
}: {
  mode: DemoHelpMode;
  studentMessage: string;
  learningProfile: Partial<LearningProfile>;
  tutoringSignals: TutoringSignals;
  hintLevel?: HintLevel;
  tutoringState: TutoringState;
  hintEscalationLevel: number;
}) {
  const lowerMessage = studentMessage.toLowerCase();
  const answerCheckIntent =
    mode === "check_work" ||
    tutoringSignals.answerCheckSignal ||
    hasAnswerCheckIntent(studentMessage);
  const soundsStuck =
    tutoringSignals.activeConfusionSignal ||
    /i don't know|idk|stuck|confused|lost|not sure|don't get|no idea|help/i.test(
      lowerMessage
    ) ||
    (tutoringSignals.hintRequests ?? 0) >= 2 ||
    learningProfile.confidenceLevel === "building";
  const seemsClose =
    answerCheckIntent ||
    tutoringSignals.completionSignal ||
    tutoringSignals.fullAttemptSignal ||
    tutoringSignals.confidentAttemptSignal ||
    /i got|so .*?=|therefore|is this right|does this work|final answer|answer is|=/.test(lowerMessage);
  const prematurePracticeRequest =
    tutoringSignals.requestedPracticeSignal &&
    !tutoringSignals.completionSignal &&
    mode !== "generate_practice";
  const seemsAdvanced =
    !soundsStuck &&
    !seemsClose &&
    (tutoringSignals.incorrectAttempts ?? 0) === 0 &&
    (tutoringSignals.hintRequests ?? 0) === 0 &&
    ((tutoringSignals.attemptCount ?? 0) >= 1 ||
      learningProfile.difficultyComfortLevel === "ready for challenge");
  const stateInstruction = getTutoringStateInstructions(tutoringState);
  const pacingInstruction = getPacingGuidance({
    state: tutoringState,
    learningProfile,
  });
  const hintEscalationInstruction =
    getHintEscalationInstructions(hintEscalationLevel);
  const memoryInstruction =
    "Memory rule: use the learning memory naturally only if it helps this exact step. Never sound like a report card.";

  if (mode === "generate_practice") {
    return [
      stateInstruction,
      pacingInstruction,
      "Adaptive mode: practice follow-up. Give one relevant practice problem, a brief skill note, and one first-step question. Do not solve it.",
      memoryInstruction,
    ].join("\n");
  }

  if (mode === "hint" && hintLevel) {
    return [
      stateInstruction,
      pacingInstruction,
      hintEscalationInstruction,
      `Adaptive mode: progressive hint. ${hintInstructions[hintLevel]}`,
      memoryInstruction,
    ].join("\n");
  }

  if (prematurePracticeRequest) {
    return [
      stateInstruction,
      pacingInstruction,
      "Adaptive mode: active solving focus. The student is asking to move ahead before finishing. Do not recommend new topics or generate another problem. Briefly say you can do that after this checkpoint, then guide the current next step.",
      memoryInstruction,
    ].join("\n");
  }

  if (answerCheckIntent) {
    return [
      stateInstruction,
      pacingInstruction,
      "Adaptive mode: answer checking first. Evaluate the submitted answer before tutoring. If no answer is included, ask for the answer/current work. If correct, say so immediately, give one brief why, and stop with an optional offer to review or try another. Do not ask a guided question after a correct answer. If partially correct, name what is right and isolate the first issue. If incorrect, name the likely misconception and guide only that weak step. Do not restart from the beginning unless the submitted work shows the setup is missing or wrong.",
      memoryInstruction,
    ].join("\n");
  }

  if (soundsStuck) {
    return [
      stateInstruction,
      pacingInstruction,
      hintEscalationInstruction,
      "Adaptive mode: student may be stuck. Be reassuring and simple. Use a tiny hint, reduce cognitive load, avoid long paragraphs, and ask one easier next-step question.",
      memoryInstruction,
    ].join("\n");
  }

  if (seemsClose) {
    return [
      stateInstruction,
      pacingInstruction,
      "Adaptive mode: evaluate attempt first. The student may be giving a full answer, shortcut, or partial solution. Check it before guiding. If correct, confirm briefly and offer next options. If partially correct, name the good part and isolate the first issue. If incorrect, identify the likely misconception and guide only that weak step.",
      memoryInstruction,
    ].join("\n");
  }

  if (seemsAdvanced) {
    return [
      stateInstruction,
      pacingInstruction,
      "Adaptive mode: student seems ready for more independence. Be concise, ask a reasoning question, and consider a small challenge if it fits.",
      memoryInstruction,
    ].join("\n");
  }

  return [
    stateInstruction,
    pacingInstruction,
    "Adaptive mode: guided tutoring. Keep it conversational, short, and focused on the next reasoning step.",
    memoryInstruction,
  ].join("\n");
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let previousMark = startedAt;
  const mark = (stage: string) => {
    const now = performance.now();
    console.info("Tutor timing", {
      requestId,
      stage,
      durationMs: Math.round(now - previousMark),
      elapsedMs: Math.round(now - startedAt),
    });
    previousMark = now;
  };
  try {
    const body = (await request.json()) as DemoHelpRequest;
    const requestedMode = body.mode ?? "general";

    if (!modeInstructions[requestedMode]) {
      return NextResponse.json(
        { message: "Unsupported tutoring mode." },
        { status: 400 }
      );
    }

    const studentMessage = body.message?.trim() || "No student message provided.";
    const rawProblemContext = [body.problem, body.currentProblem]
      .filter(Boolean)
      .filter(
        (context) =>
          normalizeForTopicGuard(context ?? "") !==
          normalizeForTopicGuard(studentMessage)
      )
      .join("\n");
    const conversationHistory = body.conversationHistory ?? [];
    const topicClassification = classifyStepwiseTopic({
      message: studentMessage,
      problemContext: rawProblemContext,
      conversationHistory: conversationHistory.slice(-6).map((message) => message.content),
      mode: requestedMode,
      practiceTopic: body.practiceTopic,
    });

    if (topicClassification === "OFF_TOPIC") {
      return NextResponse.json({
        message: getOffTopicRedirect(studentMessage),
        topicClassification,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          message:
            "I’m having trouble connecting to the tutor right now. Please try again in a moment.",
        },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 45000,
      maxRetries: 0,
    });
    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);
    mark("authentication");
    const hintLevel = body.hintLevel;
    const practiceTopic = body.practiceTopic?.trim() || "Use the current problem context.";
    const practiceDifficulty = body.practiceDifficulty?.trim() || "Appropriate for the student.";
    const practiceType = body.practiceType?.trim() || "Warm-Up Practice";
    let learningProfile: Partial<LearningProfile> = body.learningProfile ?? {};
    const tutoringSignals = body.tutoringSignals ?? {};
    let persistentMemorySummary =
      "No persistent account memory available for this request.";
    let activeSessionId = body.sessionId;
    let worksheetContext = normalizeWorksheetContext(body.worksheetContext);
    const preliminaryIntent = routeTutorIntent({
      requestedMode,
      studentMessage,
      tutoringSignals,
      worksheetContext,
      referencedWorksheetProblem: null,
      hasProblemContext: Boolean(body.currentProblem?.trim() || body.problem?.trim()),
    });
    const eventType: UsageEventType =
      preliminaryIntent.mode === "practice" ? "practice_generation" : "ai_message";

    const anonymousUsage = user ? null : checkAnonymousDemoUsage(request);

    if (user) {
      const usageCheck = await checkUsageLimit({
        userId: user.id,
        eventType,
        accessToken,
      });

      if (!usageCheck.allowed) {
        return NextResponse.json(
          {
            message:
              usageCheck.message ||
              "You've reached today's free tutoring limit. Come back later or create an account to keep learning.",
            used: usageCheck.used,
            limit: usageCheck.limit,
            resetAt: usageCheck.resetAt,
          },
          { status: 403 }
        );
      }
    } else if (anonymousUsage && !anonymousUsage.allowed) {
      return NextResponse.json(
        {
          message: anonymousUsage.message,
          used: anonymousUsage.used,
          limit: anonymousUsage.limit,
        },
        { status: 403 }
      );
    }

    mark("usage_check");
    if (user && activeSessionId && !worksheetContext) {
      try {
        const supabase = createSupabaseServerClient(accessToken);
        const { data: session } = await supabase
          .from("learning_sessions")
          .select("tutor_thread, metadata")
          .eq("id", activeSessionId)
          .eq("user_id", user.id)
          .maybeSingle();

        worksheetContext = getStoredWorksheetContext(session);
      } catch (error) {
        console.error("Worksheet context load error:", error);
      }
    }

    const referencedWorksheetProblem = findReferencedWorksheetProblem({
      message: studentMessage,
      worksheetContext,
      currentProblem: body.currentProblem?.trim() || body.problem?.trim() || "",
    });
    const routedIntent = routeTutorIntent({
      requestedMode,
      studentMessage,
      tutoringSignals,
      worksheetContext,
      referencedWorksheetProblem,
      hasProblemContext: Boolean(
        body.currentProblem?.trim() ||
          body.problem?.trim() ||
          worksheetContext?.currentProblem?.trim() ||
          worksheetContext?.problems?.length
      ),
    });
    const mode = routedIntent.effectiveMode;
    const problem =
      referencedWorksheetProblem?.extractedText ||
      body.currentProblem?.trim() ||
      body.problem?.trim() ||
      worksheetContext?.currentProblem?.trim() ||
      worksheetContext?.problems?.[0]?.extractedText?.trim() ||
      "No problem provided yet.";
    const worksheetContextSummary = formatWorksheetContext(
      worksheetContext,
      referencedWorksheetProblem,
      problem
    );

    if (user) {
      // Session setup and memory retrieval are independent; run them concurrently
      // instead of paying for two sequential round trips before the LLM call.
      const [sessionOutcome, memoryOutcome] = await Promise.all([
        ensureLearningSession({
          userId: user.id,
          accessToken,
          sessionId: activeSessionId,
          problem,
          studentMessage,
          mode,
          profile: learningProfile,
          conversationHistory,
        }).then(
          (session) => ({ ok: true as const, sessionId: session.sessionId }),
          (error: unknown) => {
            console.error("Learning session start error:", error);
            return { ok: false as const };
          }
        ),
        retrieveLearningMemory({
          userId: user.id,
          accessToken,
          currentProblem: problem,
          studentMessage,
          clientProfile: learningProfile,
        }).then(
          (retrievedMemory) => ({ ok: true as const, retrievedMemory }),
          (error: unknown) => {
            console.error("Learning memory retrieval error:", error);
            return { ok: false as const };
          }
        ),
      ]);

      if (sessionOutcome.ok) {
        activeSessionId = sessionOutcome.sessionId;
      }

      if (memoryOutcome.ok) {
        learningProfile = memoryOutcome.retrievedMemory.profile;
        persistentMemorySummary = memoryOutcome.retrievedMemory.promptSummary;
      } else {
        persistentMemorySummary =
          "No reliable persistent memory available. Tutor normally using the current conversation only.";
      }
    }

    mark("memory_and_session");
    const tutoringState = deriveTutoringState({
      mode,
      studentMessage,
      learningProfile,
      tutoringSignals,
    });
    const answerCheckIntent =
      routedIntent.mode === "answer_check";
    const submittedAnswerSignal = hasSubmittedAnswerSignal(studentMessage);
    const hintEscalationLevel = deriveHintEscalationLevel(tutoringSignals);
    const mistakePatterns = detectMistakePatterns(
      `${problem}\n${studentMessage}`
    );
    const learningMemorySummary = summarizeLearningMemory(learningProfile);
    const recentProblemMemories =
      learningProfile.problemHistory?.slice(0, 2).map((problemMemory) => ({
        topic: problemMemory.topic,
        subtopic: problemMemory.subtopic,
        type: problemMemory.problemType,
        difficulty: problemMemory.difficulty,
        hints: problemMemory.hintsUsed,
        mistakes: problemMemory.mistakesMade.slice(0, 3),
        completed: problemMemory.completionStatus,
        independent: problemMemory.solvedIndependently,
        example: problemMemory.extractedText.slice(0, 120),
      })) ?? [];
    const compactSignals = compactTutoringSignals(tutoringSignals);
    const adaptiveGuidance = getAdaptiveGuidance({
      mode,
      studentMessage,
      learningProfile,
      tutoringSignals,
      hintLevel,
      tutoringState,
      hintEscalationLevel,
    });

    let answerEvaluation: AnswerEvaluation | null = null;

    // Persists usage, learning memory, and the conversation thread for
    // signed-in users. Takes the COMPLETE assistant message, so the streaming
    // path calls it after the stream finishes accumulating text.
    const persistTutorResponse = async (finalMessage: string) => {
      if (!user) return;
      let saved = true;
      // Usage can save independently; memory and thread writes stay ordered
      // because they both update session metadata.
      const usageWrite = recordUsageEvent({
        userId: user.id,
        eventType,
        accessToken,
      }).catch((error: unknown) => {
        saved = false;
        console.error("Usage event save error:", error);
      });

      const memoryWrite = recordLearningMemoryEvent({
        userId: user.id,
        accessToken,
        sessionId: activeSessionId,
        profile: learningProfile,
        mode,
        problem,
        studentMessage,
        assistantMessage: finalMessage,
        topic: learningProfile.currentSubject,
        skills: learningProfile.recentConcepts?.slice(0, 5),
        tutoringState,
        mistakePatterns,
        conversationHistory,
      }).catch((error: unknown) => {
        saved = false;
        console.error("Learning memory save error:", error);
      });

      const conversationWrite = (async () => {
        if (!activeSessionId) return;

        // Both writes update session metadata. Save the thread after memory so
        // the memory upsert cannot overwrite the conversation and worksheet.
        await memoryWrite;

        try {
          const supabase = createSupabaseServerClient(accessToken);
          const now = new Date().toISOString();
          const savedThreadMessages = buildSavedThreadMessages(
            conversationHistory,
            studentMessage,
            finalMessage
          );

          const { error: conversationInsertError } = await supabase
            .from("conversation_messages")
            .insert([
            {
              user_id: user.id,
              session_id: activeSessionId,
              role: "user",
              content: studentMessage,
          metadata: {
                mode,
                tutorMode: routedIntent.mode,
                routingReason: routedIntent.reason,
                tutoringState,
                answerEvaluation,
                source: "demo_help",
              },
              created_at: now,
            },
            {
              user_id: user.id,
              session_id: activeSessionId,
              role: "assistant",
              content: finalMessage,
              metadata: {
                mode,
                tutorMode: routedIntent.mode,
                routingReason: routedIntent.reason,
                tutoringState,
                answerEvaluation,
                source: "demo_help",
              },
              created_at: new Date(Date.now() + 1).toISOString(),
            },
          ]);

          if (conversationInsertError) {
            saved = false;
            console.error(
              "Conversation message insert error:",
              conversationInsertError
            );
          }

          const { data: existingSession } = await supabase
            .from("learning_sessions")
            .select("tutor_thread, metadata")
            .eq("id", activeSessionId)
            .eq("user_id", user.id)
            .maybeSingle();
          const existingTutorThread = toPlainObject(
            existingSession?.tutor_thread
          );
          const existingMetadata = toPlainObject(existingSession?.metadata);
          const existingWorksheetContext =
            getStoredWorksheetContext(existingSession);
          const activeWorksheetContext =
            worksheetContext ?? existingWorksheetContext ?? undefined;
          const { error: threadUpdateError } = await supabase
            .from("learning_sessions")
            .update({
              tutor_thread: {
                ...existingTutorThread,
                source: "demo_help",
                messages: savedThreadMessages,
                ...(activeWorksheetContext
                  ? { worksheetContext: activeWorksheetContext }
                  : {}),
              },
              metadata: {
                ...existingMetadata,
                mode,
                tutorMode: routedIntent.mode,
                routingReason: routedIntent.reason,
                recentMessages: savedThreadMessages,
                ...(activeWorksheetContext
                  ? { worksheetContext: activeWorksheetContext }
                  : {}),
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", activeSessionId)
            .eq("user_id", user.id);

          if (threadUpdateError) {
            saved = false;
            console.error("Conversation thread fallback save error:", threadUpdateError);
          }
        } catch (error) {
          saved = false;
          console.error("Conversation message save error:", error);
        }
      })();

      await Promise.allSettled([usageWrite, memoryWrite, conversationWrite]);
      mark("persistence");
      if (!saved) throw new Error("Tutor response persistence failed");
    };

    if (answerCheckIntent) {
      let message: string;
      if (!submittedAnswerSignal) {
        message =
          "I can check it — paste your answer or current work, and I’ll give you a clear verdict first.";
      } else {
        // Math normalization is only needed for the answer-evaluation call,
        // so it stays out of the main tutoring prompt.
        const normalizedStudentMath = normalizeStudentMathInput(studentMessage);
        const mathSignNotes = getMathSignNotes(studentMessage);
        answerEvaluation = await evaluateStudentAnswer({
          openai,
          problem: [problem, worksheetContextSummary].filter(Boolean).join("\n\n"),
          studentMessage,
          normalizedStudentMath,
          mathSignNotes,
          conversationHistory,
        });
        message = buildAnswerEvaluationMessage(answerEvaluation, {
          includeExplanation: asksForAnswerExplanation(studentMessage),
        });
      }

      // Answer verdicts stay on the non-streaming JSON path: the evaluation
      // is a short structured call, so there is nothing meaningful to stream.
      mark("answer_evaluation");
      // Preserve the evaluated answer even if saving fails, as on the
      // original JSON path. Streaming reports save failures separately.
      await persistTutorResponse(message).catch(() => {});
      const answerResponseBody = {
        message,
        sessionId: activeSessionId,
        anonymousUsage: anonymousUsage
          ? {
              used: anonymousUsage.used + 1,
              limit: anonymousUsage.limit,
            }
          : undefined,
      };
      const answerResponse = NextResponse.json(answerResponseBody);
      if (anonymousUsage) {
        return addAnonymousDemoUsageCookie(
          answerResponse,
          anonymousUsage.used + 1
        );
      }
      return answerResponse;
    } else {
      const generate = (signal: AbortSignal) => openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "system",
            content: `
Server-side adaptive memory context:
${persistentMemorySummary}

Use this only for subtle pacing, hint size, misconception awareness, and practice targeting.
Do not announce the memory system. Do not over-reference past learning. If memory is thin or unavailable, tutor normally.
`,
          },
          ...conversationHistory.slice(-8).map((message) => ({
            role: message.role,
            content: truncateContextText(message.content),
          })),
          {
            role: "user",
            content: `
Requested mode: ${requestedMode}
Routed tutor mode: ${routedIntent.mode}
Routing reason: ${routedIntent.reason}
Effective generation mode: ${mode}
Mode instructions: ${modeInstructions[mode]}
Tutoring state: ${tutoringState}
Adaptive guidance: ${adaptiveGuidance}
Hint level: ${hintLevel ? hintInstructions[hintLevel] : "Not a hint request"}
Hint escalation: ${getHintEscalationInstructions(hintEscalationLevel)}
Practice topic: ${practiceTopic}
Practice difficulty: ${practiceDifficulty}
Practice style/type: ${practiceType}
Mistake patterns to watch:
${mistakePatterns.length ? mistakePatterns.join(", ") : "No clear pattern yet"}

Learning profile memory:
${learningMemorySummary}

Recent problem memory for personalization:
${recentProblemMemories.length ? JSON.stringify(recentProblemMemories) : "No prior problem metadata yet."}

Active worksheet context:
${worksheetContextSummary || "No uploaded worksheet context for this session."}

Worksheet continuity rule:
${
  worksheetContextSummary
    ? "The uploaded worksheet remains part of the active tutoring workspace. If the student says a problem number, next problem, screenshot, worksheet, graph, or this problem, use the active worksheet context before asking for another upload."
    : "No worksheet has been parsed for this session. Ask for an upload, crop, or pasted problem only if needed."
}

Learning signals:
${Object.keys(compactSignals).length ? JSON.stringify(compactSignals) : "none"}

Submitted answer/work signal:
${submittedAnswerSignal ? "The message appears to include an answer or completed attempt." : "No clear submitted answer detected."}

Problem:
${problem}

Student message (raw):
${studentMessage}
`,
          },
        ],
        temperature: 0.55,
        max_completion_tokens: 700,
        stream: true,
      }, { signal });

      const tutorStream = createTutorStream({
        generate,
        persist: persistTutorResponse,
        meta: {
          requestId,
          sessionId: activeSessionId,
          anonymousUsage: anonymousUsage
            ? { used: anonymousUsage.used + 1, limit: anonymousUsage.limit }
            : undefined,
        },
        onStage: mark,
      });

      const streamResponse = new NextResponse(tutorStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
      if (anonymousUsage) {
        return addAnonymousDemoUsageCookie(
          streamResponse,
          anonymousUsage.used + 1
        );
      }
      return streamResponse;
    }

  } catch (error) {
    console.error("Demo help API error:", error);

    return NextResponse.json(
      {
        message:
          "I hit a temporary issue while generating the explanation. Try sending the message again.",
      },
      { status: 500 }
    );
  }
}

function normalizeForTopicGuard(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Bound per-message history size so one long LaTeX-heavy exchange can't blow
// up the context window (and the bill) on every turn.
function truncateContextText(text: string, maxChars = 1500) {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\u2026` : trimmed;
}

// Only send signals that are actually active; the full flag dump is mostly
// undefined/false noise.
function compactTutoringSignals(signals: TutoringSignals) {
  const compact: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(signals ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === "number" && value === 0) continue;
    compact[key] = value as string | number | boolean;
  }

  return compact;
}

function buildSavedThreadMessages(
  conversationHistory: ConversationMessage[],
  studentMessage: string,
  assistantMessage: string
) {
  const safeMessages = conversationHistory
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        Boolean(message.content?.trim())
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
  const lastMessage = safeMessages[safeMessages.length - 1];

  if (
    !lastMessage ||
    lastMessage.role !== "user" ||
    lastMessage.content.trim() !== studentMessage.trim()
  ) {
    safeMessages.push({
      role: "user",
      content: studentMessage.trim(),
    });
  }

  safeMessages.push({
    role: "assistant",
    content: assistantMessage.trim(),
  });

  return safeMessages.slice(-30);
}

function toPlainObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function routeTutorIntent({
  requestedMode,
  studentMessage,
  tutoringSignals,
  worksheetContext,
  referencedWorksheetProblem,
  hasProblemContext,
}: {
  requestedMode: DemoHelpMode;
  studentMessage: string;
  tutoringSignals: TutoringSignals;
  worksheetContext: WorksheetContext | null;
  referencedWorksheetProblem: WorksheetProblem | null;
  hasProblemContext: boolean;
}): RoutedTutorIntent {
  if (
    requestedMode === "generate_practice" ||
    /^structured app action:\s*practice_this\b/i.test(studentMessage)
  ) {
    return {
      mode: "practice",
      effectiveMode: "generate_practice",
      reason: "Structured practice CTA requested targeted practice generation.",
    };
  }

  if (
    requestedMode === "check_work" ||
    tutoringSignals.answerCheckSignal ||
    hasAnswerCheckIntent(studentMessage) ||
    hasVerificationEquationSignal(studentMessage)
  ) {
    return {
      mode: "answer_check",
      effectiveMode: "check_work",
      reason: "Student asked to verify an answer or submitted a solution for checking.",
    };
  }

  if (/\b(?:another|similar|practice|harder|easier|new problem|give me one|try another)\b/i.test(
    studentMessage
  )) {
    return {
      mode: "practice",
      effectiveMode: "generate_practice",
      reason: "Student asked for another problem or practice.",
    };
  }

  if (asksForAnswerExplanation(studentMessage)) {
    return {
      mode: "review",
      effectiveMode: "general",
      reason: "Student asked for reasoning or explanation.",
    };
  }

  if (
    referencedWorksheetProblem ||
    (worksheetContext &&
      /\b#\s*\d+[a-z]?\b|\b(?:problem|number|question)\s*\d+[a-z]?\b|\b(?:next|screenshot|worksheet|graph|this problem|that problem)\b/i.test(
        studentMessage
      ))
  ) {
    return {
      mode: "screenshot_reference",
      effectiveMode: requestedMode === "hint" ? "hint" : "general",
      reason: "Student referenced the active uploaded worksheet.",
    };
  }

  if (!hasProblemContext && !studentMessage.trim()) {
    return {
      mode: "clarification",
      effectiveMode: "general",
      reason: "No problem or student request is available yet.",
    };
  }

  return {
    mode: "tutoring",
    effectiveMode: requestedMode,
    reason: "Default guided tutoring flow.",
  };
}

function hasVerificationEquationSignal(text: string) {
  return (
    /(?:\bis\b|\bcheck\b|\bverify\b|\bright\??\b|\bcorrect\??\b)/i.test(text) &&
    /#\s*\d+[a-z]?|\b(?:problem|question|number)\s*\d+[a-z]?/i.test(text) &&
    /=|\\\(|\\\[|\^|[xy]\s*[+\-]|\([^)]+\)\s*\^/i.test(text)
  );
}

function normalizeWorksheetContext(value: unknown): WorksheetContext | null {
  if (!value || typeof value !== "object") return null;

  const context = value as Partial<WorksheetContext>;
  const problems = Array.isArray(context.problems)
    ? context.problems
        .filter(
          (problem): problem is WorksheetProblem =>
            Boolean(problem) &&
            typeof problem === "object" &&
            typeof (problem as WorksheetProblem).extractedText === "string" &&
            Boolean((problem as WorksheetProblem).extractedText.trim())
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

function getStoredWorksheetContext(
  session:
    | {
        tutor_thread?: unknown;
        metadata?: unknown;
      }
    | null
    | undefined
) {
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

function findReferencedWorksheetProblem({
  message,
  worksheetContext,
  currentProblem,
}: {
  message: string;
  worksheetContext: WorksheetContext | null;
  currentProblem: string;
}) {
  const problems = worksheetContext?.problems ?? [];
  if (!problems.length) return null;

  const numberMatch =
    message.match(/#\s*(\d+[a-z]?)/i) ||
    message.match(/\b(?:problem|number|question)\s*(\d+[a-z]?)\b/i);
  const requestedNumber = numberMatch?.[1]?.toLowerCase();

  if (requestedNumber) {
    return (
      problems.find((problem) =>
        [problem.label, problem.id, problem.extractedText]
          .filter(Boolean)
          .some((value) =>
            new RegExp(`(?:^|[^0-9a-z])#?${escapeRegExp(requestedNumber)}(?:[^0-9a-z]|$)`, "i").test(
              value
            )
          )
      ) ??
      findProblemByInferredWorksheetNumber(problems, requestedNumber)
    );
  }

  if (/\bnext (?:one|problem|question)\b|\bwhat about the next\b/i.test(message)) {
    const currentIndex = currentProblem
      ? problems.findIndex(
          (problem) =>
            normalizeForTopicGuard(problem.extractedText) ===
              normalizeForTopicGuard(currentProblem) ||
            normalizeForTopicGuard(currentProblem).includes(
              normalizeForTopicGuard(problem.extractedText).slice(0, 80)
            )
        )
      : -1;

    return problems[Math.min(currentIndex + 1, problems.length - 1)] ?? null;
  }

  return null;
}

function findProblemByInferredWorksheetNumber(
  problems: WorksheetProblem[],
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

function getProblemNumber(problem: WorksheetProblem) {
  const match = [problem.label, problem.id, problem.extractedText]
    .join(" ")
    .match(/(?:^|[^0-9])#?(\d+)[a-z]?(?:[^0-9]|$)/i);

  return match ? Number.parseInt(match[1], 10) : null;
}

function formatWorksheetContext(
  worksheetContext: WorksheetContext | null,
  referencedProblem: WorksheetProblem | null,
  activeProblemText?: string
) {
  if (!worksheetContext) return "";

  const problems = worksheetContext.problems ?? [];
  const normalizedActive = (activeProblemText ?? "").trim().toLowerCase();
  // Full problem text is only sent for the problems the student is actually
  // working on. The rest are label-only so "problem 7" / "next" still resolve
  // without paying for a dozen full problem texts every turn.
  const indexedProblems = problems
    .slice(0, 20)
    .map((problem, index) => {
      const label = problem.label || `Problem ${index + 1}`;
      const isPriority =
        (referencedProblem != null && problem === referencedProblem) ||
        index < 3 ||
        (normalizedActive.length > 0 &&
          problem.extractedText.trim().toLowerCase() === normalizedActive);

      if (!isPriority) return `- ${label}`;

      const skills = problem.skills?.length
        ? ` Skills: ${problem.skills.slice(0, 3).join(", ")}.`
        : "";
      const visual = problem.visualContext ? ` Visual: ${problem.visualContext}.` : "";

      return `- ${label}: ${problem.extractedText}${skills}${visual}`;
    })
    .join("\n");

  return [
    `Uploaded worksheet: ${worksheetContext.fileName || "active worksheet"}`,
    worksheetContext.visualSummary
      ? `Visual summary: ${worksheetContext.visualSummary}`
      : "",
    referencedProblem
      ? `Student appears to mean: ${referencedProblem.label} — ${referencedProblem.extractedText}`
      : "",
    worksheetContext.currentProblem
      ? `Pinned/active problem: ${worksheetContext.currentProblem}`
      : "",
    indexedProblems ? `Parsed worksheet problems:\n${indexedProblems}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function evaluateStudentAnswer({
  openai,
  problem,
  studentMessage,
  normalizedStudentMath,
  mathSignNotes,
  conversationHistory,
}: {
  openai: OpenAI;
  problem: string;
  studentMessage: string;
  normalizedStudentMath: string;
  mathSignNotes: string[];
  conversationHistory: ConversationMessage[];
}): Promise<AnswerEvaluation> {
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 400,
    messages: [
      {
        role: "system",
        content: `
You are StepWise's answer evaluation engine.

Your only job is to determine one stable correctness verdict before any tutoring response.
Return JSON only. Do not tutor. Do not ask Socratic questions. Do not include hidden reasoning.

Choose exactly one verdict:
- correct
- partially_correct
- incorrect
- ambiguous

Validation rules:
- Compute the solution privately before deciding.
- For parabola/conic problems, verify vertex location, orientation, standard form, p value, 4p value, coefficient sign, and algebra consistency.
- Preserve minus signs exactly. If the student wrote = -6(...), that is negative six.
- Do not change verdict midstream. If the problem or answer is not clear enough, use ambiguous.
- Explanation must be one concise sentence that supports the verdict.
- correctPieces and incorrectPieces should be short phrases, not full derivations.
`,
      },
      ...conversationHistory.slice(-6).map((message) => ({
        role: message.role,
        content: truncateContextText(message.content),
      })),
      {
        role: "user",
        content: `
Problem/context:
${problem}

Student answer/check request:
${studentMessage}

Math-normalized student answer:
${normalizedStudentMath}

Math sign notes:
${mathSignNotes.length ? mathSignNotes.join("\n") : "No special sign notes."}

Return JSON with this exact shape:
{
  "verdict": "correct | partially_correct | incorrect | ambiguous",
  "explanation": "one concise sentence",
  "correctPieces": ["short phrase"],
  "incorrectPieces": ["short phrase"],
  "confidence": 0.0,
  "nextAction": "optional short next action"
}
`,
      },
    ],
  });

  return parseAnswerEvaluation(completion.choices[0]?.message.content ?? "");
}

function parseAnswerEvaluation(rawContent: string): AnswerEvaluation {
  try {
    const parsed = JSON.parse(rawContent) as Partial<AnswerEvaluation>;
    const verdicts: AnswerEvaluationVerdict[] = [
      "correct",
      "partially_correct",
      "incorrect",
      "ambiguous",
    ];

    return {
      verdict: verdicts.includes(parsed.verdict as AnswerEvaluationVerdict)
        ? (parsed.verdict as AnswerEvaluationVerdict)
        : "ambiguous",
      explanation:
        typeof parsed.explanation === "string" && parsed.explanation.trim()
          ? parsed.explanation.trim()
          : "I can’t verify that confidently from the current context.",
      correctPieces: Array.isArray(parsed.correctPieces)
        ? parsed.correctPieces.filter((piece) => typeof piece === "string").slice(0, 3)
        : [],
      incorrectPieces: Array.isArray(parsed.incorrectPieces)
        ? parsed.incorrectPieces
            .filter((piece) => typeof piece === "string")
            .slice(0, 3)
        : [],
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
      nextAction:
        typeof parsed.nextAction === "string" ? parsed.nextAction.trim() : "",
    };
  } catch {
    return {
      verdict: "ambiguous",
      explanation: "I can’t verify that confidently from the current context.",
      correctPieces: [],
      incorrectPieces: [],
      confidence: 0.35,
      nextAction: "Paste the exact problem and answer, and I’ll check it directly.",
    };
  }
}

function buildAnswerEvaluationMessage(
  evaluation: AnswerEvaluation,
  options: { includeExplanation?: boolean } = {}
) {
  const explanation = ensureTerminalPunctuation(evaluation.explanation);
  const nextAction = getShortNextAction(
    evaluation.verdict === "correct" ? "" : evaluation.nextAction,
    (evaluation.verdict === "correct"
      ? "Any questions about this one, or ready to move on?"
      : "Want to adjust that piece?")
  );

  if (evaluation.verdict === "correct") {
    if (options.includeExplanation) {
      return `Yes — that’s correct.\n\n${explanation}\n\n${nextAction}`;
    }

    return `Yep — that’s correct.\n\n${nextAction}`;
  }

  if (evaluation.verdict === "partially_correct") {
    const issue = evaluation.incorrectPieces[0]
      ? `\n\nCheck ${ensureTerminalPunctuation(
          lowercaseFirst(evaluation.incorrectPieces[0])
        )}`
      : "";

    return `You're close — ${explanation}${issue}\n\n${nextAction}`;
  }

  if (evaluation.verdict === "incorrect") {
    return `Not quite — ${explanation}\n\n${nextAction}`;
  }

  return `I can’t check that confidently yet — ${explanation}\n\n${nextAction}`;
}

function ensureTerminalPunctuation(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function getShortNextAction(nextAction: string, fallback: string) {
  const trimmed = nextAction.trim();
  if (!trimmed) return fallback;

  const firstSentence = trimmed.match(/^[^.!?]+[.!?]/)?.[0] ?? trimmed;
  return firstSentence.length <= 140 ? firstSentence : fallback;
}

function lowercaseFirst(text: string) {
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

function asksForAnswerExplanation(text: string) {
  return /\bwhy\b|explain|walk me through|show (?:me )?(?:why|how)|how did|review|reasoning/i.test(
    text
  );
}

function hasAnswerCheckIntent(text: string) {
  return /check (?:my )?(?:answer|work)|can you check|verify|did i get (?:this|it)?\s*right|is (?:this|that|it|my answer|the answer)(?:\b|[^a-z])|is (?:the\s+)?answer\s+(?:for|to)\s+#?\d+[a-z]?|is this (?:right|correct)|is my answer|does this (?:work|look right)|would this be|my answer is|answer is|i got|final answer|correct\?/i.test(
    text
  );
}

function hasSubmittedAnswerSignal(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) return false;

  return (
    /(?:^|\s)(?:x|y|[a-z])\s*=/.test(trimmedText) ||
    /=/.test(trimmedText) ||
    /answer is|final answer|therefore|i got|my answer is|would this be/i.test(
      trimmedText
    ) ||
    trimmedText.split(/\s+/).length >= 12
  );
}

function normalizeStudentMathInput(text: string) {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/\s*=\s*-/g, " = -")
    .replace(/\s*([+*/^])\s*/g, " $1 ")
    .replace(/\s*-\s*/g, " -")
    .replace(/\s+/g, " ")
    .trim();
}

function getMathSignNotes(text: string) {
  const normalized = normalizeStudentMathInput(text);
  const notes: string[] = [];

  const negativeAfterEqualsMatches = [
    ...normalized.matchAll(/=\s*-(\d+(?:\.\d+)?|[a-zA-Z])/g),
  ];

  for (const match of negativeAfterEqualsMatches.slice(0, 3)) {
    notes.push(
      `The answer includes an explicit negative term after equals: "${match[0]}". Treat this as negative, not positive.`
    );
  }

  const negativeCoefficientMatches = [
    ...normalized.matchAll(/(^|[=(,+*/^]\s*)-(\d+(?:\.\d+)?)(?=\s*[a-zA-Z(])/g),
  ];

  for (const match of negativeCoefficientMatches.slice(0, 3)) {
    const coefficient = match[2];
    const note = `The expression includes a negative coefficient: -${coefficient}.`;
    if (!notes.includes(note)) notes.push(note);
  }

  return notes;
}
