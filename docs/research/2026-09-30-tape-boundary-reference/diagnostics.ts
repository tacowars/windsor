/** Read-only stage diagnostics of the GPL-3.0-only CHOW-derived equation.
 * Jatin Chowdhury, 604372e4ffd9690c3e283362e4598cb43edbb475; see
 * ../2026-09-30-tape-phase-3/{hysteresis.ts,AUDIT.md,COPYING}.
 * This duplication reports terms; it never supplies the integrator's slope.
 */
import type { Hysteresis } from '../2026-09-30-tape-phase-3/hysteresis';
import { BOUNDARY as B, CORE as C } from './boundaryConstants';

export function equation(core: Hysteresis, input: { m: number; h: number; velocity: number }) {
  const { m, h, velocity } = input,
    q = (h + C.alpha * m) / core.a;
  const series = Math.abs(q) < C.nearZero;
  const q2 = q * q;
  const coth = series ? 0 : 1 / Math.tanh(q);
  const langevin = series ? q * (1 / 3 + q2 * (-1 / 45 + (q2 * 2) / 945)) : coth - 1 / q;
  const prime = series ? 1 / 3 + q2 * (-1 / 15 + (q2 * 2) / 189) : 1 + 1 / (q * q) - coth * coth;
  const difference = core.ms * langevin - m,
    direction = velocity >= 0 ? 1 : -1;
  const irreversible = direction * difference > 0;
  const denominator = (1 - core.c) * direction * C.k - C.alpha * difference;
  const reversible = ((prime * core.ms) / core.a) * core.c;
  const reversibleDenominator = 1 - C.alpha * reversible;
  const predictedSlope =
    Math.abs(denominator) < C.denominatorFloor ||
    Math.abs(reversibleDenominator) < C.denominatorFloor
      ? NaN
      : (velocity * (((irreversible ? 1 - core.c : 0) * difference) / denominator + reversible)) /
        reversibleDenominator;
  return {
    q,
    difference,
    direction,
    irreversible,
    denominator,
    reversibleDenominator,
    series,
    predictedSlope,
  };
}
export type Stage = ReturnType<typeof equation> & {
  time: number;
  step: number;
  stage: number;
  sourceH: number;
  sourceVelocity: number;
  h: number;
  velocity: number;
  m: number;
  slope: number;
  dtSlope: number;
};
type Family = (typeof B.families)[number];
type Crossing = {
  from: { time: number; step: number; stage: number; value: number | boolean };
  to: Stage;
  uncertainty: number;
  stageTrialChange: boolean;
};
function classes(s: Stage, table = B) {
  return {
    fieldZero: Math.sign(s.sourceH),
    knee: Math.abs(s.sourceH) > table.knee,
    velocity: s.direction,
    irreversible: s.irreversible,
    series: s.series,
    inWindow: table.windows.some(([lo, hi]) => s.time >= lo && s.time <= hi),
  };
}
export class Diagnostics {
  stages = 0;
  invalidStages = 0;
  seriesStages = 0;
  irreversibleStages = 0;
  windowStages = [0, 0];
  lastStep: Stage[] = [];
  previous: Stage | null = null;
  peaks: Partial<Record<(typeof B.peaks)[number], Stage>> = {};
  minima: Partial<Record<(typeof B.minima)[number], Stage>> = {};
  crossings = Object.fromEntries(
    B.families.map((key) => [
      key,
      { total: 0, windowTotal: 0, retained: [] as Crossing[], truncated: 0 },
    ]),
  ) as Record<
    Family,
    { total: number; windowTotal: number; retained: Crossing[]; truncated: number }
  >;
  constructor(
    readonly factor: number,
    readonly table = B,
  ) {}
  beginStep() {
    this.lastStep = [];
  }
  observe(s: Stage) {
    this.stages++;
    if (!Number.isFinite(s.slope)) this.invalidStages++;
    if (s.series) this.seriesStages++;
    if (s.irreversible) this.irreversibleStages++;
    this.lastStep.push(s);
    for (const [i, [lo, hi]] of this.table.windows.entries())
      if (s.time >= lo && s.time <= hi) this.windowStages[i]++;
    for (const key of this.table.peaks)
      if (
        Number.isFinite(s[key]) &&
        (!this.peaks[key] || Math.abs(s[key]) > Math.abs(this.peaks[key]![key]))
      )
        this.peaks[key] = s;
    for (const key of this.table.minima)
      if (
        Number.isFinite(s[key]) &&
        (!this.minima[key] || Math.abs(s[key]) < Math.abs(this.minima[key]![key]))
      )
        this.minima[key] = s;
    if (this.previous) this.recordCrossings(this.previous, s);
    this.previous = s;
  }
  recordCrossings(previous: Stage, s: Stage) {
    const a = classes(previous, this.table),
      b = classes(s, this.table);
    for (const key of this.table.families) {
      if (a[key] === b[key]) continue;
      const event = this.crossings[key];
      event.total++;
      if (!a.inWindow && !b.inWindow) continue;
      event.windowTotal++;
      if (event.retained.length >= this.table.crossingCap) {
        event.truncated++;
        continue;
      }
      event.retained.push({
        from: { time: previous.time, step: previous.step, stage: previous.stage, value: a[key] },
        to: s,
        uncertainty: 1 / this.factor,
        stageTrialChange: previous.time === s.time,
      });
    }
  }
  summary(failed: boolean) {
    return {
      stages: this.stages,
      invalidStages: this.invalidStages,
      seriesStages: this.seriesStages,
      irreversibleStages: this.irreversibleStages,
      windowStages: this.windowStages,
      peaks: this.peaks,
      minima: this.minima,
      crossings: this.crossings,
      failureStages: failed ? this.lastStep : [],
      interpretation:
        'Stage-call transitions; midpoint trial-state changes are not exact continuous crossings.',
    };
  }
}
