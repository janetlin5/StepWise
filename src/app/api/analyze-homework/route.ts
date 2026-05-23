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

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnalyzeHomeworkRequest = {
  fileName?: string;
  fileType?: string;
  fileDataUrl?: string;
  originalFileDataUrl?: string;
  readingViewDataUrls?: string[];
  mode?: "extract" | "targeted_tutoring";
  targetPrompt?: string;
  cropRegion?: CropRegion | null;
  learningProfile?: LearningProfile;
  conversationHistory?: ConversationMessage[];
  sessionId?: string;
};

type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

type HomeworkAnalysis = {
  message: string;
  currentProblem: string;
  confidence: number;
  needsUserSelection: boolean;
  lowConfidenceReason: string;
  visualSummary: string;
  answerEvaluation: AnswerEvaluation | null;
  problems: DetectedHomeworkProblem[];
};

const imageAnalysisPrompt = `
You are StepWise's homework perception system.

Your job is to understand the uploaded homework BEFORE tutoring begins.
Do not solve problems. Do not start tutoring. Do not give final answers.

Extract structured information:
- printed text
- handwritten math when legible
- equations with high fidelity
- numbered problems
- separate question regions
- answer choices
- geometry diagrams, graphs, coordinate planes, and labels
- visible student work or likely mistake types

Trust rules:
- If there are multiple problems, separate them.
- Preserve visible worksheet numbering exactly in each problem label, such as "#6" or "Problem 7". Do not relabel visible #6 as "Problem 1".
- If you are uncertain, lower the confidence and say what needs confirmation.
- Never pretend you fully understood an unclear image.
- If a diagram is present, mention it explicitly.
- The image may be a low-quality phone photo: tilted, shadowed, blurry, faint, or partially cropped. Read it patiently from the visible structure, use problem numbers/regions to separate items, and mark anything uncertain instead of guessing.
- If both an enhanced image and an original image are provided, compare them before extracting math. Use the enhanced image for text contrast, but use the original image to verify fractions, signs, exponents, parentheses, and trig notation.
- If close-up reading views are provided, inspect them before giving up on a blurry full-page photo. They may show the same worksheet in cropped sections or a likely target problem row.
- For trig worksheets, preserve the equation structure exactly. For example, distinguish "csc θ = -5/4 and cot θ > 0" from "csc(θ = -4/3)"; do not move a right-hand-side fraction into a trig function's argument.
- The "message" field is shown directly to the student after upload. Make it conversational and lightweight.
- In "message", briefly identify the actual worksheet context, then ask which problem they want help with.
- Suggested examples in "message" must come only from visible/detected content.
- Do not mention "geometry proof" unless the image actually contains geometry/proofs.
- Do not mention a graph unless a graph, coordinate plane, or plotted curve is visible.
- Do not use random canned examples or subjects that are not present.
- If the image is unclear, say you are not fully sure and ask which number or area to focus on.
- Preserve math using LaTeX when helpful.
- Return JSON only. No markdown outside JSON.

JSON shape:
{
  "message": "short trustworthy summary",
  "confidence": 0.0,
  "needsUserSelection": true,
  "lowConfidenceReason": "optional reason",
  "visualSummary": "what the page/image appears to contain",
  "problems": [
    {
      "id": "problem-1",
      "label": "Problem 1",
      "extractedText": "exact extracted problem text",
      "confidence": 0.0,
      "subject": "Algebra",
      "skills": ["Equation setup"],
      "regionHint": "top left / question 3 / diagram area",
      "visualContext": "diagram/graph/work notes if relevant",
      "needsConfirmation": true
    }
  ]
}
`;

const targetedTutoringPrompt = `
You are StepWise, an adaptive tutor looking at a student's uploaded homework.

Your job:
- Use the student's message to identify the exact referenced problem in the image.
- Examples of references: "#6", "problem 7", "bottom graph", "parabola question", "geometry proof".
- If the student asks whether an answer is correct, answer-checking comes first. Evaluate the submitted answer before tutoring.
- Answer-checking phrases include "is this right?", "is this correct?", "can you check my answer?", "I got...", "my answer is...", and "is the answer...".
- For answer checks, respond with: verdict, one-sentence explanation, optional next choice. Do not enter guided tutoring mode unless the answer is wrong or the student asks for explanation.
- If the answer is correct, do not ask a checkpoint question. Do not say "let's start by..." or "what is the midpoint...". Stop after the concise confirmation and optional offer.
- If the answer is partially correct or wrong, name the specific issue first, then guide only that weak piece.
- If the referenced problem is readable and this is not answer-checking, restate it briefly and start tutoring immediately.
- Do not show OCR confidence, extraction dashboards, or problem lists.
- Do not solve the full problem.
- Do not immediately interrogate the student with a checkpoint question.
- Start like a thoughtful tutor, but stay concise: quick acknowledgement, one immediate goal, then one focused question.
- Reveal one idea at a time. Do not mention secondary concepts until they are needed.
- The student should participate within the first 1-3 tutor sentences.
- Use natural spoken phrasing. Shorten any sentence that sounds like a worksheet.
- Trust the student with simple context. Prefer "What's halfway between -2 and 1?" over longer academic wording.
- Ask about one exact piece at a time. Make the expected action obvious.
- Replace broad prompts like "What should we do next?" or "What would you plug in?" with concrete prompts like "What should h be?" or "What does the left side become?"
- Avoid open-ended planning questions in the first tutoring turns.
- Do not restate all given information if the student already identified the problem. Be brief and move into the useful setup.
- Skip obvious orientation already implied by the formula or setup.
- Remove transition filler. Prefer direct moves like "Use this form:", "The vertex is...", "What should h be?"
- Avoid phrases like "this will help us determine", "the next goal is to", "when you find", and "for the ___ coordinate" unless needed.
- Avoid textbook definitions, formal terminology, derivations, and long explanations unless the student asks.
- Do not test formula memory early. Avoid questions like "What is the general form?" until the student has momentum.
- If a formula or structure is needed, provide enough of it to reduce pressure, then ask the student to apply one small piece.
- Formula scaffolding:
  - If confidence is unclear or this is the first turn, provide the formula/structure first, then ask the student to apply one part.
  - If the student sounds confident, a small recall prompt is okay, but keep it low-pressure.
  - If the student says they forgot or asks for the formula, calmly give it and help them plug in known values.
  - Treat formulas as tools, not a test.
- Before asking a question, check: does this feel like tutoring or testing? If it feels like a memory quiz, scaffold more first.
- Optimize for momentum and confidence. The student should think, "I can do this."
- The one question should feel motivated by the explanation, not like a quiz prompt.
- For focus/directrix parabola problems, ask for the halfway value/vertex first before discussing opening direction, p-values, or standard form.
- If you are not sure which problem the student means, ask a short clarification question.
- If the image is too blurry or the target problem is not readable, say that honestly and ask the student to crop, point to it, or paste the problem.
- If a diagram, graph, or geometry figure is involved, mention the visual context briefly.
- Preserve math with LaTeX when helpful.
- Return JSON only. No markdown outside JSON.
- For answer-checking requests, determine one stable answerEvaluation verdict before writing the message. Do not contradict that verdict in the message.

JSON shape:
{
  "message": "conversational tutor response",
  "currentProblem": "the extracted problem text if confidently identified",
  "confidence": 0.0,
  "needsUserSelection": false,
  "lowConfidenceReason": "optional short reason",
  "visualSummary": "optional brief visual context",
  "answerEvaluation": {
    "verdict": "correct | partially_correct | incorrect | ambiguous",
    "explanation": "one concise sentence",
    "correctPieces": ["short phrase"],
    "incorrectPieces": ["short phrase"],
    "confidence": 0.0,
    "nextAction": "optional short next action"
  },
  "problems": []
}
`;

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          message:
            "I’m having trouble reading uploads right now. Please try again in a moment.",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as AnalyzeHomeworkRequest;
    const fileName = body.fileName?.trim() || "uploaded homework";
    const fileType = body.fileType?.trim() || "";
    const fileDataUrl = body.fileDataUrl ?? "";
    const originalFileDataUrl = body.originalFileDataUrl ?? "";
    const readingViewDataUrls = (body.readingViewDataUrls ?? [])
      .filter((url) => typeof url === "string" && url.startsWith("data:image/"))
      .slice(0, 4);
    const mode = body.mode ?? "extract";
    const targetPrompt = body.targetPrompt?.trim() ?? "";
    const cropRegion = body.cropRegion ?? null;
    const learningProfile = body.learningProfile;
    const conversationHistory = body.conversationHistory ?? [];
    const sessionId = body.sessionId?.trim() || crypto.randomUUID();
    const answerCheckIntent = hasAnswerCheckIntent(targetPrompt);
    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);
    const anonymousUsage = user ? null : checkAnonymousDemoUsage(request);

    if (!fileDataUrl) {
      return NextResponse.json(
        {
          message:
            "I didn’t receive the file. Try uploading the screenshot again, or paste the problem text here.",
        },
        { status: 400 }
      );
    }

    if (!fileType.startsWith("image/")) {
      return NextResponse.json({
        message:
          "I received the file, but this demo works best with PNG or JPG screenshots. Try a screenshot of the page, or paste one problem here.",
        confidence: 0.15,
        needsUserSelection: true,
        lowConfidenceReason:
          "This file type is not supported yet in the demo.",
        visualSummary: "Uploaded file needs a screenshot fallback.",
        problems: [],
      });
    }

    if (user) {
      const usageCheck = await checkUsageLimit({
        userId: user.id,
        eventType: "upload_analysis",
        accessToken,
      });

      if (!usageCheck.allowed) {
        return NextResponse.json(
          {
            message:
              usageCheck.message ||
              "You've reached today's free homework upload limit. Come back later or create an account to keep learning.",
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

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model:
        process.env.OPENAI_VISION_MODEL ??
        process.env.OPENAI_MODEL ??
        "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            mode === "targeted_tutoring"
              ? targetedTutoringPrompt
              : imageAnalysisPrompt,
        },
        ...conversationHistory.slice(-6).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Analyze this uploaded homework image: ${fileName}.
The first image is an enhanced copy optimized for reading. ${
  originalFileDataUrl && originalFileDataUrl !== fileDataUrl
    ? "The second image is the original upload; compare it against the enhanced copy before extracting exact math."
    : "Only one image view is available."
}
${readingViewDataUrls.length ? `Additional close-up reading views are provided after the full-page image(s). Use these crops to read small worksheet text and target problem rows.` : ""}
${cropRegion ? `Focus especially on this selected image region in percentages: ${JSON.stringify(cropRegion)}.` : ""}
${targetPrompt ? `Student wants help with: ${targetPrompt}` : ""}
Answer-checking intent: ${
  answerCheckIntent
    ? "Yes. Evaluate the submitted answer first. Do not begin guided tutoring unless the answer is wrong/close and a targeted correction is needed."
    : "No explicit answer-checking intent."
}

Learning memory:
${JSON.stringify(learningProfile ?? {}, null, 2)}

${mode === "targeted_tutoring"
  ? answerCheckIntent
    ? "Return only valid JSON. If the target problem and submitted answer are clear, give a concise correctness verdict first. Do not ask a guided question after a correct answer. If the target problem is unclear, ask for clarification."
    : "Return only valid JSON. If the target problem is clear, begin tutoring directly with one guided question. If it is not clear, ask for clarification."
  : "Return only valid JSON using the requested schema. Understand the image first. Do not tutor or solve yet."}
`,
            },
            {
              type: "image_url",
              image_url: {
                url: fileDataUrl,
                detail: "high",
              },
            },
            ...(originalFileDataUrl && originalFileDataUrl !== fileDataUrl
              ? [
                  {
                    type: "image_url" as const,
                    image_url: {
                      url: originalFileDataUrl,
                      detail: "high" as const,
                    },
                  },
                ]
              : []),
            ...readingViewDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: {
                url,
                detail: "high" as const,
              },
            })),
          ],
        },
      ],
      temperature: 0.25,
      response_format: { type: "json_object" },
    });

    const rawContent =
      completion.choices[0]?.message.content?.trim() ||
      "";
    const analysis = parseHomeworkAnalysis(
      rawContent,
      answerCheckIntent,
      targetPrompt
    );

    if (user) {
      await recordUsageEvent({
        userId: user.id,
        eventType: "upload_analysis",
        accessToken,
      });

      try {
        await persistWorksheetContext({
          accessToken,
          userId: user.id,
          sessionId,
          fileName,
          fileType,
          analysis,
          targetPrompt,
          cropRegion,
          mode,
        });
      } catch (error) {
        console.error("Worksheet context save error:", error);
      }
    }

    const response = NextResponse.json({
      ...analysis,
      sessionId,
      anonymousUsage: anonymousUsage
        ? {
            used: anonymousUsage.used + 1,
            limit: anonymousUsage.limit,
          }
        : undefined,
    });

    if (anonymousUsage) {
      return addAnonymousDemoUsageCookie(response, anonymousUsage.used + 1);
    }

    return response;
  } catch (error) {
    console.error("Homework analysis API error:", error);

    return NextResponse.json(
      {
        message:
          "I had trouble reading that image. Try uploading a clearer screenshot or crop the specific problem you want help with.",
      },
      { status: 500 }
    );
  }
}

function parseHomeworkAnalysis(
  rawContent: string,
  answerCheckIntent = false,
  targetPrompt = ""
): HomeworkAnalysis {
  try {
    const parsed = JSON.parse(rawContent) as {
      message?: string;
      currentProblem?: string;
      confidence?: number;
      needsUserSelection?: boolean;
      lowConfidenceReason?: string;
      visualSummary?: string;
      answerEvaluation?: Partial<AnswerEvaluation>;
      problems?: Array<{
        id?: string;
        label?: string;
        extractedText?: string;
        confidence?: number;
        subject?: string;
        skills?: string[];
        regionHint?: string;
        visualContext?: string;
        needsConfirmation?: boolean;
      }>;
    };

    const problems = (parsed.problems ?? [])
      .filter((problem) => problem.extractedText?.trim())
      .map((problem, index) => ({
        id: problem.id || `problem-${index + 1}`,
        label: problem.label || `Problem ${index + 1}`,
        extractedText: problem.extractedText?.trim() || "",
        confidence: clampConfidence(problem.confidence),
        subject: problem.subject || "Math",
        skills: Array.isArray(problem.skills) ? problem.skills.slice(0, 4) : [],
        regionHint: problem.regionHint || "Unknown region",
        visualContext: problem.visualContext || "",
        needsConfirmation: problem.needsConfirmation ?? true,
      }));

    const confidence = clampConfidence(parsed.confidence);
    const answerEvaluation =
      parseAnswerEvaluation(parsed.answerEvaluation) ??
      (answerCheckIntent
        ? {
            verdict: "ambiguous" as const,
            explanation:
              "I can see you want the answer checked, but I can’t verify it confidently from the current image.",
            correctPieces: [],
            incorrectPieces: [],
            confidence: 0.35,
            nextAction:
              "Crop #6 or paste the exact problem and answer, and I’ll check it directly.",
          }
        : null);
    const answerCheckMessage =
      answerCheckIntent && answerEvaluation
        ? buildAnswerEvaluationMessage(answerEvaluation, {
            includeExplanation: asksForAnswerExplanation(targetPrompt),
          })
        : "";

    return {
      message:
        answerCheckMessage ||
        parsed.message ||
        (problems.length
          ? "I found one or more possible problems. Please confirm which one you want help with."
          : "I can see part of the worksheet, but not enough to confidently identify the problem. Could you crop the section you want help with?"),
      currentProblem: parsed.currentProblem?.trim() || "",
      confidence,
      needsUserSelection:
        parsed.needsUserSelection ?? (problems.length !== 1 || confidence < 0.82),
      lowConfidenceReason:
        parsed.lowConfidenceReason ||
        (confidence < 0.7
          ? "The image may be unclear, or the problem area may need a tighter crop."
          : ""),
      visualSummary: parsed.visualSummary || "Uploaded homework image.",
      answerEvaluation,
      problems,
    };
  } catch {
    return {
      message:
        "I can see the upload, but not enough to confidently identify the problem. Could you crop the specific problem or paste the text?",
      currentProblem: "",
      confidence: 0.25,
      needsUserSelection: true,
      lowConfidenceReason: "The problem needs a clearer crop or typed text.",
      visualSummary: "Uploaded homework image needs confirmation.",
      answerEvaluation: null,
      problems: [],
    };
  }
}

async function persistWorksheetContext({
  accessToken,
  userId,
  sessionId,
  fileName,
  fileType,
  analysis,
  targetPrompt,
  cropRegion,
  mode,
}: {
  accessToken: string | null;
  userId: string;
  sessionId: string;
  fileName: string;
  fileType: string;
  analysis: HomeworkAnalysis;
  targetPrompt: string;
  cropRegion: CropRegion | null;
  mode: "extract" | "targeted_tutoring";
}) {
  const supabase = createSupabaseServerClient(accessToken);
  const now = new Date().toISOString();
  const primaryProblem =
    analysis.currentProblem ||
    analysis.problems[0]?.extractedText ||
    targetPrompt ||
    "Uploaded worksheet";
  const primaryProblemMeta = analysis.problems[0];
  const { data: existingSession } = await supabase
    .from("learning_sessions")
    .select("tutor_thread, metadata")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  const existingWorksheetContext = getStoredWorksheetContext(existingSession);
  const worksheetContext = mergeWorksheetContexts(existingWorksheetContext, {
    fileName,
    fileType,
    visualSummary: analysis.visualSummary,
    currentProblem: analysis.currentProblem,
    problems: analysis.problems,
    lastTargetPrompt: targetPrompt,
    cropRegion,
    updatedAt: now,
  });

  await supabase.from("learning_sessions").upsert(
    {
      id: sessionId,
      user_id: userId,
      topic: primaryProblemMeta?.subject || "Uploaded homework",
      subtopic: primaryProblemMeta?.skills?.[0] ?? null,
      status: "active",
      current_problem: primaryProblem,
      pinned_problem: primaryProblem,
      uploaded_assets: [
        {
          id: `worksheet-${sessionId}`,
          fileName,
          fileType,
          uploadedAt: now,
          visualSummary: analysis.visualSummary,
          problemCount: analysis.problems.length,
          source: "homework_upload",
        },
      ],
      tutor_thread: {
        source: "homework_upload",
        worksheetContext,
      },
      metadata: {
        mode,
        worksheetContext,
      },
      last_message_at: now,
      updated_at: now,
    },
    { onConflict: "id" }
  );
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

function normalizeWorksheetContext(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const context = value as Partial<{
    fileName: string;
    fileType: string;
    visualSummary: string;
    currentProblem: string;
    problems: DetectedHomeworkProblem[];
    lastTargetPrompt: string;
    cropRegion: CropRegion | null;
    updatedAt: string;
  }>;
  const problems = Array.isArray(context.problems)
    ? context.problems
        .filter((problem) => problem?.extractedText?.trim())
        .slice(0, 20)
    : [];

  if (!problems.length && !context.currentProblem && !context.visualSummary) {
    return null;
  }

  return {
    fileName: context.fileName ?? "",
    fileType: context.fileType ?? "",
    visualSummary: context.visualSummary ?? "",
    currentProblem: context.currentProblem ?? "",
    problems,
    lastTargetPrompt: context.lastTargetPrompt ?? "",
    cropRegion: context.cropRegion ?? null,
    updatedAt: context.updatedAt ?? "",
  };
}

function mergeWorksheetContexts(
  currentContext: ReturnType<typeof normalizeWorksheetContext>,
  incomingContext: NonNullable<ReturnType<typeof normalizeWorksheetContext>>
) {
  if (!currentContext) return incomingContext;

  return {
    ...currentContext,
    ...incomingContext,
    visualSummary: incomingContext.visualSummary || currentContext.visualSummary,
    currentProblem: incomingContext.currentProblem || currentContext.currentProblem,
    problems: mergeWorksheetProblems(
      currentContext.problems,
      incomingContext.problems
    ),
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

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function clampConfidence(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;

  return Math.max(0, Math.min(1, value));
}

function parseAnswerEvaluation(
  value?: Partial<AnswerEvaluation>
): AnswerEvaluation | null {
  if (!value) return null;

  const verdicts: AnswerEvaluationVerdict[] = [
    "correct",
    "partially_correct",
    "incorrect",
    "ambiguous",
  ];

  return {
    verdict: verdicts.includes(value.verdict as AnswerEvaluationVerdict)
      ? (value.verdict as AnswerEvaluationVerdict)
      : "ambiguous",
    explanation:
      typeof value.explanation === "string" && value.explanation.trim()
        ? value.explanation.trim()
        : "I can’t verify that confidently from the image.",
    correctPieces: Array.isArray(value.correctPieces)
      ? value.correctPieces.filter((piece) => typeof piece === "string").slice(0, 3)
      : [],
    incorrectPieces: Array.isArray(value.incorrectPieces)
      ? value.incorrectPieces.filter((piece) => typeof piece === "string").slice(0, 3)
      : [],
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.5,
    nextAction: typeof value.nextAction === "string" ? value.nextAction.trim() : "",
  };
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
