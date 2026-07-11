/** NFL passer rating — the standard four-component formula, each component
 * clamped to [0, 2.375]. Returns null below a meaningful attempt sample. */
export function passerRating(
  completions: number,
  attempts: number,
  yards: number,
  tds: number,
  ints: number,
): number | null {
  if (!attempts) return null;
  const clamp = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = clamp((completions / attempts - 0.3) * 5);
  const b = clamp((yards / attempts - 3) * 0.25);
  const c = clamp((tds / attempts) * 20);
  const d = clamp(2.375 - (ints / attempts) * 25);
  return Math.round(((a + b + c + d) / 6) * 1000) / 10;
}
