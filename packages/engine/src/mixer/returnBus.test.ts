/**
 * The send buses (windsor#172): a chain and a level. By default Send A and
 * Send B render exactly what the fixed `room` and `echo` returns rendered,
 * built here from the returns' own builders; an empty chain passes the sends
 * through at the bus's level; a settings edit is param writes and any other
 * list re-wires inside the fade, the level untouched.
 *
 * The echo's loop (#647): a resonant damping lowpass and a soft clip. A high
 * Regen with the resonance up runs away at the damping frequency — wanted —
 * and the clip holds it to a stated bound. At the Butterworth floor the
 * repeats always fade, and at ordinary levels the clip is transparent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { biquadL1, burst, rms, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import {
  FakeContext,
  FakeWorkletNode,
  installFakeAudioWorklet,
  renderGraph,
} from '../__fixtures__/fakeAudioContext';
import type { FakeBiquad, FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { FakeWaveShaper } from '../__fixtures__/fakeWaveShaper';
import {
  DELAY_CLIP_CEILING,
  DELAY_CLIP_CURVE_POINTS,
  DELAY_FEEDBACK_MAX,
  DELAY_RESONANCE_DEFAULT_DB,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
} from '../audioConstants';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import type { EchoSpec } from '../inserts/echoInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import type { ReturnSpec } from './mix';
import { RETURNS, onSendBus } from './mix';
import { createReturn, delayClipCurve } from './returnBus';
import { PLATE_FULLY_WET, attachDelay, createPlate } from './returnEffects';
import { SPACES } from './reverbSpace';
import { PROCESSOR_NAME } from '../synth/workletMessages';

const ECHO = RETURNS.b.inserts[0] as EchoSpec;
const RUNAWAY_SECONDS = 10;
const REPEATS = 20;
/** Past the Butterworth floor's decay test, the runaway must still be sounding. */
const SUSTAIN_FRACTION = 0.1;
const DECAY_FEEDBACK = 0.9;
const MODERATE_FEEDBACK = 0.5;
const LOUD_DBFS = -12;
const QUIET_DBFS = -60;
const BURST_SECONDS = 0.05;
const TONE_HZ = 440;
const TRANSPARENT_DB = 0.1;
const PARITY_SECONDS = 1.5;
const EDIT_LEVEL = 0.35;

const fromDb = (db: number): number => 10 ** (db / 20);
const db = (ratio: number): number => 20 * Math.log10(ratio);
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const now = (run: () => void): void => run();

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
});
afterAll(() => restore());

const impulse =
  (amplitude: number) =>
  (block: number, left: Float32Array, right: Float32Array): void => {
    if (block !== 0) return;
    left[0] = amplitude;
    right[0] = amplitude;
  };

async function rig(feed: FakeWorkletNode['feed']): Promise<{ c: FakeContext; source: FakeNode }> {
  const c = new FakeContext();
  await c.audioWorklet.addModule('fm-processor.js');
  await c.audioWorklet.addModule('reverb-processor.js');
  const source = new FakeWorkletNode(c, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = feed;
  return { c, source };
}

/** Render a bus of `spec` fed by `feed`; the capture is the bus's output. */
async function renderBus(
  spec: ReturnSpec,
  feed: FakeWorkletNode['feed'],
  seconds: number,
): Promise<{ out: Capture; context: FakeContext }> {
  const { c, source } = await rig(feed);
  const bus = createReturn(c.asAudioContext(), 'b', spec, c.destination as never, { defer: now });
  source.connect(fake(bus.input));
  const [out] = renderGraph(c, seconds, [fake(bus.output)]);
  if (!out) throw new Error('render produced no capture');
  return { out, context: c };
}

/**
 * The fixed return as it was built before windsor#172, from the same
 * builders: `input → plate (fully wet) → level` for `room`, and
 * `input → delay loop → level` for `echo`.
 */
async function renderOldReturn(
  kind: 'room' | 'echo',
  feed: FakeWorkletNode['feed'],
): Promise<Capture> {
  const { c, source } = await rig(feed);
  const context = c.asAudioContext();
  const input = context.createGain();
  const output = context.createGain();
  output.gain.value = kind === 'room' ? RETURNS.a.level : RETURNS.b.level;
  if (kind === 'room') {
    const plate = createPlate(context, SPACES.hall, PLATE_FULLY_WET);
    input.connect(plate);
    plate.connect(output);
  } else {
    attachDelay(context, input, output, ECHO);
  }
  source.connect(fake(input));
  const [out] = renderGraph(c, PARITY_SECONDS, [fake(output)]);
  if (!out) throw new Error('render produced no capture');
  return out;
}

function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i] ?? 0));
  return max;
}

describe('the default send buses', () => {
  const feed = burst(tones(330, 440), BURST_SECONDS);

  it("renders Send A exactly as the room return's plate rendered", async () => {
    const { out } = await renderBus(RETURNS.a, feed, PARITY_SECONDS);
    const old = await renderOldReturn('room', feed);
    expect(rms(out.left)).toBeGreaterThan(0);
    expect(out.left).toEqual(old.left);
    expect(out.right).toEqual(old.right);
  });

  it("renders Send B exactly as the echo return's line rendered", async () => {
    const { out } = await renderBus(RETURNS.b, feed, PARITY_SECONDS);
    const old = await renderOldReturn('echo', feed);
    expect(rms(out.left)).toBeGreaterThan(0);
    expect(out.left).toEqual(old.left);
    expect(out.right).toEqual(old.right);
  });

  it('passes its sends to the master unprocessed, at its level, with an empty chain', async () => {
    const { c, source } = await rig(feed);
    const bus = createReturn(
      c.asAudioContext(),
      'a',
      { level: 0.5, inserts: [] },
      c.destination as never,
    );
    source.connect(fake(bus.input));
    const [input, out] = renderGraph(c, BURST_SECONDS * 2, [source, fake(bus.output)]);
    expect(rms(input!.left)).toBeGreaterThan(0);
    expect(out!.left).toEqual(input!.left.map((v) => v * 0.5));
  });
});

describe('a bus chain edit', () => {
  it('writes settings onto the live stages, and keeps the level', async () => {
    const { c } = await rig(impulse(1));
    const bus = createReturn(c.asAudioContext(), 'b', RETURNS.b, c.destination as never, {
      defer: now,
    });
    const stage = bus.inserts[0];
    bus.setLevel(EDIT_LEVEL);
    bus.setInserts([{ ...ECHO, feedback: 0.5 }]);
    expect(bus.inserts[0]).toBe(stage);
    expect(bus.spec).toEqual({ level: EDIT_LEVEL, inserts: [{ ...ECHO, feedback: 0.5 }] });
  });

  it('re-wires any other list inside the fade: a mixed chain, then none, then a plate back', async () => {
    const { c, source } = await rig(impulse(1));
    const waits: number[] = [];
    const defer = (run: () => void, seconds: number): void => {
      waits.push(seconds);
      run();
    };
    const bus = createReturn(c.asAudioContext(), 'b', RETURNS.b, c.destination as never, { defer });
    source.connect(fake(bus.input));
    bus.setInserts([ECHO, DEFAULT_CHORUS]);
    expect(bus.inserts.map((s) => s.kind)).toEqual(['echo', 'chorus']);
    bus.setInserts([]);
    expect(bus.inserts).toEqual([]);
    const plate = onSendBus(DEFAULT_PLATE_REVERB);
    bus.setInserts([plate]);
    expect(bus.spec).toEqual({ level: RETURNS.b.level, inserts: [plate] });
    expect(waits).toHaveLength(3);
    expect(bus.level.value).toBe(RETURNS.b.level);
  });

  it('disconnects everything it built on dispose, and a waiting re-wire never runs', async () => {
    const { c } = await rig(impulse(1));
    let later: (() => void) | null = null;
    const defer = (run: () => void): void => {
      later = run;
    };
    const bus = createReturn(c.asAudioContext(), 'a', RETURNS.a, c.destination as never, { defer });
    bus.setInserts([DEFAULT_ECHO]);
    bus.dispose();
    (later as (() => void) | null)?.();
    expect(fake(bus.output).outbound).toEqual([]);
    expect(fake(bus.input).outbound).toEqual([]);
    expect(bus.inserts.map((s) => s.kind)).toEqual(['plate']);
  });
});

describe('delayClipCurve', () => {
  const curve = delayClipCurve();
  const mid = (DELAY_CLIP_CURVE_POINTS - 1) / 2;

  it('is odd-length with an exact zero at its centre, and odd-symmetric', () => {
    expect(curve.length % 2).toBe(1);
    expect(curve[mid]).toBe(0);
    for (const i of [1, 100, mid - 1])
      expect(curve[mid + i]).toBeCloseTo(-(curve[mid - i] ?? 0), 6);
  });

  it('rises monotonically and never passes the ceiling', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]! >= curve[i - 1]!).toBe(true);
      expect(Math.abs(curve[i]!)).toBeLessThanOrEqual(DELAY_CLIP_CEILING);
    }
  });
});

describe('the echo loop', () => {
  /** Send B at unity, holding one Echo of `echo`. */
  const echoBus = (echo: EchoSpec): ReturnSpec => ({ level: 1, inserts: [echo] });

  it('runs delay → damp → feedback → clip input → clip → delay, oversampled, at the spec resonance', () => {
    const context = new FakeContext().asAudioContext();
    const output = context.createGain();
    const line = attachDelay(context, context.createGain(), output, ECHO);
    const delay = fake(line.effect);
    const damp = delay.outbound[0]?.to as FakeBiquad;
    expect(damp.kind).toBe('biquad');
    expect(damp.Q.value).toBe(DELAY_RESONANCE_DEFAULT_DB);
    const feedback = damp.outbound.map((c) => c.to).find((n) => n !== fake(output));
    const clipIn = feedback?.outbound[0]?.to;
    const clip = clipIn?.outbound[0]?.to as FakeWaveShaper | undefined;
    expect(clip?.kind).toBe('waveshaper');
    expect(clip?.oversample).toBe('2x');
    expect(clip?.outbound[0]?.to).toBe(delay);
  });

  it('keeps a full runaway sounding, and bounded by the clip ceiling', async () => {
    const spec = { ...ECHO, feedback: DELAY_FEEDBACK_MAX, resonance: DELAY_RESONANCE_MAX_DB };
    const { out, context } = await renderBus(
      echoBus(spec),
      impulse(DELAY_CLIP_CEILING),
      RUNAWAY_SECONDS,
    );
    const bound =
      DELAY_CLIP_CEILING * biquadL1({ type: 'lowpass', frequency: spec.damp, Q: spec.resonance });
    expect(out.left.every(Number.isFinite)).toBe(true);
    expect(peak(out.left)).toBeLessThanOrEqual(bound);
    const lastSecond = out.left.length - context.sampleRate;
    expect(peak(out.left, lastSecond)).toBeGreaterThan(SUSTAIN_FRACTION * DELAY_CLIP_CEILING);
  });

  it('fades every repeat at the Butterworth floor, below feedback 1', async () => {
    const spec = { ...ECHO, feedback: DECAY_FEEDBACK, resonance: DELAY_RESONANCE_MIN_DB };
    const seconds = (REPEATS + 1) * spec.delayTime;
    const { out, context } = await renderBus(echoBus(spec), impulse(DELAY_CLIP_CEILING), seconds);
    const window = Math.round(spec.delayTime * context.sampleRate);
    const energies: number[] = [];
    for (let k = 1; k <= REPEATS; k++) energies.push(rms(out.left, k * window, (k + 1) * window));
    for (let k = 1; k < energies.length; k++) {
      expect(energies[k]!, `repeat ${k + 1}`).toBeLessThan(energies[k - 1]!);
    }
  });

  it('is transparent at ordinary levels: a −12 dBFS echo scales like a −60 dBFS one', async () => {
    const spec = { ...ECHO, feedback: MODERATE_FEEDBACK, resonance: DELAY_RESONANCE_DEFAULT_DB };
    const seconds = REPEATS * spec.delayTime;
    const render = async (dbfs: number): Promise<number> => {
      const feed = burst(tones(TONE_HZ, TONE_HZ, fromDb(dbfs)), BURST_SECONDS);
      return rms((await renderBus(echoBus(spec), feed, seconds)).out.left);
    };
    const loud = await render(LOUD_DBFS);
    const quiet = await render(QUIET_DBFS);
    expect(Math.abs(db(loud / (quiet * fromDb(LOUD_DBFS - QUIET_DBFS))))).toBeLessThan(
      TRANSPARENT_DB,
    );
  });
});
