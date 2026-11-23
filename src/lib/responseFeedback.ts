/** Reports are student-supplied evidence, never authority to load a session. */
export type ResponseReport = {
  kind: "tutor_response";
  messageId: string;
  sessionId: string;
  response: string;
  studentMessage: string;
  problem: string;
};
const bounded = (value: unknown, max: number) => typeof value === "string"
  ? value.replace(/data:[^\s]+/gi, "[attachment omitted]").slice(0, max) : "";
export function sanitizeResponseReport(value: unknown): ResponseReport | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== "tutor_response" || typeof v.response !== "string" || !v.response.trim()) return null;
  return { kind: "tutor_response", messageId: bounded(v.messageId, 100),
    sessionId: bounded(v.sessionId, 100), response: bounded(v.response, 5000),
    studentMessage: bounded(v.studentMessage, 2000), problem: bounded(v.problem, 4000) };
}
export function buildResponseReport(messages: { id: number; role: string; content: string; problem?: string }[], id: number, sessionId: string) {
  const index = messages.findIndex(m => m.id === id && m.role === "assistant");
  if (index < 0) return null;
  const selected = messages[index];
  const previous = messages.slice(0, index).reverse().find(m => m.role === "user");
  return sanitizeResponseReport({ kind: "tutor_response", messageId: String(id), sessionId,
    response: selected.content, studentMessage: previous?.content ?? "", problem: selected.problem ?? "" });
}
