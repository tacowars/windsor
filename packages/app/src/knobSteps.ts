/**
 * A stepped knob (windsor#712, bloom's Octave): a short list of values,
 * not evenly spaced, that the dial spaces evenly round its sweep. A drag
 * lands on the nearest step, an arrow key moves one step, and a value
 * between two reads as the nearer.
 */

/** The step of `steps` nearest `v`, the lower on a tie. */
export function nearestStep(steps: readonly number[], v: number): number {
  let nearest = steps[0]!;
  for (const step of steps) if (Math.abs(step - v) < Math.abs(nearest - v)) nearest = step;
  return nearest;
}

/** `steps`' value ↔ sweep mapping: step `i` of `n` sits at `i / (n - 1)`. */
export function steppedScale(steps: readonly number[]): {
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
} {
  const last = steps.length - 1;
  return {
    toNorm: (v) => steps.indexOf(nearestStep(steps, v)) / last,
    fromNorm: (n) => steps[Math.round(Math.min(1, Math.max(0, n)) * last)]!,
  };
}

/** The step an arrow key lands on: the next one in `dir`, held at either end. */
export function stepKeyTarget(steps: readonly number[], current: number, dir: 1 | -1): number {
  const at = steps.indexOf(nearestStep(steps, current)) + dir;
  return steps[Math.min(steps.length - 1, Math.max(0, at))]!;
}
