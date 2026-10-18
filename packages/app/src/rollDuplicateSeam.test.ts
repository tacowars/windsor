/**
 * Duplicate's seam as the player plays it (windsor#904; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decision 11): the old two-bar
 * loop played twice and its duplicate, each on the engine's automation
 * player, read on the voice slots around the old loop's end. Both hold the
 * closing value right up to the boundary. The wrap then ramps to the
 * opening value over the player's de-click; the duplicate's points reach
 * it `ROLL_DUPLICATE_SEAM_TICKS` after the boundary, sooner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RollEnvelope } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { AUTOMATION_STEP_RAMP_SECONDS as STEP } from '@windsor/engine/automation/automationConstants';
import {
  ENVELOPE_TICK,
  clipEnvelopeRig,
  envelopeOffsetAt,
  rollPart,
  rollPattern,
} from '@windsor/engine/__fixtures__/clipEnvelopeRig';
import type { FakeParam } from '@windsor/engine/__fixtures__/fakeAudioNodes';
import { installWorklet } from '@windsor/engine/__fixtures__/stripRig';
import { duplicateLoop } from './rollDuplicate';
import { ROLL_DUPLICATE_SEAM_TICKS as SEAM } from './rollDuplicateTables';

const BAR = TICKS_PER_BAR;
const BEAT = BAR / 4;
const LOOP = 2 * BAR;
const REGION = 2 * LOOP;

/** One opening on tick 0 with a bend, one opening late; both closing on another value. */
const ENVELOPES: RollEnvelope[] = [
  {
    target: 'filter.cutoff',
    on: true,
    points: [
      { tick: 0, value: -0.5, bend: 0.25 },
      { tick: BAR, value: 0.5, bend: 0 },
      { tick: BAR + 2 * BEAT, value: 0.2, bend: -0.3 },
    ],
  },
  {
    target: 'filter.resonance',
    on: true,
    points: [
      { tick: BEAT, value: 0.8, bend: 0 },
      { tick: 5 * BEAT, value: -0.4, bend: 0.5 },
    ],
  },
];

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

/** The roll over `loopTicks` played through one region of `REGION`: its slots and the old seam's time. */
async function play(
  loopTicks: number,
  envelopes: readonly RollEnvelope[],
): Promise<{ slot: (path: string) => FakeParam; seam: number }> {
  const pattern = rollPattern(loopTicks, envelopes);
  const rig = await clipEnvelopeRig(rollPart([{ start: 0, duration: REGION, pattern }]));
  const times = rig.run(LOOP + BAR);
  return { slot: (path) => rig.slot(path), seam: times[LOOP]! };
}

describe('the duplicate on the player, across the old loop’s end', () => {
  it('holds the closing value up to the boundary as the wrap does, then opens within its de-click', async () => {
    const doubled = duplicateLoop({ loopTicks: LOOP, notes: [], envelopes: ENVELOPES }, REGION);
    const twice = await play(LOOP, ENVELOPES);
    const once = await play(2 * LOOP, doubled!.envelopes!);
    expect(once.seam).toBe(twice.seam);
    for (const envelope of ENVELOPES) {
      const old = twice.slot(envelope.target);
      const dup = once.slot(envelope.target);
      const at = (seconds: number): [number, number] => [
        old.valueAt(twice.seam + seconds),
        dup.valueAt(once.seam + seconds),
      ];
      const closing = envelopeOffsetAt(envelope, LOOP - 1, LOOP);
      const opening = envelopeOffsetAt(envelope, 0, LOOP);
      expect(closing).not.toBeCloseTo(opening, 3);
      // Before the boundary, and on it, both play the closing value.
      for (const ticks of [0.5, 0.01, 0]) {
        const [wrap, seam] = at(-ticks * ENVELOPE_TICK);
        expect(wrap).toBeCloseTo(closing, 9);
        expect(seam).toBeCloseTo(closing, 9);
      }
      // After it the wrap ramps over its de-click; the duplicate is at the opening a seam on.
      const [wrapHalf] = at(STEP / 2);
      expect(wrapHalf).toBeCloseTo((closing + opening) / 2, 9);
      expect(at(SEAM * ENVELOPE_TICK)[1]).toBeCloseTo(opening, 9);
      const [wrapStep, seamStep] = at(STEP);
      expect(wrapStep).toBeCloseTo(opening, 9);
      // Opened 4 ms sooner, the duplicate is already that far along its first tick's ramp.
      const [, seamTick] = at(ENVELOPE_TICK);
      const ramp = Math.abs(seamTick - opening);
      expect(Math.abs(seamStep - opening)).toBeLessThanOrEqual((ramp * STEP) / ENVELOPE_TICK);
      // A tick on and after, both play the loop's curve.
      for (let tick = 1; tick <= BAR; tick++) {
        const [wrap, seam] = at(tick * ENVELOPE_TICK);
        expect(seam).toBeCloseTo(wrap, 3);
      }
    }
  });
});
