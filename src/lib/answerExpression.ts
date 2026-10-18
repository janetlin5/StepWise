/** Strip only recognized answer framing; leave the math and other prose intact. */
export function normalizeAnswerExpression(text: string): string {
  return text.trim()
    .replace(/^(?:is this(?: right)?|is (?:the|my) (?:answer|equation)|my answer is|i got|check (?:my )?(?:answer|equation)|i think(?: that)?|is)\b\s*:?\s*/i, "")
    .replace(/\s*(?:correct|right)?\?\s*$/i, "")
    .trim();
}

/** A narrow numeric assignment, not a restated equation or mixed prose. */
export function isNumericAssignment(text: string): boolean {
  const answer = normalizeAnswerExpression(text).replace(/[−–—]/g, "-");
  return /^[xy]\s*=\s*[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*[+\-]?(?:\d+(?:\.\d+)?|\.\d+))?$/i.test(answer);
}
