/**
 * Minor units, displayed and entered as people actually think about money.
 *
 * The API speaks minor units throughout — 25000000 USDC, 5000 USD cents —
 * because integers cannot drift the way floats do. Showing that number to a
 * person is how a 25 USDC limit gets read as twenty-five million, so every
 * surface converts at the edge and nowhere else.
 *
 * Scales differ per currency: USDC carries six decimals, USD cents two. The
 * server refuses to convert between currencies for the same reason.
 */
const DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  ETH: 18,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

/** Two decimals is the safe default: it under-states rather than inflates. */
export function decimalsFor(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency);
}

export function majorToMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** decimalsFor(currency));
}

/** For display: trims trailing zeros so 25.000000 USDC reads as 25. */
export function formatMoney(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const major = minorToMajor(minor, currency);
  const fixed = major.toFixed(decimals);
  const trimmed = decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
  return `${trimmed} ${currency.toUpperCase()}`;
}

/** What a text field should show for an existing limit. */
export function toInputValue(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const fixed = minorToMajor(minor, currency).toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** Null for anything that is not a usable amount, so callers can refuse it. */
export function parseAmount(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const major = Number(trimmed);
  if (!Number.isFinite(major) || major < 0) return null;
  return majorToMinor(major, currency);
}
