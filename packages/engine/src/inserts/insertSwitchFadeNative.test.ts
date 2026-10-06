/**
 * The native-node inserts' click-free switch (windsor#629, record
 * `2026-10-06-insert-switch-lanes` decision 8), each kind at its defaults,
 * switched by its spec (the button) and by a lane:
 *
 * - under a steady sine, switching off and on adds no sample-to-sample step
 *   larger than `TOLERANCE` beyond the largest step the sine itself or the
 *   insert held on makes;
 * - off for longer than the fade is the dry signal, to `DRY_TOLERANCE`;
 * - Echo and Plate switched on after an off longer than the delay time (and
 *   the plate's clear) play none of the tail from before the off;
 * - so too switched on one sample after the fade out ends (fix round 1 for
 *   PR #635), when each waits for its loop or tank to empty, and the Echo
 *   still plays every repeat of what comes after;
 * - and the Echo, so switched with a short delay, full feedback and its damp
 *   filter ringing at 10 Hz and full resonance (fix round 2), plays the old
 *   tail only below -90 dBFS, not in exact silence: it waits for the filter's
 *   ring to fall by 90 dB; and the same at 20 kHz (fix round 3), where the
 *   digital filter's poles ring for some 3.4 ms, not the 0.66 ms a continuous
 *   filter would.
 *
 * The context plays the automation out in time (`timedAudioContext.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { burst, tones } from '../__fixtures__/audioAnalysis';
import type { Capture, FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode, renderGraph, SAMPLE_RATE } from '../__fixtures__/fakeAudioContext';
import type { Feed } from '../__fixtures__/reverbHarness';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { BLOCK } from '../__fixtures__/fakeAudioNodes';
import { openSpec } from '../__fixtures__/insertStageRig';
import { installTimedAudioWorklet, TimedContext } from '../__fixtures__/timedAudioContext';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { DEFAULT_ECHO } from './echoInsert';
import { ringTime } from './echoSwitchSettle';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import type { InsertSpec } from './insertRegistry';
import { INSERT_KINDS } from './insertRegistry';
import {
  DELAY_DAMP_MAX_HZ,
  DELAY_DAMP_MIN_HZ,
  DELAY_FEEDBACK_MAX,
  DELAY_RESONANCE_MAX_DB,
} from '../audioConstants';
import { dbToGain } from '../mixer/outputStageDsp';

/**
 * A linear crossfade over the fade's 240 samples moves at most 1/240 of the
 * gap between the two signals per sample, under 0.005 at these levels; a
 * step at the switch is the gap itself, tenths here.
 */
const TOLERANCE = 0.01;
/** Off is the dry signal: the wet gain is exactly 0 then. */
const DRY_TOLERANCE = 1e-6;
/** The old tail is gone, not quiet. */
const SILENT = 1e-6;

const SINE_HZ = 440;
/** Each switch near a peak of the sine, between two quanta. */
const OFF_AT = 0.1006;
const ON_AT = 0.2506;
const SECONDS = 0.4;
const KINDS = ['drive', 'echo', 'chorus', 'ensemble', 'plate'] as const;
type Kind = (typeof KINDS)[number];
type How = 'spec' | 'lane';
const HOWS: readonly How[] = ['spec', 'lane'];

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

let restore: () => void = () => {};
beforeAll(() => {
  restore = installTimedAudioWorklet();
});
afterAll(() => restore());

interface Switch {
  readonly how: How;
  readonly off: number;
  readonly on: number;
}

/** The kind's stage on `feed`, switched as `toggle` says or never; input and output. */
async function render(
  kind: Kind,
  feed: Feed,
  seconds: number,
  toggle?: Switch,
  spec: InsertSpec = openSpec(kind),
) {
  const c: FakeContext = new TimedContext();
  await c.audioWorklet.addModule('fm-processor.js');
  await c.audioWorklet.addModule('reverb-processor.js');
  const source = new FakeWorkletNode(c, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = feed;
  const stage = INSERT_KINDS[kind].create(c.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(c.destination);
  if (toggle?.how === 'lane') {
    const lane = stage.param!('enabled')!;
    lane.schedule(0, toggle.off, 'set');
    lane.schedule(1, toggle.on, 'set');
  }
  const pending = toggle?.how === 'spec' ? [toggle.off, toggle.on] : [];
  const [input, output] = renderGraph(c, seconds, [source, fake(stage.output)], (_, time) => {
    if (pending.length === 0 || time < pending[0]!) return;
    pending.shift();
    stage.set({ ...spec, enabled: pending.length === 0 } as InsertSpec);
  });
  return { input: input!, output: output!, rate: c.sampleRate };
}

/** The largest sample-to-sample step in either channel, from `from` to `to`. */
function maxStep(capture: Capture, from = 1, to = capture.left.length): number {
  let largest = 0;
  for (const channel of [capture.left, capture.right]) {
    for (let i = Math.max(1, from); i < to; i++) {
      largest = Math.max(largest, Math.abs(channel[i]! - channel[i - 1]!));
    }
  }
  return largest;
}

/** The largest difference between two captures, both channels, from `from` to `to`. */
function maxDiff(a: Capture, b: Capture, from: number, to: number): number {
  let largest = 0;
  for (const [x, y] of [
    [a.left, b.left],
    [a.right, b.right],
  ] as const) {
    for (let i = from; i < to; i++) largest = Math.max(largest, Math.abs(x[i]! - y[i]!));
  }
  return largest;
}

const cases = KINDS.flatMap((kind) => HOWS.map((how) => ({ kind, how })));
const sine = tones(SINE_HZ, SINE_HZ);

describe('switching a native insert off and on under a steady sine', () => {
  it.each(cases)('$kind by $how: no step beyond the signal, and off is dry', async (c) => {
    const held = await render(c.kind, sine, SECONDS);
    const switched = await render(c.kind, sine, SECONDS, { how: c.how, off: OFF_AT, on: ON_AT });
    const own = Math.max(maxStep(held.input), maxStep(held.output));
    expect(maxStep(switched.output)).toBeLessThanOrEqual(own + TOLERANCE);

    const offFrom = Math.ceil((OFF_AT + INSERT_SWITCH_FADE_S) * switched.rate) + 128;
    const offTo = Math.floor(ON_AT * switched.rate);
    expect(maxDiff(switched.output, switched.input, offFrom, offTo)).toBeLessThan(DRY_TOLERANCE);
  });
});

describe('switching on again after a long off', () => {
  /** A burst, then silence: whatever plays after the switch on is the old tail. */
  const hit = burst(tones(330, 440), 0.1);
  const off = 0.15;
  const on = off + DEFAULT_ECHO.delayTime + 0.1;
  const seconds = on + 0.3;

  it.each([
    { kind: 'echo' as const, how: 'spec' as const },
    { kind: 'echo' as const, how: 'lane' as const },
    { kind: 'plate' as const, how: 'spec' as const },
    { kind: 'plate' as const, how: 'lane' as const },
  ])('$kind by $how: plays none of the tail from before the off', async (c) => {
    const held = await render(c.kind, hit, seconds);
    const switched = await render(c.kind, hit, seconds, { how: c.how, off, on });
    const from = Math.ceil(on * switched.rate);
    const to = switched.output.left.length;
    const silence = { left: new Float32Array(to), right: new Float32Array(to) };
    expect(maxDiff(held.output, silence, from, to), 'held on, the tail rings').toBeGreaterThan(
      0.001,
    );
    expect(maxDiff(switched.output, silence, from, to)).toBeLessThan(SILENT);
  });
});

/** `feed` from `from` seconds for `seconds`, silence either side. */
function burstAt(feed: Feed, from: number, seconds: number): Feed {
  const first = Math.round((from * SAMPLE_RATE) / BLOCK);
  const until = first + Math.round((seconds * SAMPLE_RATE) / BLOCK);
  return (block, left, right) => {
    if (block >= first && block < until) feed(block, left, right);
  };
}

/** The largest magnitude in either channel, from `from` to the end. */
function peakFrom(capture: Capture, from: number): number {
  let largest = 0;
  for (const channel of [capture.left, capture.right]) {
    for (let i = from; i < channel.length; i++) largest = Math.max(largest, Math.abs(channel[i]!));
  }
  return largest;
}

describe('switching on again one sample after the fade out ends (fix round 1 for PR #635)', () => {
  /** A burst, then silence: the old tail is all a switch on could bring back. */
  const hit = burst(tones(330, 440), 0.1);
  /**
   * At a quantum's start, where the button lands too, so the fade out ends
   * at the same sample either way. The lane's switch on then falls within
   * the quantum the fade out ends in; the button's waits for the next.
   */
  const off = (57 * BLOCK) / SAMPLE_RATE;
  const on = off + INSERT_SWITCH_FADE_S + 1 / SAMPLE_RATE;
  /** Past the old repeats' second pass through the Echo's loop. */
  const seconds = on + 3 * DEFAULT_ECHO.delayTime;

  it.each(cases.filter((c) => c.kind === 'echo' || c.kind === 'plate'))(
    '$kind by $how: plays none of the old tail',
    async (c) => {
      const held = await render(c.kind, hit, seconds);
      const switched = await render(c.kind, hit, seconds, { how: c.how, off, on });
      const from = Math.ceil(on * switched.rate);
      expect(peakFrom(held.output, from), 'held on, the tail rings').toBeGreaterThan(0.001);
      expect(peakFrom(switched.output, from)).toBe(0);
    },
  );

  it.each(HOWS)('echo by %s: loses no repeat of what comes after the switch on', async (how) => {
    // New input just after the switch on; a fresh Echo, never switched, hears it alone.
    const again = on + 2 * INSERT_SWITCH_FADE_S;
    const next = burstAt(tones(330, 440), again, 0.05);
    const both: Feed = (block, left, right) => {
      hit(block, left, right);
      next(block, left, right);
    };
    const fresh = await render('echo', next, seconds);
    const switched = await render('echo', both, seconds, { how, off, on });
    // From the loop's reopening, once its fade in is over.
    const open = off + 2 * INSERT_SWITCH_FADE_S + DEFAULT_ECHO.delayTime;
    const from = Math.ceil(open * SAMPLE_RATE);
    const firstRepeat = Math.floor((again + DEFAULT_ECHO.delayTime) * SAMPLE_RATE);
    expect(peakFrom(fresh.output, firstRepeat)).toBeGreaterThan(0.01);
    expect(maxDiff(switched.output, fresh.output, from, fresh.output.left.length)).toBeLessThan(
      SILENT,
    );
  });
});

describe.each([DELAY_DAMP_MIN_HZ, DELAY_DAMP_MAX_HZ])(
  'switching the Echo on again while its damp filter rings at %d Hz (fix rounds 2 and 3 for PR #635)',
  (damp) => {
    const spec = {
      ...DEFAULT_ECHO,
      delayTime: 0.02,
      damp,
      resonance: DELAY_RESONANCE_MAX_DB,
      feedback: DELAY_FEEDBACK_MAX,
      mix: 1,
    };
    /** One sample at full scale, then silence. */
    const impulse: Feed = (block, left, right) => {
      if (block !== 0) return;
      left[0] = 1;
      right[0] = 1;
    };
    const off = (57 * BLOCK) / SAMPLE_RATE;
    const on = off + INSERT_SWITCH_FADE_S + 1 / SAMPLE_RATE;
    /** Past the loop's reopening, once the line has emptied and the filter rung out. */
    const ring = ringTime(spec.damp, spec.resonance, SAMPLE_RATE);
    const reopen = off + INSERT_SWITCH_FADE_S + spec.delayTime + ring;
    const seconds = reopen + 0.1;

    /** -90 dBFS: the ring's floor, from a full-scale impulse. */
    const floor = dbToGain(-90);

    it.each(HOWS)('echo by %s: plays the old tail only below -90 dBFS', async (how) => {
      const held = await render('echo', impulse, seconds, undefined, spec);
      const switched = await render('echo', impulse, seconds, { how, off, on }, spec);
      const from = Math.ceil(on * SAMPLE_RATE);
      expect(peakFrom(held.output, from), 'held on, the filter rings').toBeGreaterThan(10 * floor);
      expect(peakFrom(switched.output, from)).toBeLessThan(floor);
    });
  },
);
