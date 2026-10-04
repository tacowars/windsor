/**
 * The parabola through three equally spaced points (−1, a), (0, b), (1, c):
 * where its vertex sits and how high it is. The Output display's period
 * (`scopePeriod.ts`) and peaks (`scopePeaks.ts`) both read between samples
 * or bins this way.
 */

/** The vertex's offset from the middle point, or 0 where the points make no parabola. */
export function vertexOffset(a: number, b: number, c: number): number {
  const bend = a - 2 * b + c;
  if (bend === 0 || !Number.isFinite(bend)) return 0;
  return (a - c) / (2 * bend);
}

/** The parabola's value at `offset` from the middle point, `offset` being its vertex's. */
export function vertexValue(a: number, b: number, c: number, offset: number): number {
  return offset === 0 ? b : b - ((a - 2 * b + c) * offset * offset) / 2;
}
