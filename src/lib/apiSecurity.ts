// Runtime guards for untrusted API input. These complement authentication
// and usage limits; they do not prevent direct scripted API abuse.

export type SanitizedMessage = {
  role: "user" | "assistant";
  content: string;
};

// Bounds for client-controlled prompt inputs. Values are generous for
// legitimate use (a pasted problem, a worksheet extract, a homework photo)
// and far below what an abuse request would send.
export const MAX_HISTORY_ENTRIES = 20;
export const MAX_HISTORY_CONTENT_CHARS = 1500;
export const MAX_PROBLEM_CHARS = 8000;
export const MAX_WORKSHEET_TEXT_CHARS = 4000;
export const MAX_WORKSHEET_SUMMARY_CHARS = 2000;
export const MAX_PRACTICE_FIELD_CHARS = 500;
export const MAX_SIGNAL_STRING_CHARS = 500;
export const MAX_MEMORY_STRING_CHARS = 500;
export const MAX_IMAGE_DATA_URL_CHARS = 4_000_000; // ~3MB of binary, base64
export const MAX_TARGET_PROMPT_CHARS = 4000;
export const MAX_FILE_NAME_CHARS = 200;
export const MAX_FEEDBACK_MESSAGE_CHARS = 2000;
export const MAX_FEEDBACK_JSON_CHARS = 8000;

/** Truncate a string to at most `maxChars` characters. */
export function truncateText(text: unknown, maxChars: number): string {
  if (typeof text !== "string") return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Keep only real conversation turns. Drops anything that is not a
 * `{ role: "user" | "assistant", content: string }` object — in particular
 * injected `role: "system"` / `"developer"` / `"tool"` entries, which must
 * never reach the model as privileged messages. Truncates each message and
 * keeps only the most recent entries.
 */
export function sanitizeConversationHistory(value: unknown): SanitizedMessage[] {
  if (!Array.isArray(value)) return [];

  const kept: SanitizedMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    kept.push({ role, content: truncateText(trimmed, MAX_HISTORY_CONTENT_CHARS) });
  }

  return kept.slice(-MAX_HISTORY_ENTRIES);
}

/** Compare complete origins. Never trust client-supplied forwarding headers.
 * Headerless non-browser clients remain supported; this is not authentication.
 */
export function isAllowedRequestOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  const source = origin ?? request.headers.get("referer");
  if (source === null) return true;
  try {
    const parsed = new URL(source);
    if (!["https:", "http:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    if (origin !== null && (parsed.pathname !== "/" || parsed.search || parsed.hash)) return false;
    const destination = new URL(request.url);
    // Next may construct request.url with an internal server hostname.
    // Host reflects the browser's destination; browsers cannot override it.
    // Do not accept X-Forwarded-Host as an alternate allowed origin.
    const host = request.headers.get("host");
    if (host) {
      if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host)) return false;
      return parsed.origin === new URL(`${destination.protocol}//${host}`).origin;
    }
    return parsed.origin === destination.origin;
  } catch {
    return false;
  }
}

/**
 * Validate an uploaded image data URL. The upload routes must never pass an
 * arbitrary URL to the vision model: only `data:image/...` URLs produced by
 * the client (FileReader / canvas) are accepted, with a size cap. An
 * `https://` URL here would make OpenAI fetch an attacker-chosen address.
 */
export function isValidImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > MAX_IMAGE_DATA_URL_CHARS) return false;
  // Only the raster formats emitted by the upload pipeline. Reject empty,
  // non-base64, SVG, and remote URL payloads before contacting the model.
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return Boolean(match && match[1].length % 4 === 0);
}

export type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Validate a client-supplied crop region (percentages). Anything malformed
 * is dropped (null) rather than interpolated into the prompt.
 */
export function sanitizeCropRegion(value: unknown): CropRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const region = value as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"].map((key) => region[key]);
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (!numbers.every((n) => (n as number) >= 0 && (n as number) <= 100)) return null;
  const [x, y, width, height] = numbers as number[];
  if (width <= 0 || height <= 0 || x + width > 100.000001 || y + height > 100.000001) return null;
  return { x, y, width, height };
}

/**
 * Deep-truncate an arbitrary JSON value (diagnostic blobs such as the
 * feedback `context` / `browser` fields): long strings are cut, arrays are
 * capped, objects are capped by key count, and depth is bounded so a
 * hostile nested payload cannot blow up the stored row.
 */
export function truncateJsonValue(value: unknown, maxStringChars = 1000): unknown {
  // A shared serialized-size budget bounds wide trees as well as deep ones.
  let remaining = MAX_FEEDBACK_JSON_CHARS;
  function visit(input: unknown, depth: number): unknown {
    if (remaining < 4) return null;
    if (typeof input === "string") {
      let text = truncateText(input, Math.min(maxStringChars, remaining));
      while (JSON.stringify(text).length > remaining) text = text.slice(0, Math.floor(text.length / 2));
      remaining -= JSON.stringify(text).length;
      return text;
    }
    if (input === null || typeof input !== "object") {
      const primitive = typeof input === "number" || typeof input === "boolean" ? input : null;
      const size = JSON.stringify(primitive).length;
      if (size > remaining) { remaining -= 4; return null; }
      remaining -= size;
      return primitive;
    }
    const array = Array.isArray(input);
    remaining -= 2;
    const output: Record<string, unknown> = {};
    const list: unknown[] = [];
    if (depth > 4) return array ? list : output;
    const entries = array ? input.slice(0, 20).map((v, i) => [String(i), v] as const) : Object.entries(input).slice(0, 50);
    for (const [key, entry] of entries) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      const safeKey = truncateText(key, 100);
      const overhead = array ? 1 : JSON.stringify(safeKey).length + 2;
      if (remaining < overhead + 4) break;
      remaining -= overhead;
      const result = visit(entry, depth + 1);
      if (array) list.push(result);
      else output[safeKey] = result;
    }
    return array ? list : output;
  }
  return visit(value, 0);
}

export class ApiInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Bound the actual body stream, including requests without Content-Length. */
export async function readJsonObject(
  request: Request,
  maxBytes = 256_000,
  stringFields: string[] = []
): Promise<Record<string, unknown>> {
  const tooLarge = () => new ApiInputError("This upload or message is too large. Try a smaller image or shorter text.", 413);
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ApiInputError("Please provide a JSON request.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiInputError("Please provide valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiInputError("Please provide a JSON object.");
  const record = body as Record<string, unknown>;
  for (const field of stringFields) {
    if (record[field] !== undefined && typeof record[field] !== "string") throw new ApiInputError(`Invalid text field: ${field}.`);
  }
  return record;
}

export function requireTextWithinLimit(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ApiInputError("Please provide text for the problem.");
  if (value.length > maxChars) throw new ApiInputError("That problem or answer is too long. Send one shorter problem at a time.");
  return value.trim();
}

/** Validate memory before downstream code uses array/string methods on it. */
export function validateLearningProfile(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) throw new ApiInputError("Invalid learning profile.");
  if (JSON.stringify(value).length > 64_000) throw new ApiInputError("Learning history is too large. Start a new session.");
  const profile = value as Record<string, unknown>;
  const stringLists = ["recentConcepts", "conceptsNeedingReinforcement", "recurringMistakes", "strongSkills", "formulaConfusions", "setupMistakes", "conceptualMisunderstandings", "recentRecommendations", "spacedReviewQueue", "practiceTemplates", "subjectsStudied", "tutoringStateHistory"];
  const strings = ["currentSubject", "independenceLevel", "preferredTutoringStyle", "pacingPreference", "reasoningQuality", "lastReflection", "hintUsageFrequency", "difficultyComfortLevel", "confidenceLevel", "lastUpdated"];
  const isStringList = (input: unknown) => Array.isArray(input) && input.every((entry) => typeof entry === "string");
  const invalid = () => { throw new ApiInputError("Invalid learning profile."); };
  for (const key of strings) if (profile[key] !== undefined && typeof profile[key] !== "string") invalid();
  for (const key of stringLists) if (profile[key] !== undefined && !isStringList(profile[key])) invalid();
  if (profile.completedProblems !== undefined && typeof profile.completedProblems !== "number") invalid();
  if (profile.confidenceByTopic !== undefined && (!profile.confidenceByTopic || typeof profile.confidenceByTopic !== "object" || Array.isArray(profile.confidenceByTopic) || !Object.values(profile.confidenceByTopic).every((v) => typeof v === "string"))) invalid();
  for (const key of ["problemHistory", "skillMastery"]) {
    const entries = profile[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) { invalid(); continue; }
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) { invalid(); continue; }
      if (key === "problemHistory") {
        for (const field of ["id", "topic", "subtopic", "problemType", "difficulty", "source", "extractedText", "completionStatus", "lastPracticedAt"]) {
          if (typeof entry[field] !== "string") invalid();
        }
        if (!isStringList(entry.mistakesMade) || !isStringList(entry.finalSolutionPath) || typeof entry.hintsUsed !== "number" || typeof entry.solvedIndependently !== "boolean") invalid();
        if (!Array.isArray(entry.interactionHistory) || !entry.interactionHistory.every((turn: Record<string, unknown>) => turn && ["student", "tutor"].includes(String(turn.role)) && typeof turn.content === "string" && typeof turn.createdAt === "string")) invalid();
      } else if (typeof entry.skill !== "string" || typeof entry.level !== "string" || typeof entry.evidenceCount !== "number" || typeof entry.lastPracticedAt !== "string") invalid();
    }
  }
}

export function sanitizeTutoringSignals(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  for (const key of ["hintRequests", "attemptCount", "incorrectAttempts", "conversationTurns"]) {
    const n = input[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[key] = Math.min(Math.floor(n), 10000);
  }
  for (const key of ["activeConfusionSignal", "completionSignal", "fullAttemptSignal", "confidentAttemptSignal", "answerCheckSignal", "requestedPracticeSignal"]) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  if (typeof input.lastTutorMode === "string" && ["hint", "check_work", "next_step", "generate_practice", "general"].includes(input.lastTutorMode)) out.lastTutorMode = input.lastTutorMode;
  return out;
}
