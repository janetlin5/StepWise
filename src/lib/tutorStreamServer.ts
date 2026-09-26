type Chunk = {
  choices: { delta: { content?: string | null }; finish_reason?: string | null }[];
};

/** Keep the response alive through persistence; never replay generation. */
export function createTutorStream({ generate, persist, meta, onStage, heartbeatMs = 5000 }: {
  generate: (signal: AbortSignal) => Promise<AsyncIterable<Chunk>>;
  persist: (message: string) => Promise<void>;
  meta: unknown;
  onStage: (stage: string) => void;
  heartbeatMs?: number;
}) {
  const abort = new AbortController();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let answerComplete = false;
      try {
        send("meta", meta);
        heartbeat = setInterval(() => send("heartbeat", {}), heartbeatMs);
        const stream = await generate(abort.signal);
        let text = "";
        let finishReason: string | null | undefined;
        for await (const chunk of stream) {
          if (cancelled) return;
          const choice = chunk.choices[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const token = choice?.delta.content;
          if (token) {
            if (!text) onStage("first_token");
            text += token;
            send("token", { text: token });
          }
        }
        // EOF or a token limit is not a successfully completed answer.
        if (finishReason !== "stop" || !text.trim()) throw new Error("Incomplete generation");
        onStage("generation_complete");
        answerComplete = true;
        send("answer_complete", { text: text.trim() });
        await persist(text.trim());
        send("done", {});
        onStage("done");
      } catch {
        onStage(cancelled ? "cancelled" : answerComplete ? "save_failed" : "generation_failed");
        send("error", { phase: answerComplete ? "saving" : "generation" });
      } finally {
        clearInterval(heartbeat);
        abort.abort();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      clearInterval(heartbeat);
      abort.abort();
    },
  });
}
