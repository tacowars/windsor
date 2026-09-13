/**
 * The User wave's harmonic bars (#511), without the DOM: what a stroke writes
 * into `Operator.userPartials`, what the count switch does to its length, and
 * the single cycle the preview draws. Index 0 is the fundamental, as in the
 * worklet's `partialsFor`; the worklet normalises the summed table's peak, so
 * bar heights are relative.
 */

/** The bar counts offered, Operator-style. */
export const HARMONIC_COUNTS = [16, 32, 64] as const;
export type HarmonicCount = (typeof HARMONIC_COUNTS)[number];
const FEWEST: HarmonicCount = 16;
const MOST: HarmonicCount = 64;

/** A User wave with nothing drawn yet: the pure fundamental the worklet already plays for null. */
export function seedPartials(count: HarmonicCount = FEWEST): number[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? 1 : 0));
}

/**
 * The count switch position for a stored array: the smallest that shows all
 * of it. A hand-written array longer than 64 shows its first 64 bars and keeps
 * the rest until the switch is pressed.
 */
export function countFor(partials: readonly number[] | null): HarmonicCount {
  const length = partials?.length ?? 0;
  return HARMONIC_COUNTS.find((c) => c >= length) ?? MOST;
}

/** Switch the bar count: drop the bars above it, or add silent ones. */
export function resizePartials(partials: readonly number[] | null, count: HarmonicCount): number[] {
  const source = partials ?? seedPartials(count);
  return Array.from({ length: count }, (_, i) => source[i] ?? 0);
}

/**
 * The array a stroke paints into: padded with silence up to the bar count the
 * editor shows, so no visible bar is inert. Longer arrays are left whole.
 */
export function drawablePartials(partials: readonly number[] | null): number[] {
  const count = countFor(partials);
  return partials && partials.length >= count ? [...partials] : resizePartials(partials, count);
}

export interface BarPoint {
  index: number;
  value: number;
}

/** Which bar a pointer is over, and the height it asks for (0 at the bottom, 1 at the top). */
export function pointToBar(
  point: { x: number; y: number },
  size: { width: number; height: number },
  count: number,
): BarPoint {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    index: clamp(Math.floor((point.x / size.width) * count), 0, count - 1),
    value: clamp(1 - point.y / size.height, 0, 1),
  };
}

/**
 * Paint one step of a stroke into `partials` (mutated). With a previous point,
 * every bar between the two is set on the straight line joining them, so a
 * fast drag leaves no gaps.
 */
export function paintStroke(partials: number[], from: BarPoint | null, to: BarPoint): void {
  const start = from ?? to;
  const lo = Math.min(start.index, to.index);
  const hi = Math.max(start.index, to.index);
  for (let i = lo; i <= hi && i < partials.length; i++) {
    const t = hi === lo ? 1 : (i - start.index) / (to.index - start.index);
    partials[i] = start.value + (to.value - start.value) * t;
  }
}

/** One cycle of the summed sines, peak-normalised as the worklet does; silence stays zero. */
export function waveCycle(partials: readonly number[], points: number): Float32Array {
  const out = new Float32Array(points);
  partials.forEach((amp, h) => {
    if (amp === 0) return;
    for (let i = 0; i < points; i++) {
      out[i] = (out[i] ?? 0) + amp * Math.sin((2 * Math.PI * (h + 1) * i) / points);
    }
  });
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak > 0) for (let i = 0; i < points; i++) out[i] = (out[i] ?? 0) / peak;
  return out;
}
