import type OpenAI from "openai";

export type CoordinateEvaluation = {
  verdict: "correct" | "partially_correct" | "incorrect" | "ambiguous";
  explanation: string;
  correctPieces: string[];
  incorrectPieces: string[];
  confidence: number;
  nextAction: string;
  expectedAnswer?: { answerType: "point"; coordinates: string[] };
};

function normalize(text: string) {
  return text.replace(/[−–—]/g, "-")
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\[()[\]]|\$/g, "")
    .replace(/\\(?:d?frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2");
}

export function isCoordinateCheck(text: string) {
  if (/\b(?:interval|domain|range|vector)\b/i.test(text)) return false;
  return /\([^()]*,[^()]*\)/.test(normalize(text)) ||
    /\b(?:vertex|focus|center|point|coordinates)\b/i.test(text);
}

/** Only pass the requested mathematical object and problem number to a solver. */
export function coordinateTarget(text: string) {
  const object = text.match(/\b(vertex|focus|center|point|coordinates)\b/i)?.[1]?.toLowerCase();
  const number = text.match(/(?:#|\bproblem\s*|\bquestion\s*)\s*(\d+[a-z]?)/i)?.[1];
  return [object ? `Find the ${object}.` : "Find the answer requested by the problem.",
    number ? `Use problem #${number}.` : "Use the single active problem; if unclear, request clarification."].join(" ");
}

function rational(value: string): [bigint, bigint] | null {
  if (value.length > 100) return null;
  const parts = normalize(value).trim().split("/");
  if (parts.length > 2) return null;
  const decimal = (part: string): [bigint, bigint] | null => {
    const s = part.trim().replace(/^([+-])\s+/, "$1");
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
    const decimals = s.split(".")[1]?.length ?? 0;
    return [BigInt(s.replace(".", "")), BigInt(10) ** BigInt(decimals)];
  };
  const numerator = decimal(parts[0]);
  const denominator = parts.length === 2 ? decimal(parts[1]) : [BigInt(1), BigInt(1)];
  if (!numerator || !denominator || denominator[0] === BigInt(0)) return null;
  return [numerator[0] * denominator[1], numerator[1] * denominator[0]];
}

export function parseSubmittedPoint(text: string): string[] | null {
  const normalized = normalize(text);
  if (/\b(?:given|either|or|but)\b/i.test(normalized)) return null;
  const pairs = [...normalized.matchAll(/\(([^()]*)\)/g)].filter(match => match[1].includes(","));
  // Do not guess which of several givens, alternatives, or attempts is the answer.
  if (pairs.length !== 1) return null;
  const point = pairs[0][1].split(",").map(value => value.trim());
  if (point.length !== 2 || !point.every(value => rational(value))) return null;
  // A point inside a larger equation is not necessarily the submitted answer.
  if (/\)\s*(?:\^|[+*/]|-\s*\d)/.test(normalized)) return null;
  return point;
}

export function ambiguousCoordinate(reason = "Please provide one clear coordinate pair and the exact problem."): CoordinateEvaluation {
  return { verdict: "ambiguous", explanation: "I can’t verify this coordinate answer confidently yet.",
    correctPieces: [], incorrectPieces: [], confidence: 0, nextAction: reason };
}

export function comparePointAnswer(expected: unknown, submitted: string[]): CoordinateEvaluation {
  if (!Array.isArray(expected) || expected.length !== 2 || !expected.every(v => typeof v === "string" && rational(v))) {
    return ambiguousCoordinate("Please confirm the problem so I can compute its coordinates reliably.");
  }
  const matches = expected.map((value, index) => {
    const a = rational(value)!;
    const b = rational(submitted[index]);
    return !!b && a[0] * b[1] === b[0] * a[1];
  });
  const labels = ["x-coordinate", "y-coordinate"];
  const correctPieces = labels.filter((_, i) => matches[i]);
  const incorrectPieces = labels.filter((_, i) => !matches[i]);
  const all = matches.every(Boolean);
  const one = matches.some(Boolean);
  let explanation = all ? "Both coordinates match the computed point." : "Neither coordinate matches the computed point.";
  if (one) {
    const wrong = matches[0] ? 1 : 0;
    const a = rational(expected[wrong])!;
    const b = rational(submitted[wrong])!;
    const signSlip = a[0] * b[1] === -b[0] * a[1];
    explanation = `The ${labels[1 - wrong]} is right; check ${signSlip ? "the sign of " : ""}the ${labels[wrong]}.`;
  }
  return { verdict: all ? "correct" : one ? "partially_correct" : "incorrect", explanation,
    correctPieces, incorrectPieces, confidence: 1, nextAction: all ? "" : "Try correcting that coordinate pair.",
    expectedAnswer: { answerType: "point", coordinates: expected } };
}

/** The solver never receives the submitted point or conversation history. */
export async function evaluateCoordinateAnswer({ openai, problem, studentMessage }: {
  openai: OpenAI; problem: string; studentMessage: string;
}): Promise<CoordinateEvaluation | null> {
  if (!isCoordinateCheck(studentMessage)) return null;
  const submitted = parseSubmittedPoint(studentMessage);
  if (!submitted) return ambiguousCoordinate();
  if (!problem.trim() || problem.trim() === studentMessage.trim()) return ambiguousCoordinate();
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0,
      max_completion_tokens: 350,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Solve the specified original problem independently. Ignore any proposed answers or student work embedded in the problem. Do not grade or compare answers. Return JSON only: {"answerType":"point|other|ambiguous","expected":["exact x value","exact y value"]}. Use point only for one uniquely determined ordered pair, not intervals, vectors, multiple solutions, or equations. Values must be exact signed integers, decimals, or fractions; use ambiguous if exact values cannot be expressed in those forms, the problem is incomplete, the requested object is unclear, or several problems could apply. Preserve signs. Do not return a correctness verdict.` },
        { role: "user", content: `${coordinateTarget(studentMessage)}\nOriginal problem:\n${problem}` },
      ],
    });
    const result = JSON.parse(completion.choices[0]?.message.content ?? "");
    if (result.answerType !== "point") return ambiguousCoordinate();
    return comparePointAnswer(result.expected, submitted);
  } catch {
    return ambiguousCoordinate("I couldn’t compute the expected point reliably. Please try again or clarify the problem.");
  }
}
