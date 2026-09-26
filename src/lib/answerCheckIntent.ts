export function hasAnswerCheckIntent(text: string) {
  return hasProposedNumericAnswer(text) || /check (?:my )?(?:answer|work)|can you check|verify|did i get (?:this|it)?\s*right|is (?:this|that|it|my answer|the answer)(?:\b|[^a-z])|is (?:the\s+)?answer\s+(?:for|to)\s+#?\d+[a-z]?|is this (?:right|correct)|is my answer|does this (?:work|look right)|would this be|my answer is|answer is|i got|final answer|correct\?/i.test(
    text
  );
}

/** Short verification questions containing an actual proposed numeric value. */
export function hasProposedNumericAnswer(text: string) {
  const normalized = text
    .replace(/[−–—]/g, "-")
    .replace(/\\[()[\]]|\$\$/g, " ");
  return /\bis\s+the\s+(?:answer|result|value|solution|vertex|focus|directrix|center|radius|diameter|slope|intercept|x-intercept|y-intercept|probability|derivative|integral|area|perimeter|volume)(?:\s+of\s+the\s+[a-z]+)*\s*(?:=\s*)?(?:\(\s*)?(?:[xy]\s*=\s*)?[+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)(?=$|[\s,)?!.;\/])/i.test(normalized);
}
