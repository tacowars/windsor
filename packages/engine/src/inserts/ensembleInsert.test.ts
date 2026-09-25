/**
 * The ensemble insert (#695): three delay lines 120° apart, each swept by a
 * slow plus a fast LFO. Phases are read from the rendered delay-time
 * modulation — before and after a `set` that changes both rates, the case
 * that separates a sine-and-cosine basis from staggered starts.
 */
import { describe, expect, it } from 'vitest';

import { tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeNode, FakeGain } from '../__fixtures__/fakeAudioNodes';
import { BLOCK, FakeDelay, FakeMerger } from '../__fixtures__/fakeAudioNodes';
import { FakeOscillator } from '../__fixtures__/fakeOscillator';
import { FieldNormaliser } from '../song/arrangementFields';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { ENSEMBLE_BOUNDS, ENSEMBLE_LINE_PHASES_DEG } from './ensembleConstants';
import { ENSEMBLE_INSERT } from './ensembleInsert';
import type { EnsembleSpec } from './ensembleSpec';
import { DEFAULT_ENSEMBLE, ENSEMBLE_NUMBERS } from './ensembleSpec';

const MS = 1000;
/** Rates with a whole number of cycles in each window, so the two LFOs project apart. */
const WINDOW_SECONDS = 2;
const BEFORE = { slowRate: 1, fastRate: 5 };
const AFTER = { slowRate: 1.5, fastRate: 7 };
const PHASE_TOLERANCE_DEG = 0.5;

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const lines = (context: FakeContext): FakeDelay[] =>
  context.nodes.filter((n): n is FakeDelay => n instanceof FakeDelay);
const oscillators = (context: FakeContext): FakeOscillator[] =>
  context.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator);

/** Amplitude and phase (degrees, sine-referenced) of `x` at `hz`. */
function project(x: Float32Array, hz: number, rate: number): { amp: number; deg: number } {
  let i = 0;
  let q = 0;
  x.forEach((v, n) => {
    const w = (2 * Math.PI * hz * n) / rate;
    i += v * Math.sin(w);
    q += v * Math.cos(w);
  });
  return { amp: (2 * Math.hypot(i, q)) / x.length, deg: (Math.atan2(q, i) * 180) / Math.PI };
}

const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/** Each line's delay-time swing (seconds, centre removed), per sample, over `seconds`. */
function modulation(
  spec: EnsembleSpec,
  seconds: number,
  onBlock?: (b: number, set: (s: EnsembleSpec) => void) => void,
): { swings: Float32Array[]; rate: number } {
  const context = new FakeContext();
  const stage = ENSEMBLE_INSERT.create(context.asAudioContext(), spec);
  const delays = lines(context);
  const blocks = Math.round((seconds * context.sampleRate) / BLOCK);
  const swings = delays.map(() => new Float32Array(blocks * BLOCK));
  renderGraph(context, seconds, [], (b) => {
    onBlock?.(b, stage.set);
    delays.forEach((d, i) => {
      const times = d.delayTime.valuesAt(b).map((t) => t - d.delayTime.value);
      swings[i]!.set(times, b * BLOCK);
    });
  });
  return { swings, rate: context.sampleRate };
}

async function render(
  spec: EnsembleSpec,
  seconds = 0.5,
): Promise<{ input: Capture; output: Capture }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(440, 660, 0.25);
  const stage = ENSEMBLE_INSERT.create(context.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(context.destination);
  const [input, output] = renderGraph(context, seconds, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output };
}

describe('the ensemble phase lock', () => {
  it('holds the three lines 0°, 120° and 240° apart, through a set that changes both rates', () => {
    const spec = { ...DEFAULT_ENSEMBLE, ...BEFORE, slowDepth: 2, fastDepth: 0.5, delay: 10 };
    const perWindow = Math.round((WINDOW_SECONDS * 48000) / BLOCK);
    const { swings, rate } = modulation(spec, 2 * WINDOW_SECONDS, (b, set) => {
      if (b === perWindow) set({ ...spec, ...AFTER });
    });
    const n = perWindow * BLOCK;
    for (const [window, rates] of [
      [0, BEFORE],
      [1, AFTER],
    ] as const) {
      for (const hz of [rates.slowRate, rates.fastRate]) {
        const phases = swings.map((s) =>
          project(s.subarray(window * n, (window + 1) * n), hz, rate),
        );
        phases.forEach((p, i) => {
          const apart = wrap(p.deg - phases[0]!.deg);
          const want = ENSEMBLE_LINE_PHASES_DEG[i]!;
          expect(Math.abs(wrap(apart - want + 180) - 180), `line ${i} at ${hz} Hz`).toBeLessThan(
            PHASE_TOLERANCE_DEG,
          );
        });
      }
    }
  });
});

describe('the ensemble dual LFO', () => {
  const spectrum = (spec: EnsembleSpec): { slow: number; fast: number } => {
    const { swings, rate } = modulation(spec, WINDOW_SECONDS);
    return {
      slow: project(swings[0]!, spec.slowRate, rate).amp * MS,
      fast: project(swings[0]!, spec.fastRate, rate).amp * MS,
    };
  };
  const base = { ...DEFAULT_ENSEMBLE, ...BEFORE, slowDepth: 2, fastDepth: 0.5, delay: 10 };

  it('carries only the slow rate at fast depth 0, only the fast at slow depth 0, both with both', () => {
    const slowOnly = spectrum({ ...base, fastDepth: 0 });
    expect(slowOnly.slow).toBeCloseTo(base.slowDepth, 3);
    expect(slowOnly.fast).toBeLessThan(1e-6);
    const fastOnly = spectrum({ ...base, slowDepth: 0 });
    expect(fastOnly.fast).toBeCloseTo(base.fastDepth, 3);
    expect(fastOnly.slow).toBeLessThan(1e-6);
    const both = spectrum(base);
    expect(both.slow).toBeCloseTo(base.slowDepth, 3);
    expect(both.fast).toBeCloseTo(base.fastDepth, 3);
  });
});

describe('the ensemble bounds and stereo', () => {
  it('renders finite output with each field at its minimum and its maximum', async () => {
    for (const field of ENSEMBLE_NUMBERS) {
      for (const value of ENSEMBLE_BOUNDS[field]) {
        const { output } = await render({ ...DEFAULT_ENSEMBLE, [field]: value }, 0.1);
        const finite = output.left.every(Number.isFinite) && output.right.every(Number.isFinite);
        expect(finite, `${field} = ${value}`).toBe(true);
      }
    }
  });

  it('passes the dry signal exactly at Mix 0 and when switched off', async () => {
    for (const spec of [
      { ...DEFAULT_ENSEMBLE, mix: 0 },
      { ...DEFAULT_ENSEMBLE, mix: 1, enabled: false },
    ]) {
      const { input, output } = await render(spec);
      expect(output.left).toEqual(input.left);
      expect(output.right).toEqual(input.right);
    }
  });

  it('gives identical wet sides at Width 0 and different ones at Width 1', async () => {
    const narrow = await render({ ...DEFAULT_ENSEMBLE, mix: 1, width: 0 });
    expect(narrow.output.right).toEqual(narrow.output.left);
    const wide = await render({ ...DEFAULT_ENSEMBLE, mix: 1, width: 1 });
    expect(wide.output.left.some((v, i) => Math.abs(v - wide.output.right[i]!) > 1e-3)).toBe(true);
  });

  it('puts line 0 hard left and line 2 hard right at Width 1', () => {
    const context = new FakeContext();
    ENSEMBLE_INSERT.create(context.asAudioContext(), { ...DEFAULT_ENSEMBLE, width: 1 });
    const merge = context.nodes.find((n): n is FakeMerger => n instanceof FakeMerger)!;
    const sides = (line: FakeDelay): number[] => {
      const out = [0, 0];
      for (const edge of line.outbound) {
        const gain = edge.to as FakeGain;
        for (const next of gain.outbound) if (next.to === merge) out[next.input] = gain.gain.value;
      }
      return out;
    };
    const [first, centre, last] = lines(context);
    expect(sides(first!)).toEqual([1, 0]);
    expect(sides(last!)).toEqual([0, 1]);
    expect(sides(centre!)[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sides(centre!)[1]).toBe(sides(centre!)[0]);
  });
});

describe('the ensemble graph', () => {
  it('takes any set as param writes: the same nodes, the same edges', () => {
    const context = new FakeContext();
    const stage = ENSEMBLE_INSERT.create(context.asAudioContext(), DEFAULT_ENSEMBLE);
    const edges = (): unknown => context.nodes.map((n) => [[...n.outbound], [...n.paramOutbound]]);
    const count = context.nodes.length;
    const before = edges();
    stage.set({ ...DEFAULT_ENSEMBLE, ...AFTER, width: 0, tone: 2000, mix: 1, enabled: false });
    expect(context.nodes).toHaveLength(count);
    expect(edges()).toEqual(before);
  });

  it('stops all four oscillators on dispose and leaves only the strip edge out of its output', () => {
    const context = new FakeContext();
    const stage = ENSEMBLE_INSERT.create(context.asAudioContext(), DEFAULT_ENSEMBLE);
    const next = context.createGain();
    fake(stage.output).connect(next);
    const lfos = oscillators(context);
    expect(lfos).toHaveLength(4);
    expect(lfos.every((o) => o.started && !o.stopped && o.type === 'custom')).toBe(true);
    stage.dispose();
    expect(lfos.every((o) => o.stopped)).toBe(true);
    const wired = context.nodes.filter(
      (n) => n !== fake(stage.output) && (n.outbound.length > 0 || n.paramOutbound.length > 0),
    );
    expect(wired).toEqual([next].filter((n) => n.outbound.length > 0));
    expect(lines(context).every((d) => d.delayTime.inputs.length === 0)).toBe(true);
    expect(fake(stage.output).outbound.map((c) => c.to)).toEqual([next]);
  });
});

describe('ENSEMBLE_INSERT.normalise', () => {
  it('fills the defaults, clamps each field and reports unknown keys', () => {
    const n = new FieldNormaliser();
    const raw = { kind: 'ensemble', fastRate: 40, width: -1, enabled: 'no', wat: 1 };
    const spec = ENSEMBLE_INSERT.normalise(raw, 'x', n);
    expect(spec).toEqual({
      ...DEFAULT_ENSEMBLE,
      fastRate: ENSEMBLE_BOUNDS.fastRate[1],
      width: ENSEMBLE_BOUNDS.width[0],
    });
    expect(n.corrections).toHaveLength(4);
  });
});
