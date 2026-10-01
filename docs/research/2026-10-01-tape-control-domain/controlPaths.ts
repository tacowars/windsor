/** windsor#290: the control points and knob paths, and the trial schedule of both parts.
 * Pure: no rendering here. The only engine import is the shipped seeded PRNG.
 */
import { mulberry32 } from '../../../packages/engine/src/sequencing/mulberry32';
import { CONTROL, type Control, type Triple } from './controlConstants';

export const AXES = ['drive', 'width', 'saturation'] as const;
export type Box = [[number, number], [number, number], [number, number]];
export type Path =
  | { kind: 'static'; label: string; point: Triple }
  | { kind: 'sweep'; axis: number; others: number[]; period: number }
  | { kind: 'walk'; name: string; mode: string; hold: number; seed: number };
export interface Trial {
  part: 'width' | 'static' | 'sweep' | 'walk';
  id: string;
  rate: number;
  factor: number;
  path: Path;
}

/** A width maximum is the declared box drive [0,1] x width [0, wMax] x saturation [0,1];
 * a `Box` (windsor#295's raised width minimum) passes through unchanged. */
export const boxOf = (domain: number | Box): Box =>
  typeof domain === 'number'
    ? [
        [0, 1],
        [0, domain],
        [0, 1],
      ]
    : domain;
const frac = (x: number) => x - Math.floor(x);
const at = (range: [number, number], u: number) => range[0] + u * (range[1] - range[0]);

/** The box's 8 corners, 12 edge midpoints and centre, then the seeded R3 interior. */
export function boxPoints(box: Box, table: Control = CONTROL) {
  const ends = [0, 1];
  const points: { label: string; point: Triple }[] = [];
  const name = (p: number[]) => p.join(':');
  for (const d of ends)
    for (const w of ends)
      for (const s of ends) {
        const u: Triple = [d, w, s];
        points.push({
          label: `corner:${name(u)}`,
          point: u.map((v, i) => at(box[i]!, v)) as Triple,
        });
      }
  for (let axis = 0; axis < 3; axis++)
    for (const a of ends)
      for (const b of ends) {
        const u = [a, b];
        u.splice(axis, 0, 0.5);
        points.push({ label: `edge:${name(u)}`, point: u.map((v, i) => at(box[i]!, v)) as Triple });
      }
  points.push({ label: 'centre', point: box.map((r) => at(r, 0.5)) as Triple });
  const { count, g, seed } = table.interior;
  const random = mulberry32(seed),
    shift = [random(), random(), random()];
  const alpha = [1, 2, 3].map((k) => 1 / g ** k);
  for (let n = 1; n <= count; n++) {
    const u = alpha.map((a, i) => frac(shift[i]! + n * a));
    points.push({ label: `interior:${n}`, point: u.map((v, i) => at(box[i]!, v)) as Triple });
  }
  return points;
}

/** The planned points of a walk: one per `hold` over the program, uniform in the box. */
export function walkPoints(path: Extract<Path, { kind: 'walk' }>, box: Box, table = CONTROL) {
  const random = mulberry32(path.seed);
  const count = Math.ceil(table.seconds / path.hold) + 2;
  return Array.from({ length: count }, () => box.map((r) => at(r, random())) as Triple);
}

/** The knob targets at time t (seconds), written into `into`; `plan` is `walkPoints`. */
export function target(path: Path, t: number, box: Box, plan: Triple[] | null, into: Triple) {
  if (path.kind === 'static') {
    into[0] = path.point[0];
    into[1] = path.point[1];
    into[2] = path.point[2];
  } else if (path.kind === 'sweep') {
    const phase = frac(t / path.period);
    const u = phase < 0.5 ? 2 * phase : 2 - 2 * phase;
    for (let i = 0, j = 0; i < 3; i++)
      into[i] = i === path.axis ? at(box[i]!, u) : at(box[i]!, path.others[j++]!);
  } else {
    const k = Math.floor(t / path.hold),
      u = path.mode === 'glide' ? t / path.hold - k : 0;
    for (let i = 0; i < 3; i++) into[i] = plan![k]![i]! + u * (plan![k + 1]![i]! - plan![k]![i]!);
  }
  return into;
}

/** Part A: the rendered width axis at each drive/saturation extreme. */
export function widthTrials(table: Control = CONTROL): Trial[] {
  const w = table.width;
  return w.renderedRates.flatMap((rate) =>
    table.factors.flatMap((factor) =>
      w.extremes.flatMap(([d, s]) =>
        w.rendered.map((width) => ({
          part: 'width' as const,
          id: `width/${d}:${s}/${width}/${rate}/${factor}`,
          rate,
          factor,
          path: {
            kind: 'static' as const,
            label: `${d}:${width}:${s}`,
            point: [d!, width, s!] as Triple,
          },
        })),
      ),
    ),
  );
}

/** Part B in the box: every static point, every sweep and every walk, per rate and factor. */
export function boxTrials(domain: number | Box, table: Control = CONTROL): Trial[] {
  const box = boxOf(domain),
    points = boxPoints(box, table);
  const corners = [0, 1].flatMap((a) => [0, 1].map((b) => [a, b]));
  return table.rates.flatMap((rate) =>
    table.factors.flatMap((factor) => {
      const tail = `${rate}/${factor}`;
      const statics = points.map(({ label, point }) => ({
        part: 'static' as const,
        id: `static/${label}/${tail}`,
        ...{ rate, factor, path: { kind: 'static' as const, label, point } },
      }));
      const sweeps = AXES.flatMap((name, axis) =>
        corners.flatMap((others) =>
          table.sweep.periods.map((period) => {
            const where = others.map((u, j) => at(box[j < axis ? j : j + 1]!, u)).map(String);
            where.splice(axis, 0, '-');
            return {
              part: 'sweep' as const,
              id: `sweep/${name}/${where.join(':')}/${period}/${tail}`,
              ...{ rate, factor, path: { kind: 'sweep' as const, axis, others, period } },
            };
          }),
        ),
      );
      const walks = table.walks.kinds.flatMap(({ name, mode, hold }) =>
        table.walks.seeds.map((seed) => ({
          part: 'walk' as const,
          id: `walk/${name}/${seed}/${tail}`,
          ...{ rate, factor, path: { kind: 'walk' as const, name, mode, hold, seed } },
        })),
      );
      return [...statics, ...sweeps, ...walks];
    }),
  );
}
