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

const LOG_MAX_MULTIPLIER = Math.log(1000);

/** Same log-height normalization the scene's camera uses, for a consistent visual ramp. */
export function heightOf(m: number): number {
  return Math.log(Math.max(m, 1)) / LOG_MAX_MULTIPLIER;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * In-round multiplier color ramp: white -> gold -> green, keyed to the same
 * log-height as the ladder/camera so the HUD color always matches how far
 * up the tree the bear visually is.
 */
export function multiplierRampColor(m: number): string {
  const t = heightOf(m);
  const stops =
    t < 0.5
      ? { from: [255, 255, 255], to: [255, 210, 63], t: t / 0.5 }
      : { from: [255, 210, 63], to: [93, 255, 90], t: (t - 0.5) / 0.5 };
  const r = Math.round(lerp(stops.from[0] ?? 0, stops.to[0] ?? 0, stops.t));
  const g = Math.round(lerp(stops.from[1] ?? 0, stops.to[1] ?? 0, stops.t));
  const b = Math.round(lerp(stops.from[2] ?? 0, stops.to[2] ?? 0, stops.t));
  return `rgb(${r}, ${g}, ${b})`;
}
