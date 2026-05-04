/**
 * Format a number as a currency string.
 * Defaults to USD; pass a different ISO 4217 code if needed.
 */
export function formatCurrency(
  value: number,
  currency: string = "USD",
  locale: string = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(value);
}

/** Compose conditional class names. Lightweight stand-in for `clsx`. */
export function cn(
  ...inputs: Array<string | number | false | null | undefined>
): string {
  return inputs.filter(Boolean).join(" ");
}
