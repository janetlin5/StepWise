import type OpenAI from "openai";
import type { CoordinateEvaluation } from "./coordinateGrading";

type Q = [bigint, bigint];
type Poly = Map<string, Q>;
const zero: Q = [BigInt(0), BigInt(1)];
const one: Q = [BigInt(1), BigInt(1)];
function q(n: bigint, d = BigInt(1)): Q {
  if (!d) throw Error("Division by zero");
  let a = n < 0 ? -n : n, b = d < 0 ? -d : d;
  while (b) [a, b] = [b, a % b];
  const g = a || BigInt(1);
  return d < 0 ? [-n / g, -d / g] : [n / g, d / g];
}
const add = (a: Q, b: Q) => q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q) => q(a[0] * b[0], a[1] * b[1]);
const neg = (a: Q): Q => [-a[0], a[1]];
function sum(a: Poly, b: Poly, negative = false): Poly {
  const out = new Map(a);
  for (const [key, value] of b) out.set(key, add(out.get(key) ?? zero, negative ? neg(value) : value));
  return new Map([...out].filter(([, value]) => value[0] !== BigInt(0)));
}
function product(a: Poly, b: Poly): Poly {
  let out: Poly = new Map();
  for (const [ak, av] of a) for (const [bk, bv] of b) {
    const [ax, ay] = ak.split(',').map(Number), [bx, by] = bk.split(',').map(Number);
    if (ax + ay + bx + by > 2) throw Error("Unsupported degree");
    out = sum(out, new Map([[`${ax + bx},${ay + by}`, mul(av, bv)]]));
  }
  return out;
}

function normalize(text: string) {
  let s = text.replace(/[−–—]/g, '-').replace(/²/g, '^2').replace(/[×·]/g, '*')
    .replace(/\\(?:left|right)/g, '').replace(/\\[()[\]]|\$/g, '')
    .replace(/\\(?:cdot|times)/g, '*').replace(/\^\{([012])\}/g, '^$1');
  // Expand innermost LaTeX fractions, preserving grouping in both operands.
  for (let i = 0; i < 8 && /\\(?:d?frac)/.test(s); i++) {
    s = s.replace(/\\(?:d?frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
  }
  return s.replace(/\^\{([012])\}/g, '^$1').replace(/[{}]/g, m => m === '{' ? '(' : ')');
}

/** A deliberately small parser: exact rational coefficients, x/y, degree <= 2.
 * No eval, variable denominators, roots, functions, or guessed OCR repairs.
 */
function parseEquation(text: string): Poly {
  const s = normalize(text);
  if (s.length > 1000 || !/^[\s\d.xy+*/^()=\-]+$/.test(s)) throw Error("Unsupported notation");
  const tokens = s.match(/\d+(?:\.\d+)?|\.\d+|[xy+*/^()=\-]/g) ?? [];
  // Reject whitespace inside numeric literals, stray decimal points, etc.
  if (tokens.join('') !== s.replace(/\s/g, '')) throw Error("Invalid tokens");
  let i = 0;
  const constant = (v: Q): Poly => new Map(v[0] ? [['0,0', v]] : []);
  function atom(): Poly {
    const t = tokens[i++];
    if (t === '(') { const value = expression(); if (tokens[i++] !== ')') throw Error("Unclosed group"); return value; }
    if (t === 'x' || t === 'y') return new Map([[t === 'x' ? '1,0' : '0,1', one]]);
    if (!t || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(t) || t.length > 60) throw Error("Invalid atom");
    return constant(q(BigInt(t.replace('.', '')), BigInt(10) ** BigInt(t.split('.')[1]?.length ?? 0)));
  }
  function power(): Poly {
    const base = atom();
    if (tokens[i] !== '^') return base;
    i++;
    const exponent = tokens[i++];
    if (!['0', '1', '2'].includes(exponent)) throw Error("Unsupported exponent");
    return exponent === '0' ? constant(one) : exponent === '1' ? base : product(base, base);
  }
  function unary(): Poly {
    if (tokens[i] === '+') { i++; return unary(); }
    if (tokens[i] === '-') { i++; return product(constant(neg(one)), unary()); }
    return power();
  }
  function term(): Poly {
    let value = unary();
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === '*' || t === '/') {
        i++;
        const right = unary();
        if (t === '*') value = product(value, right);
        else {
          if (right.size !== 1 || !right.has('0,0')) throw Error("Nonconstant divisor");
          const v = right.get('0,0')!;
          value = product(value, constant(q(v[1], v[0])));
        }
      } else if (t === 'x' || t === 'y' || t === '(') value = product(value, power());
      else break;
    }
    return value;
  }
  function expression(): Poly {
    let value = term();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const negative = tokens[i++] === '-';
      value = sum(value, term(), negative);
    }
    return value;
  }
  const left = expression();
  if (tokens[i++] !== '=') throw Error("Missing equals");
  const right = expression();
  if (i !== tokens.length) throw Error("Trailing input");
  const result = sum(left, right, true);
  if (!result.size || ![...result.keys()].some(k => k !== '0,0')) throw Error("No unique relation");
  return result;
}

export function submittedEquation(text: string): string | null {
  const s = text.trim().replace(/^(?:is this(?: right)?|is (?:the|my) (?:answer|equation)|my answer is|i got|check (?:my )?(?:answer|equation))\s*:?\s*/i, '').replace(/\s*(?:correct|right)?\?\s*$/i, '').trim();
  try { parseEquation(s); return s; } catch { return null; }
}

function realEllipse(p: Poly) {
  if (p.has('1,1')) return false;
  const a = p.get('2,0'), c = p.get('0,2');
  if (!a || !c || a[0] * c[0] <= 0) return false;
  const d = p.get('1,0') ?? zero, e = p.get('0,1') ?? zero;
  const quotientSquare = (v: Q, base: Q) => mul(mul(v, v), q(base[1], BigInt(4) * base[0]));
  const rhs = add(add(neg(p.get('0,0') ?? zero), quotientSquare(d, a)), quotientSquare(e, c));
  return rhs[0] * a[0] > 0;
}

/** true proves equivalence. false is reserved for distinct real ellipses or lines.
 * Other non-proportional relations remain unsupported, never guessed unequal.
 */
export function equationsEquivalent(expected: string, submitted: string): boolean | null {
  try {
    const a = parseEquation(expected), b = parseEquation(submitted);
    const [key, coefficient] = [...a][0];
    const other = b.get(key);
    if (other && a.size === b.size && [...a].every(([k, v]) => {
      const w = b.get(k);
      return !!w && add(mul(v, other), neg(mul(w, coefficient)))[0] === BigInt(0);
    })) return true;
    const line = (p: Poly) => [...p.keys()].every(k => ['0,0', '1,0', '0,1'].includes(k));
    return (realEllipse(a) && realEllipse(b)) || (line(a) && line(b)) ? false : null;
  } catch { return null; }
}

export function equationTarget(text: string) {
  const number = text.match(/(?:#|\bproblem\s*|\bquestion\s*)\s*(\d+[a-z]?)/i)?.[1];
  return `Find the requested equation or an equivalent reformulation of the original equation.${number ? ` Use problem #${number}.` : ''}`;
}

export async function evaluateEquationAnswer({ openai, problem, studentMessage }: {
  openai: OpenAI; problem: string; studentMessage: string;
}): Promise<CoordinateEvaluation | null> {
  const submitted = submittedEquation(studentMessage);
  if (!submitted) return null;
  const ambiguous = (): CoordinateEvaluation => ({ verdict: 'ambiguous', explanation: 'I can’t verify this equation confidently from the current problem.', correctPieces: [], incorrectPieces: [], confidence: 0, nextAction: 'Please confirm the exact original problem.' });
  if (!problem.trim() || problem.trim() === studentMessage.trim()) return ambiguous();
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', temperature: 0, max_completion_tokens: 350,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Independently determine the expected equation from the original problem, ignoring student attempts or proposed answers in the context. If an equation is already given, return that original relation so an equivalent intermediate reformulation can be checked; do not require a completed full solution. If asked to construct an equation from givens, compute it. Return JSON only: {"answerType":"equation|ambiguous","expected":"equation using x, y, rational coefficients, parentheses, ^2, and ="}. Do not grade or return a verdict. Use ambiguous if the intended problem cannot be identified.' },
        { role: 'user', content: `${equationTarget(studentMessage)}\nOriginal problem:\n${problem}` },
      ],
    });
    const result = JSON.parse(response.choices[0]?.message.content ?? '');
    if (result.answerType !== 'equation' || typeof result.expected !== 'string') return ambiguous();
    const equivalent = equationsEquivalent(result.expected, submitted);
    if (equivalent === null) return ambiguous();
    return { verdict: equivalent ? 'correct' : 'incorrect',
      explanation: equivalent ? 'Your equation is mathematically equivalent; decimal coefficients and fractions can express the same values.' : 'The equation does not match the expected relation. Check the coefficients and signs.',
      correctPieces: equivalent ? ['Equivalent equation'] : [], incorrectPieces: equivalent ? [] : ['Equation coefficients or signs'],
      confidence: 1, nextAction: equivalent ? '' : 'Check each coefficient against the original equation.' };
  } catch { return ambiguous(); }
}
