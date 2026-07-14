/** Cents (integer) <-> display string ("100.00") conversions, per NFR-03. */
export function centsToDisplay(cents: number): string {
  return (cents / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Parses a user-typed amount into integer cents, or null if not a valid non-negative number. */
export function displayToCents(input: string): number | null {
  const value = Number.parseFloat(input);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatMultiplier(x: number): string {
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(2)}x`;
}
