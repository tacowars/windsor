/**
 * The right half of an on-line split (windsor#349): one `u^k` segment cannot
 * reproduce the right half of a bent curve, so the bend is a least-squares
 * fit in display space. These cases record the worst error left, against the
 * earlier fit that matched the half's midpoint only.
 */
import { describe, expect, it } from 'vitest';
import {
  PPQ,
  TICKS_PER_BAR,
  bendCurve,
  catalogRow,
  toDisplay,
  type AutomationPoint,
  type AutomationTargetRow,
} from '@windsor/engine';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { rightHalfBend } from './songAutomationSplit';

const P = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });
const pan = catalogRow('strip.pan')!;
const cutoff = catalogRow('voice.filter.cutoff')!;
const SIXTEENTH = PPQ / 4;
const BAR = TICKS_PER_BAR;

/** The earlier rule: the bend whose curve meets the original at the right half's midpoint. */
function midpointBend(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
  s: number,
): number {
  const rise = toDisplay(row, b.value) - toDisplay(row, a.value);
  const k = Math.log(bendCurve(0.5, a.bend, rise)) / Math.log(0.5);
  const at = bendCurve(s, a.bend, rise);
  const fraction = (bendCurve(s + (1 - s) / 2, a.bend, rise) - at) / (1 - at);
  const k2 = Math.log(fraction) / Math.log(0.5);
  return Math.min(1, Math.max(-1, (a.bend * Math.log(k2)) / Math.log(k)));
}

/** The largest display-space gap between the original right half and one segment bent `bend`. */
function worstError(
  row: AutomationTargetRow,
  a: AutomationPoint,
  b: AutomationPoint,
  s: number,
  bend: number,
): number {
  const ya = toDisplay(row, a.value);
  const rise = toDisplay(row, b.value) - ya;
  const ys = ya + rise * bendCurve(s, a.bend, rise);
  let worst = 0;
  for (let i = 0; i <= 512; i++) {
    const v = i / 512;
    const original = ya + rise * bendCurve(s + (1 - s) * v, a.bend, rise);
    const split = ys + (ya + rise - ys) * bendCurve(v, bend, rise);
    worst = Math.max(worst, Math.abs(original - split));
  }
  return worst;
}

const lane = AUTOMATION_PART.automation!.find((l) => l.target === 'voice.filter.cutoff')!.points;

/**
 * [name, row, a, b, split (a tick, or a fraction of the segment below 1),
 * the fit's worst error, rounded up from the measurement]. Measured worst
 * errors in display space, fit vs the midpoint match: Codex's case (tick 6
 * of 384, bend −1) 0.0466 vs 0.0597; a beat in 0.0267 vs 0.0369; the
 * fixture's cutoff splits 0.0045 vs 0.0062, 0.0014 vs 0.0019 and 0.0005 vs
 * 0.0006; a late split ~0 for both.
 */
const CASES: readonly (readonly [
  string,
  AutomationTargetRow,
  AutomationPoint,
  AutomationPoint,
  number,
  number,
])[] = [
  ['descending Pan, bend −1, split at tick 6', pan, P(0, 1, -1), P(4 * BAR, -1), SIXTEENTH, 0.047],
  ['descending Pan, bend −1, split at a beat', pan, P(0, 1, -1), P(4 * BAR, -1), PPQ, 0.027],
  ['rising Pan, bend 1, split late', pan, P(0, -1, 1), P(4 * BAR, 1), 4 * BAR - 6, 1e-3],
  ['rising Pan over a bar, bend 1, split early', pan, P(0, -1, 1), P(BAR, 1), 6, 0.027],
  ['fixture cutoff, segment 0 at 0.3', cutoff, lane[0]!, lane[1]!, 0.3, 0.0046],
  ['fixture cutoff, segment 1 at 0.5', cutoff, lane[1]!, lane[2]!, 0.5, 0.0015],
  ['fixture cutoff, segment 0 at 0.7', cutoff, lane[0]!, lane[1]!, 0.7, 0.0005],
];

describe('the right half of an on-line split', () => {
  for (const [name, row, a, b, at, bound] of CASES) {
    it(`${name}: within ${bound}, and no worse than the midpoint match`, () => {
      // A fixture split is a fraction of its segment; the others are ticks.
      const tick = at < 1 ? Math.round(a.tick + at * (b.tick - a.tick)) : at;
      const s = (tick - a.tick) / (b.tick - a.tick);
      const fit = worstError(row, a, b, s, rightHalfBend(row, a, b, s));
      const midpoint = worstError(row, a, b, s, midpointBend(row, a, b, s));
      expect(fit).toBeLessThan(bound);
      expect(fit).toBeLessThanOrEqual(midpoint + 1e-12);
    });
  }

  it('keeps an unbent or flat segment as it is', () => {
    expect(rightHalfBend(pan, P(0, -1), P(384, 1), 0.25)).toBe(0);
    expect(rightHalfBend(pan, P(0, 0.5, 0.7), P(384, 0.5), 0.25)).toBe(0.7);
  });

  it('stays inside −1..1', () => {
    for (const s of [0.01, 0.1, 0.5, 0.9, 0.99]) {
      const bend = rightHalfBend(pan, P(0, 1, -1), P(384, -1), s);
      expect(bend).toBeGreaterThanOrEqual(-1);
      expect(bend).toBeLessThanOrEqual(1);
    }
  });
});
