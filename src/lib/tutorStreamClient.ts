export type TutorStreamMeta = {
  sessionId?: string;
  anonymousUsage?: { used: number; limit: number };
};

export class TutorStreamError extends Error {
  constructor(public readonly answerComplete: boolean) {
    super(answerComplete
      ? "I finished the answer, but couldn’t confirm it was saved. Please keep this page open."
      : "I lost the connection before the answer finished. The text above may be incomplete. You can send your question again.");
  }
}

/** A transport EOF is only successful after an explicit done event. */
export async function readTutorStream(response: Response, handlers: {
  onMeta: (meta: TutorStreamMeta) => void;
  onToken: (text: string) => void;
  onAnswerComplete: (text: string) => void;
}, idleTimeoutMs = 20000) {
  const reader = response.body?.getReader();
  if (!reader) throw new TutorStreamError(false);
  const decoder = new TextDecoder();
  const deadline = Date.now() + 120000;
  let buffer = "";
  let answerComplete = false;
  let complete = false;
  try {
    while (!complete) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new TutorStreamError(answerComplete)), Math.max(0, Math.min(idleTimeoutMs, deadline - Date.now())));
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) throw new TutorStreamError(answerComplete);
      buffer += decoder.decode(result.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const match = frame.match(/^event: ([a-z_]+)\ndata: ([\s\S]*)$/);
        if (!match) throw new TutorStreamError(answerComplete);
        const data = JSON.parse(match[2]);
        switch (match[1]) {
          case "meta": handlers.onMeta(data); break;
          case "heartbeat": break;
          case "token":
            if (answerComplete || typeof data.text !== "string") throw new TutorStreamError(answerComplete);
            handlers.onToken(data.text);
            break;
          case "answer_complete":
            if (answerComplete || typeof data.text !== "string" || !data.text.trim()) throw new TutorStreamError(answerComplete);
            answerComplete = true;
            handlers.onAnswerComplete(data.text);
            break;
          case "done":
            if (!answerComplete) throw new TutorStreamError(false);
            complete = true;
            break;
          case "error": throw new TutorStreamError(answerComplete);
          default: throw new TutorStreamError(answerComplete);
        }
        if (complete) break;
      }
    }
  } catch {
    throw new TutorStreamError(answerComplete);
  } finally {
    // Cancel a pending read on idle timeout, and stop reading after done.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
