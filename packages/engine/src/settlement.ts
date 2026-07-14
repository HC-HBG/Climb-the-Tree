/**
 * Money is always integer cents (NFR-03). Multipliers are already truncated
 * to 2dp by crashFromUniform, so representing them as integer "hundredths"
 * (e.g. 2.13x -> 213) keeps the payout computation exact and avoids
 * floating-point drift that `betCents * 2.13` could introduce.
 */
export function multiplierToHundredths(multiplier: number): number {
  return Math.round(multiplier * 100);
}

/**
 * Settlement payout, per Math Specification QA Tests:
 *   floor(bet * x * 100) / 100  — expressed here entirely in integer cents.
 */
export function payoutCents(betCents: number, multiplier: number): number {
  const hundredths = multiplierToHundredths(multiplier);
  return Math.floor((betCents * hundredths) / 100);
}
