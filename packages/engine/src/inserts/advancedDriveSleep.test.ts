/**
 * Advanced Drive's sleep (windsor#793, `worklet/advancedDrive/driveSleep.ts`),
 * through the shipped bundle (`__fixtures__/advancedDriveHarness.ts`):
 *
 * - fed silence after a tone, every route sleeps once its output has stayed
 *   under the floor for the hold, within `TAIL` of the tone's end; asleep, it
 *   writes the silent input and calls no DSP;
 * - a drive turned to Mix 0, or switched off, as the tone ends does not sleep
 *   while the graph's wet still rings above the floor;
 * - the first block whose input crosses the floor wakes it and renders in
 *   full, and the woken render follows a drive that never slept to within
 *   `WAKE_BOUND`, modulation and all; with no modulation it is the bits of a
 *   fresh drive;
 * - with no input connected it sleeps too, and `sleep: false` never sleeps.
 *
 * That a render that never goes silent is unchanged is the other drive tests'
 * job: they pass with the sleep in the bundle, unedited.
 */
import { describe, expect, it } from 'vitest';
import { advancedDriveParams, loadAdvancedDrive } from '../__fixtures__/advancedDriveHarness';
import type { AdvancedDriveProcessorLike } from '../__fixtures__/advancedDriveHarness';
import { DRIVE_ROUTES } from './advancedDriveConstants';
import { DRIVE_SLEEP } from './advancedDriveSleepConstants';
import { DEFAULT_DRIVE_STAGE } from './advancedDriveSpec';
import type { AdvancedDriveSpec } from './advancedDriveSpec';

const RATE = 48000;
const QUANTUM = 128;
const HZ = 300;
/** Seconds of tone, then the most silence any case here takes to sleep. */
const TONE = 0.25;
const TAIL = 1;
/** Seconds of silence for the resonant ring's cases. */
const RING_TAIL = 3;
/**
 * The woken render against a drive that never slept: the LFO's phase and the
 * follower move a block at a time asleep and a sample at a time awake, which
 * differ in their last bits, so a modulated render differs by a rounding.
 * Measured 1.2e-7 at a peak near 4 across the allocation test's settings.
 */
const WAKE_BOUND = 1e-6;

/** A drive that does something: driven, every stage shaping, modulated by the LFO and the follower. */
const MODULATED: Partial<AdvancedDriveSpec> = {
  drive: 9,
  rate: 3,
  stages: [0, 1, 2].map((s) => ({
    ...DEFAULT_DRIVE_STAGE,
    shaper: (['tube', 'fold', 'diode'] as const)[s]!,
    amount: 0.5,
    filtering: true,
    frequency: 900,
    resonance: 3,
    envAmount: 0.3,
    lfoBias: 0.2,
    lfoCutoff: 1,
  })),
};

interface Rig {
  processor: AdvancedDriveProcessorLike;
  params: Record<string, Float32Array>;
  input: Float32Array[];
  output: Float32Array[][];
  /** Every `tick` the DSP has run. */
  ticks: { count: number };
}

function rig(spec: Partial<AdvancedDriveSpec> = {}, sleep = true): Rig {
  const params = advancedDriveParams(spec);
  const processor = loadAdvancedDrive(RATE, params, { sleep });
  const ticks = { count: 0 };
  // Counted, so a test can tell an asleep block ran no DSP.
  const dsp = (processor as unknown as { dsp: { tick(): void } }).dsp,
    tick = dsp.tick.bind(dsp);
  dsp.tick = (): void => {
    ticks.count++;
    tick();
  };
  const input = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  const output = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  return { processor, params, input, output, ticks };
}

/** One block of `x(frame)` on both channels; returns the left output. */
function block(r: Rig, frame: number, x: (frame: number) => number): Float32Array {
  for (let i = 0; i < QUANTUM; i++) r.input[0]![i] = r.input[1]![i] = x(frame + i);
  r.processor.process([r.input], r.output, r.params);
  return r.output[0]![0]!;
}

const tone = (frame: number): number => 0.5 * Math.sin((2 * Math.PI * HZ * frame) / RATE);
const silence = (): number => 0;
const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/**
 * The tone, `onSilence` as it ends, then silence until the drive sleeps or
 * `tail` passes: the silent block it slept on (or -1), and the number of
 * silent blocks up to the last one heard above the output floor.
 */
function toneThenSleep(
  r: Rig,
  onSilence?: (r: Rig) => void,
  tail = TAIL,
): { slept: number; ringEnd: number } {
  const toneBlocks = Math.round((TONE * RATE) / QUANTUM),
    tailBlocks = Math.round((tail * RATE) / QUANTUM);
  for (let b = 0; b < toneBlocks; b++) block(r, b * QUANTUM, tone);
  onSilence?.(r);
  let ringEnd = 0;
  for (let b = 0; b < tailBlocks; b++) {
    const out = block(r, (toneBlocks + b) * QUANTUM, silence);
    if (peak(out) > DRIVE_SLEEP.outputFloor) ringEnd = b + 1;
    if (r.processor.sleep.asleep) return { slept: b, ringEnd };
  }
  return { slept: -1, ringEnd };
}

describe('Advanced Drive sleeps on silence (windsor#793)', () => {
  it.each(DRIVE_ROUTES)(
    '%s sleeps within its tail, then writes the silence and runs no DSP',
    (route) => {
      const r = rig({ ...MODULATED, route });
      const { slept, ringEnd } = toneThenSleep(r);
      expect(slept).toBeGreaterThanOrEqual(0);
      // Not before the output has held under the floor for the hold.
      const holdBlocks = Math.ceil((DRIVE_SLEEP.holdSeconds * RATE) / QUANTUM);
      expect(slept - ringEnd + 1).toBeGreaterThanOrEqual(holdBlocks);
      const ticks = r.ticks.count;
      for (let b = 0; b < 100; b++) {
        const out = block(r, b * QUANTUM, silence);
        expect(r.output[0]![1]!.every((v) => v === 0) && out.every((v) => v === 0)).toBe(true);
      }
      expect(r.ticks.count).toBe(ticks);
      expect(r.processor.sleep.asleep).toBe(true);
    },
  );

  it.each([
    ['at Mix 0', (r: Rig): void => void (r.params.mix![0] = 0)],
    ['switched off', (r: Rig): void => void (r.params.enabled![0] = 0)],
  ] as const)('does not sleep through a ring it holds %s as the tone ends', (_, hide) => {
    // A resonant low-pass at 40 Hz on every stage rings long after the tone.
    const ringing: Partial<AdvancedDriveSpec> = {
      ...MODULATED,
      stages: MODULATED.stages!.map((s) => ({ ...s, frequency: 40, resonance: 6, lfoCutoff: 0 })),
    };
    const heard = toneThenSleep(rig(ringing), undefined, RING_TAIL);
    const hidden = toneThenSleep(rig(ringing), hide, RING_TAIL);
    // The ring outlasts the hold, so a sleep that read only the heard output would come early.
    expect(heard.ringEnd * QUANTUM).toBeGreaterThan(2 * DRIVE_SLEEP.holdSeconds * RATE);
    expect(heard.slept).toBeGreaterThan(heard.ringEnd);
    expect(hidden.slept).toBeGreaterThanOrEqual(heard.ringEnd);
  });

  it('wakes on the block whose input crosses the floor, and follows a drive that never slept', () => {
    const asleep = rig(MODULATED),
      awake = rig(MODULATED, false);
    const toneBlocks = Math.round((TONE * RATE) / QUANTUM),
      quietBlocks = Math.round((TAIL * RATE) / QUANTUM);
    const wake = (toneBlocks + quietBlocks) * QUANTUM;
    // One sample at twice the floor, 77 frames into the waking block, then the tone again.
    const x = (frame: number): number =>
      frame < toneBlocks * QUANTUM
        ? tone(frame)
        : frame < wake + 77
          ? 0
          : frame === wake + 77
            ? 2 * DRIVE_SLEEP.inputFloor
            : tone(frame);
    let worst = 0;
    for (let b = 0; b < toneBlocks + quietBlocks + toneBlocks; b++) {
      const frame = b * QUANTUM;
      const wasAsleep = asleep.processor.sleep.asleep,
        ticks = asleep.ticks.count;
      const a = Float32Array.from(block(asleep, frame, x)),
        y = block(awake, frame, x);
      if (frame === wake) {
        expect(wasAsleep).toBe(true);
        expect(asleep.processor.sleep.asleep).toBe(false);
        expect(asleep.ticks.count - ticks).toBe(QUANTUM);
      }
      for (let i = 0; i < QUANTUM; i++) worst = Math.max(worst, Math.abs(a[i]! - y[i]!));
    }
    expect(awake.processor.sleep.asleep).toBe(false);
    expect(worst).toBeLessThanOrEqual(WAKE_BOUND);
  });

  it('wakes with no modulation to the bits of a fresh drive', () => {
    const spec: Partial<AdvancedDriveSpec> = {
      ...MODULATED,
      stages: MODULATED.stages!.map((s) => ({ ...s, envAmount: 0, lfoBias: 0, lfoCutoff: 0 })),
    };
    const woken = rig(spec),
      fresh = rig(spec);
    expect(toneThenSleep(woken).slept).toBeGreaterThanOrEqual(0);
    for (let b = 0; b < 40; b++) {
      const a = Float32Array.from(block(woken, b * QUANTUM, tone)),
        y = block(fresh, b * QUANTUM, tone);
      expect(Array.from(a)).toEqual(Array.from(y));
    }
  });

  it('sleeps with no input connected, writing silence', () => {
    const r = rig(MODULATED);
    const blocks = Math.round((TAIL * RATE) / QUANTUM);
    for (let b = 0; b < blocks && !r.processor.sleep.asleep; b++) {
      r.processor.process([[]], r.output, r.params);
    }
    expect(r.processor.sleep.asleep).toBe(true);
    r.output[0]![0]!.fill(1);
    r.processor.process([[]], r.output, r.params);
    expect(r.output[0]![0]!.every((v) => v === 0)).toBe(true);
  });

  it('never sleeps with sleep off', () => {
    const r = rig(MODULATED, false);
    expect(toneThenSleep(r).slept).toBe(-1);
  });
});
