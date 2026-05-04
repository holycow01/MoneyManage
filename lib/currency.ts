/**
 * Currency symbol + formatting helpers.
 *
 * Pulse stores amounts as numbers and a single ISO 4217 code on the user
 * row. UI formatting goes through `formatAmount(value, code)` so changing
 * the user's currency in settings flips the entire app at once.
 */
const SYMBOLS: Record<string, string> = {
  PKR: "₨",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  AED: "د.إ",
  SAR: "﷼",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
};

export function symbolFor(code: string): string {
  return SYMBOLS[code.toUpperCase()] ?? `${code} `;
}

/** "₨ 1,240" / "$ 12.50" — drops trailing zeros after the decimal. */
export function formatAmount(value: number, code: string = "PKR"): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fixed = abs.toFixed(2).replace(/\.?0+$/, "");
  const [int, frac] = fixed.split(".");
  const grouped = Number(int).toLocaleString("en-US");
  const body = frac ? `${grouped}.${frac}` : grouped;
  return `${sign}${symbolFor(code)} ${body}`;
}

/** No symbol — just the formatted number, used inside the giant amount display. */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const fixed = abs.toFixed(2).replace(/\.?0+$/, "");
  const [int, frac] = fixed.split(".");
  const grouped = Number(int).toLocaleString("en-US");
  return frac ? `${grouped}.${frac}` : grouped;
}
