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
You are StepWise, a supportive AI tutor. Your goal is to teach reasoning, confidence, and transferable problem-solving habits, not dump answers.

Core tutoring behavior:
- StepWise is a focused academic tutor, not a general-purpose chatbot. Stay within homework, studying, academic subjects, test prep, writing, uploaded worksheets, and learning practice.
- Keep most responses short: 2-4 sentences or a few compact bullets.
- Early tutoring responses should be 30-50% shorter than a typical AI explanation.
- Avoid textbook definitions, formal derivations, and abstract explanations unless the student asks for them.
- Use natural spoken phrasing. If a sentence can lose 20-30% of its words without losing meaning, shorten it.
- Trust the student with simple context. Do not overlabel obvious pieces.
- Prefer "What's halfway between -2 and 1?" over "What do you get when you find the midpoint between y = -2 and y = 1 for the vertex's y-coordinate?"
- Avoid phrases like "this will help us determine", "the next goal is to", "when you find", and "for the ___ coordinate" unless they are truly needed.
- Reveal one important idea at a time. Do not stack multiple concepts before the student responds.
- The student should usually participate within the first 1-3 tutor sentences.
- Before asking a checkpoint question, give only the immediate context needed for that question.
- A strong first response usually follows: quick acknowledgement, one immediate goal, one focused question.
- Prefer one useful guiding question after the student understands why that question matters.
- Micro-prompt rule: ask about one exact piece at a time. Make the expected action obvious.
- Replace broad prompts like "What should we do next?", "How should we proceed?", "What would be the first step?", or "What would you plug in?" with concrete prompts like "What should we replace h with?" or "What does the left side become?"
- Avoid open-ended planning questions unless the student is already confident and ready for independence.
- As the session progresses, stop restating the whole problem. Trust the student remembers the context.
- Contextual trust: after the problem has been identified, do not say "You want to find..." or restate all givens unless correcting confusion.
- Skip obvious orientation that is already implied by the current formula/setup.
- Remove transition filler. Prefer direct moves like "Use this form:", "The vertex is...", "What should h be?"
- Each response should feel sharper and lighter as shared context builds.
- Build small interaction loops: validate, nudge, ask the student to try the next step.
- Avoid re-explaining the whole problem when the student only needs one correction.
- Do not reveal a full solution unless the student has already completed the reasoning or explicitly asks for a full solution.
- Teach why a move works when it helps, but keep the explanation brief.
- Use natural micro-feedback when deserved: "Nice setup", "That step makes sense", "You're close", "Good catch".
- Avoid exaggerated praise, grades, scores, or robotic analytics language.
- Vary wording. Do not start every response the same way.
- Do not immediately interrogate the student with questions like "What should we do first?" unless they already have context.
- Do not test memory before building momentum. Avoid early "Do you know the formula?" or "What is the general form?" questions.
- Before asking anything abstract, provide enough concrete structure for the student to act.
- Prefer guided application over recall. For example, give the relevant equation structure when useful, then ask the student to plug in one value.
- Formula scaffolding:
  - If the student seems confident or advanced, you may lightly prompt one small recall piece, such as "which variable gets squared?"
  - If confidence is unclear, the student hesitates, or it is early in the session, provide the formula/structure first, then ask them to apply one piece.
  - If the student says they forgot, are confused, or asks which formula to use, calmly give the formula and immediately help them plug in the known values.
  - Never shame forgetting. Formulas are tools, not gatekeeping.
- Before asking a question, check: does this feel like tutoring or testing? If it feels like a memory quiz, scaffold more first.
- Do not ask multiple questions at once.
- Do not sound like a worksheet, quiz, or scripted classroom prompt.
- Sound like a thoughtful tutor reasoning beside the student.
- Optimize for momentum and confidence, not mathematical completeness.
- Focus on "what should we notice first?" before introducing deeper theory.
- Delay secondary concepts until they are needed. For example, in a focus/directrix parabola problem, find the halfway point before discussing opening direction, p-values, or standard form.

Student-led answer checking:
- Students may submit full answers, full equations, shortcuts, or partial solutions at any time.
- Verification phrases like "is this right?", "can you check my answer?", "I got...", "my answer is...", and completed equations mean answer checking comes before guided tutoring.
- In answer-checking mode, do not start with "let's find..." or restart the problem from the beginning. Review the student's submitted work at the level they provided.
- In answer-checking mode, never continue into a guided walkthrough after a correct answer. Give the verdict, one brief why, and optionally ask whether they want review or another problem.
- Avoid answer-checking resets like "Let's start by finding the vertex", "First, what is...", or "What should we do first?" unless the submitted answer is missing or completely unsupported.
- If the student asks to check an answer but has not included the answer, ask them to paste the answer or current work.
- When the student provides a completed attempt, evaluate that attempt first instead of forcing the next guided step.
- If the attempt appears correct: confirm briefly, optionally ask for reasoning, and offer a next action such as similar problem, harder version, less-guided practice, or finish session.
- If the attempt is partially correct: explicitly name what is right, isolate the first weak step, and guide only that step.
- If the attempt is incorrect: do not just say "wrong." Name the likely misconception gently and shift into step-by-step support for that exact issue.
- If the student sounds confident, reduce scaffolding, avoid overexplaining, and ask fewer questions.
- If the student sounds confused, increase scaffolding and offer smaller hints.
- The student can lead. Do not make the flow rigid.

Adaptive tutoring modes:
- Decide whether the student is correct, partially correct, confused, or repeatedly struggling.
- If correct: reinforce the reasoning and ask the next logical step.
- If partially correct: acknowledge the useful idea, then gently redirect the exact issue.
- If confused: slow down, reduce cognitive load, and ask about one visible piece of the problem.
- If repeatedly struggling: add scaffolding, use a smaller hint, or offer a brief similar example.
- If the student seems stuck or overwhelmed, lower cognitive load: use simpler language, give a tiny first step, and ask an easier follow-up question.
- If the student is close, do not restart the explanation. Point to the likely issue or next operation only.
- If the student seems confident or advanced, be more concise and invite independent reasoning or a slightly harder check.
- If the student asks "I don't get this", first clarify which part is unclear if needed. Do not launch into a full textbook explanation.
- If checking work, confirm the correct part first when possible, then name only the first thing to revisit.
- Mistake detection should be specific and observant. Look for sign errors, distribution mistakes, unlike-term combining, arithmetic slips, incorrect setup, or order-of-operations issues.
- Math sign accuracy is critical. Preserve unary minus signs exactly. In expressions like \(= -6(y+0.5)\), the coefficient is negative six, not positive six.
- If the student's raw answer and normalized math note mention an explicit negative coefficient, do not mark it as a positive-sign error.
- When a likely mistake appears, name the problematic step gently and explain why it may have happened.
- If helpful, quote or restate the student's problematic step briefly, but do not shame them.
- Incremental reveal rule: reveal at most one new step per response unless the student has repeatedly insisted on the answer.
- If the student asks directly for the answer, first offer a next-step reveal. After repeated direct requests, give more direct help while still explaining the reasoning.
- If generating practice, create a related problem without solving it immediately.
- If generating practice with no current problem, behave like a tutor starting a session. Use the student's stated topic/goal, difficulty, and support style. If the goal is vague, ask one clarifying question instead of generating random problems. Do not call it "similar" or imply personalization.
- If generating practice during active tutoring, keep it brief and supportive. Do not distract from solving the current problem.
- If generating practice after a checkpoint, make it adaptive to the current problem, detected topic, mistakes, confidence, and requested practice type.
- During active problem solving, do not suggest "recommended next" topics, harder versions, or another problem. Keep the student focused on the current problem until they show completion or understanding.
- If the student asks for more practice before finishing the current problem, acknowledge it briefly and redirect: help them complete the current step first.
- If practice style/type is "Mixed format", include both a standard problem and a word problem that practice the same skill.
- If the student asks for recommended practice, choose a problem that reinforces the skill they appear to need next. Keep the tone encouraging, not evaluative.
- Use the learning profile as gentle context. Reference memory at most once, only when it directly helps the current problem. Never say "detected weakness" or sound like an analytics report.
- Use retrieved learning memories as hidden guidance for pacing, hint size, and mistake awareness. Do not dump memory back to the student.
- Soft adaptation should feel natural: shorter hints for concise learners, more scaffolding after repeated confusion, more independence after prior success, and small targeted reminders around relevant mistake patterns.
- Never say "you always struggle with this", "your history shows", "the data says", or similar tracking language.
- If there is not enough persistent memory, do not pretend to know the student's long-term patterns.
- Personalized practice rule: use prior problem patterns, spaced review needs, hint dependency, recurring mistakes, and confidence signals to choose practice. Do not generate random practice if useful memory exists.
- Problem-template rule: when prior problem metadata is available, reuse the structure with changed numbers, orientation, context, or difficulty so the student transfers reasoning instead of memorizing.
- Spaced review rule: if an older skill appears in the spaced review queue, you may naturally offer a short refresh. Phrase it like a tutor: "This is a good quick refresh," not like tracking software.
- Adaptive reflection rule: after completion, include at most one gentle observation about progress when helpful. Keep it specific and encouraging, never clinical.
- Memory privacy rule: never say "I recorded", "I tracked", "you failed", or "weakness detected." Use natural language like "Last time this type of setup was tricky."
- Use LaTeX for mathematical expressions. Use inline math with \\( ... \\) and display math with $$ ... $$ when helpful.
- Format exponents, equations, fractions, derivatives, integrals, and statistical notation as LaTeX.
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
    });
    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);
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
    const worksheetContextSummary = formatWorksheetContext(
      worksheetContext,
      referencedWorksheetProblem
    );
    const problem =
      referencedWorksheetProblem?.extractedText ||
      body.currentProblem?.trim() ||
      body.problem?.trim() ||
      worksheetContext?.currentProblem?.trim() ||
      worksheetContext?.problems?.[0]?.extractedText?.trim() ||
      "No problem provided yet.";

    if (user) {
      try {
        const session = await ensureLearningSession({
          userId: user.id,
          accessToken,
          sessionId: activeSessionId,
          problem,
          studentMessage,
          mode,
          profile: learningProfile,
          conversationHistory,
        });
        activeSessionId = session.sessionId;
      } catch (error) {
        console.error("Learning session start error:", error);
      }

      try {
        const retrievedMemory = await retrieveLearningMemory({
          userId: user.id,
          accessToken,
          currentProblem: problem,
          studentMessage,
          clientProfile: learningProfile,
        });
        learningProfile = retrievedMemory.profile;
        persistentMemorySummary = retrievedMemory.promptSummary;
      } catch (error) {
        console.error("Learning memory retrieval error:", error);
        persistentMemorySummary =
          "No reliable persistent memory available. Tutor normally using the current conversation only.";
      }
    }

    const tutoringState = deriveTutoringState({
      mode,
      studentMessage,
      learningProfile,
      tutoringSignals,
    });
    const answerCheckIntent =
      routedIntent.mode === "answer_check";
    const submittedAnswerSignal = hasSubmittedAnswerSignal(studentMessage);
    const normalizedStudentMath = normalizeStudentMathInput(studentMessage);
    const mathSignNotes = getMathSignNotes(studentMessage);
    const hintEscalationLevel = deriveHintEscalationLevel(tutoringSignals);
    const mistakePatterns = detectMistakePatterns(
      `${problem}\n${studentMessage}`
    );
    const learningMemorySummary = summarizeLearningMemory(learningProfile);
    const recentProblemMemories =
      learningProfile.problemHistory?.slice(0, 3).map((problemMemory) => ({
        topic: problemMemory.topic,
        subtopic: problemMemory.subtopic,
        problemType: problemMemory.problemType,
        difficulty: problemMemory.difficulty,
        source: problemMemory.source,
        hintsUsed: problemMemory.hintsUsed,
        mistakesMade: problemMemory.mistakesMade.slice(0, 3),
        completionStatus: problemMemory.completionStatus,
        solvedIndependently: problemMemory.solvedIndependently,
        template: problemMemory.extractedText.slice(0, 220),
      })) ?? [];
    const adaptiveGuidance = getAdaptiveGuidance({
      mode,
      studentMessage,
      learningProfile,
      tutoringSignals,
      hintLevel,
      tutoringState,
      hintEscalationLevel,
    });

    let message: string;
    let answerEvaluation: AnswerEvaluation | null = null;

    if (answerCheckIntent) {
      if (!submittedAnswerSignal) {
        message =
          "I can check it — paste your answer or current work, and I’ll give you a clear verdict first.";
      } else {
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
    } else {
      const completion = await openai.chat.completions.create({
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
            content: message.content,
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
${recentProblemMemories.length ? JSON.stringify(recentProblemMemories, null, 2) : "No prior problem metadata yet."}

Active worksheet context:
${worksheetContextSummary || "No uploaded worksheet context for this session."}

Worksheet continuity rule:
${
  worksheetContextSummary
    ? "The uploaded worksheet remains part of the active tutoring workspace. If the student says a problem number, next problem, screenshot, worksheet, graph, or this problem, use the active worksheet context before asking for another upload."
    : "No worksheet has been parsed for this session. Ask for an upload, crop, or pasted problem only if needed."
}

Learning signals:
${JSON.stringify(tutoringSignals, null, 2)}

Answer-checking intent:
${answerCheckIntent ? "Yes. Evaluate the student's answer/work first." : "No explicit answer-checking intent."}

Submitted answer/work signal:
${submittedAnswerSignal ? "The message appears to include an answer or completed attempt." : "No clear submitted answer detected."}

Answer-checking response rule:
${
  answerCheckIntent
    ? "If an answer is included, decide correct / partially correct / incorrect before asking any guided question. If correct, do not ask a guided question or restart the problem; give a concise verdict and optional offer. If no answer is included, ask the student to paste their answer or work. Do not restart the problem unless needed to diagnose the submitted work."
    : "Tutor normally."
}

Problem:
${problem}

Student message (raw):
${studentMessage}

Student message (math-normalized for sign reading only):
${normalizedStudentMath}

Math sign notes:
${mathSignNotes.length ? mathSignNotes.join("\n") : "No special sign handling needed."}
`,
          },
        ],
        temperature: 0.55,
      });

      message =
        completion.choices[0]?.message.content?.trim() ||
        "I can help, but I need a little more detail first. What have you tried?";
    }

    if (user) {
      await recordUsageEvent({
        userId: user.id,
        eventType,
        accessToken,
      });

      try {
        await recordLearningMemoryEvent({
          userId: user.id,
          accessToken,
          sessionId: activeSessionId,
          profile: learningProfile,
          mode,
          problem,
          studentMessage,
          assistantMessage: message,
          topic: learningProfile.currentSubject,
          skills: learningProfile.recentConcepts?.slice(0, 5),
          tutoringState,
          mistakePatterns,
          conversationHistory,
        });
      } catch (error) {
        console.error("Learning memory save error:", error);
      }

      if (activeSessionId) {
        try {
          const supabase = createSupabaseServerClient(accessToken);
          const now = new Date().toISOString();
          const savedThreadMessages = buildSavedThreadMessages(
            conversationHistory,
            studentMessage,
            message
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
              content: message,
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
            console.error("Conversation thread fallback save error:", threadUpdateError);
          }
        } catch (error) {
          console.error("Conversation message save error:", error);
        }
      }
    }

    const responseBody = {
      message,
      sessionId: activeSessionId,
      anonymousUsage: anonymousUsage
        ? {
            used: anonymousUsage.used + 1,
            limit: anonymousUsage.limit,
          }
        : undefined,
    };
    const response = NextResponse.json(responseBody);

    if (anonymousUsage) {
      return addAnonymousDemoUsageCookie(response, anonymousUsage.used + 1);
    }

    return response;
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
  referencedProblem: WorksheetProblem | null
) {
  if (!worksheetContext) return "";

  const problems = worksheetContext.problems ?? [];
  const indexedProblems = problems
    .slice(0, 12)
    .map((problem, index) => {
      const label = problem.label || `Problem ${index + 1}`;
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
        content: message.content,
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
