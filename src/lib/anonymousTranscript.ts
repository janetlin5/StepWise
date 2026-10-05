export const anonymousTranscriptKey = "stepwise:demo:transcript:v1";
export type AnonymousTranscript = {
  version: 1;
  sessionId: string;
  messages: { id: number; role: "user" | "assistant"; content: string }[];
  currentProblem: string;
  problem: string;
  draft: string;
};

export function readAnonymousTranscript(storage: Pick<Storage, "getItem">): AnonymousTranscript | null {
  try {
    const raw = storage.getItem(anonymousTranscriptKey);
    if (!raw || raw.length > 1000000) return null;
    const p = JSON.parse(raw);
    if (p?.version !== 1 || typeof p.sessionId !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(p.sessionId) ||
      !Array.isArray(p.messages) || p.messages.length > 100 ||
      !p.messages.every((m: AnonymousTranscript["messages"][number]) => m && Number.isFinite(m.id) &&
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 30000)) return null;
    return { version: 1, sessionId: p.sessionId, messages: p.messages,
      currentProblem: typeof p.currentProblem === "string" ? p.currentProblem : "",
      problem: typeof p.problem === "string" ? p.problem : typeof p.currentProblem === "string" ? p.currentProblem : "",
      draft: typeof p.draft === "string" ? p.draft : "" };
  } catch { return null; }
}

export function writeAnonymousTranscript(storage: Pick<Storage, "setItem">, transcript: AnonymousTranscript) {
  try {
    const text = JSON.stringify({ ...transcript, messages: transcript.messages.slice(-100) });
    if (text.length <= 1000000) storage.setItem(anonymousTranscriptKey, text);
  } catch { /* Storage restrictions must not prevent tutoring. */ }
}

export function clearAnonymousTranscript(storage: Pick<Storage, "removeItem">) {
  try { storage.removeItem(anonymousTranscriptKey); } catch { /* Storage may be unavailable. */ }
}
