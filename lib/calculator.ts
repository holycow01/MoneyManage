/**
 * Tiny calculator engine for the quick-entry keypad.
 *
 * Stores an expression as a single string of digits + operators, no spaces.
 * The four operators we accept (matching the keypad labels) are:
 *   `+`  `−`  `×`  `÷`
 * (note: minus is U+2212, not ASCII hyphen). Evaluation honors precedence
 * (× and ÷ before + and −) and tolerates a trailing operator while the
 * user is mid-input by simply ignoring it.
 *
 * Public surface: `appendKey(expr, key)` returns the new expression string,
 * `evaluate(expr)` returns the numeric result.
 */

export const OPS = ["+", "−", "×", "÷"] as const;
export type Op = (typeof OPS)[number];

const isOp = (c: string): c is Op => (OPS as readonly string[]).includes(c);

/**
 * Apply a single keypress. Keys: "0"–"9", ".", "+", "−", "×", "÷", "⌫", "C".
 * Anything else is ignored.
 */
export function appendKey(expr: string, key: string): string {
  if (key === "C") return "";
  if (key === "⌫") return expr.slice(0, -1);
  if (/^\d$/.test(key)) return appendDigit(expr, key);
  if (key === ".") return appendDecimal(expr);
  if (isOp(key)) return appendOp(expr, key);
  return expr;
}

function currentNumber(expr: string): string {
  // The trailing run of [0-9.] is the number being typed.
  const m = expr.match(/(\d*\.?\d*)$/);
  return m ? m[0] : "";
}

function appendDigit(expr: string, d: string): string {
  const last = currentNumber(expr);
  // Avoid leading zeros: "0" + "5" → "5", but "0." + "5" → "0.5".
  if (last === "0") {
    return expr.slice(0, -1) + d;
  }
  return expr + d;
}

function appendDecimal(expr: string): string {
  const last = currentNumber(expr);
  if (last.includes(".")) return expr;
  if (last === "") return expr + "0.";
  return expr + ".";
}

function appendOp(expr: string, op: Op): string {
  if (!expr) return ""; // can't start with an operator
  const lastChar = expr.slice(-1);
  if (isOp(lastChar)) {
    // replace the trailing op so "+−" becomes just "−"
    return expr.slice(0, -1) + op;
  }
  if (lastChar === ".") {
    // strip trailing dot before adding an operator
    return expr.slice(0, -1) + op;
  }
  return expr + op;
}

/** Evaluate the expression. A trailing operator is ignored. */
export function evaluate(expr: string): number {
  if (!expr) return 0;
  const cleaned = expr.replace(/[+\-−×÷]\s*$/, "");
  if (!cleaned) return 0;

  // Tokenize into numbers + operators.
  const tokens: (string | number)[] = [];
  const re = /(\d+\.?\d*|\.\d+|[+\-−×÷])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) tokens.push(m[0]);

  // Pass 1 — collapse × and ÷.
  const reduced: (string | number)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "×" || t === "÷") {
      const a = Number(reduced.pop());
      const b = Number(tokens[++i] ?? 0);
      reduced.push(t === "×" ? a * b : b === 0 ? 0 : a / b);
    } else {
      reduced.push(t);
    }
  }

  // Pass 2 — left-to-right + and −.
  let result = Number(reduced[0]) || 0;
  for (let j = 1; j < reduced.length; j += 2) {
    const op = reduced[j];
    const v = Number(reduced[j + 1]) || 0;
    if (op === "+") result += v;
    else if (op === "−" || op === "-") result -= v;
  }

  // Round to 2dp to avoid ugly float trails like 0.1+0.2=0.30000000000000004.
  return Math.round(result * 100) / 100;
}

/** Pretty-print the expression for the amount label (adds spaces around ops). */
export function formatExpression(expr: string): string {
  return expr.replace(/([+\-−×÷])/g, " $1 ").replace(/\s+/g, " ").trim();
}
