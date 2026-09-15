/**
 * Dormant voices (#547): a held note whose carriers have decayed to a sustain of
 * 0 stops costing a render and stops holding a voice slot against audible notes,
 * and nothing that could be heard changes. Every "before" here is the same part
 * built with `dormancy: false`, rendered in the same test -- never a literal.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from './__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from './__fixtures__/workletHarness';
import { FILTER_MODE, makePatch } from './patch';
import type { PartialPatch, Patch } from './patch';
import { PRESET_NAMES, PRESETS } from './presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES);

/** −120 dB, as an amplitude ratio. */
const RESIDUAL_RATIO = 1e-6;
/** The worklet's own dormancy floors, read out of it. */
const { dormantAmp, dormantFilterState } = loaded;

const NOTE = 60;
const VELOCITY = 0.9;
const DECAY_S = 0.05;
/** Well past DECAY_S, so the carrier has settled in sustain at 0. */
const SETTLE_S = 0.4;
const HOLD_S = 1;
const TAIL_S = 1.5;

interface VoiceState {
  active: boolean;
  fading: boolean;
  gate: boolean;
  voiceId: number;
  dormant: boolean;
  amp: Float32Array;
  alg: { carriers: number[] };
  ampEnv: { state: number }[];
  svfA: { ic1: number; ic2: number };
  render: (...args: unknown[]) => void;
}

const voicesOf = (processor: ProcessorLike): VoiceState[] =>
  processor.voices as unknown as VoiceState[];
const activeVoices = (processor: ProcessorLike): VoiceState[] =>
  voicesOf(processor).filter((v) => v.active);

const noteOn = (id: number, note = NOTE, frame = 0): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note,
  velocity: VELOCITY,
  frame,
});

/** A lone sine that plucks and decays to a sustain of 0: silent while still held. */
const pluck = (over: PartialPatch = {}): Patch =>
  makePatch({
    ops: [{ level: 1, env: { attackTime: 0.002, decayTime: DECAY_S, sustainLevel: 0 } }],
    ...over,
  });

const largestStep = (samples: Float32Array, from: number, to: number): number => {
  let step = 0;
  for (let i = from + 1; i < to; i++) {
    step = Math.max(step, Math.abs((samples[i * 2] ?? 0) - (samples[(i - 1) * 2] ?? 0)));
  }
  return step;
};

describe('a silent held note', () => {
  it('goes dormant, is no longer rendered, and leaves the part exactly silent', () => {
    const processor = loaded.create(pluck(), 8);
    const lit = render(loaded, processor, blocksFor(SETTLE_S), [noteOn(1)]);
    expect(lit.peak).toBeGreaterThan(0);

    const [voice] = activeVoices(processor);
    expect(voice?.dormant).toBe(true);
    // Still holding its note: dormancy is not release.
    expect(voice?.gate).toBe(true);

    let renders = 0;
    const original = voice!.render.bind(voice);
    voice!.render = (...args: unknown[]) => {
      renders++;
      original(...args);
    };
    const after = render(loaded, processor, blocksFor(HOLD_S));

    expect(renders).toBe(0);
    expect(after.samples.every((s) => s === 0)).toBe(true);
    expect(activeVoices(processor)).toHaveLength(1);
  });

  it('renders in full with dormancy off, which is what the saving is', () => {
    const processor = loaded.create(pluck(), 8, undefined, { dormancy: false });
    render(loaded, processor, blocksFor(SETTLE_S), [noteOn(1)]);
    const [voice] = activeVoices(processor);
    let renders = 0;
    const original = voice!.render.bind(voice);
    voice!.render = (...args: unknown[]) => {
      renders++;
      original(...args);
    };
    render(loaded, processor, blocksFor(HOLD_S));
    expect(renders).toBeGreaterThan(0);
  });
});

describe('the factory bank', () => {
  /** One note held for HOLD_S then released, rendered through its tail. */
  const heldAndReleased = (patch: Patch, dormancy: boolean) => {
    const processor = loaded.create(patch, 16, undefined, { dormancy });
    const held = render(loaded, processor, blocksFor(HOLD_S), [noteOn(1)]);
    const wentDormant = activeVoices(processor).some((v) => v.dormant);
    const tail = render(loaded, processor, blocksFor(TAIL_S), [
      { type: 'noteOff', id: 1, frame: 0 },
    ]);
    const samples = new Float32Array(held.samples.length + tail.samples.length);
    samples.set(held.samples);
    samples.set(tail.samples, held.samples.length);
    return { samples, peak: Math.max(held.peak, tail.peak), wentDormant };
  };

  it('renders every preset identically with and without dormancy, to -120 dB', () => {
    let dormantPresets = 0;
    for (const name of PRESET_NAMES) {
      const patch = PRESETS[name] as Patch;
      const before = heldAndReleased(patch, false);
      const after = heldAndReleased(patch, true);
      if (after.wentDormant) dormantPresets++;

      let residual = 0;
      for (let i = 0; i < before.samples.length; i++) {
        residual = Math.max(residual, Math.abs((before.samples[i] ?? 0) - (after.samples[i] ?? 0)));
      }
      expect(residual, name).toBeLessThanOrEqual(before.peak * RESIDUAL_RATIO);
    }
    // Otherwise the comparison above proves nothing about the dormant path.
    expect(dormantPresets).toBeGreaterThan(0);
  });
});

describe('a resonant filter still ringing', () => {
  it('keeps the voice awake until the ring falls below the floor', () => {
    const patch = pluck({
      ops: [{ level: 1, env: { attackTime: 0.001, decayTime: 0.005, sustainLevel: 0 } }],
      filter: { mode: FILTER_MODE.LOWPASS, cutoff: 200, resonance: 40 },
    });
    const processor = loaded.create(patch, 4);
    let carriersSilentAt = -1;
    let ringingAtCarrierSilence = 0;
    let dormantAt = -1;

    for (let b = 0; b < blocksFor(10) && dormantAt < 0; b++) {
      render(loaded, processor, 1, b === 0 ? [noteOn(1)] : []);
      const [voice] = activeVoices(processor);
      if (!voice) break;
      const carriers = voice.alg.carriers;
      const silent = carriers.every(
        (c) =>
          voice.ampEnv[c]?.state === loaded.sustainState &&
          Math.abs(voice.amp[c] ?? 1) <= dormantAmp,
      );
      const ring = Math.max(Math.abs(voice.svfA.ic1), Math.abs(voice.svfA.ic2));
      if (silent && carriersSilentAt < 0) {
        carriersSilentAt = b;
        ringingAtCarrierSilence = ring;
        expect(voice.dormant).toBe(false);
      }
      if (voice.dormant) {
        dormantAt = b;
        expect(ring).toBeLessThanOrEqual(dormantFilterState);
      }
    }

    expect(carriersSilentAt).toBeGreaterThanOrEqual(0);
    expect(ringingAtCarrierSilence).toBeGreaterThan(dormantFilterState);
    expect(dormantAt).toBeGreaterThan(carriersSilentAt);
  });
});

describe('allocation and note-off', () => {
  const LIMIT = 4;
  /** Long enough to still be sounding when the steal happens. */
  const audiblePluck = (): Patch =>
    pluck({ ops: [{ level: 1, env: { attackTime: 0.002, decayTime: 1, sustainLevel: 0 } }] });

  it('kills the dormant voice for a new note at the limit, and fades no audible one', () => {
    const processor = loaded.create(audiblePluck(), LIMIT);
    // The first note goes dormant; the next LIMIT - 1 are mid-decay, and audible.
    render(loaded, processor, blocksFor(1.5), [noteOn(1)]);
    const dormantVoice = activeVoices(processor)[0];
    expect(dormantVoice?.dormant).toBe(true);
    const audible: ScheduledEvent[] = [2, 3, 4].map((id) => noteOn(id, NOTE + id));
    render(loaded, processor, blocksFor(0.05), audible);
    expect(activeVoices(processor)).toHaveLength(LIMIT);

    render(loaded, processor, 2, [noteOn(5, NOTE + 5)]);

    expect(voicesOf(processor).filter((v) => v.fading)).toHaveLength(0);
    expect(dormantVoice?.voiceId).toBe(5);
    expect(activeVoices(processor)).toHaveLength(LIMIT);
    for (const id of [2, 3, 4]) {
      expect(activeVoices(processor).some((v) => v.voiceId === id && !v.dormant)).toBe(true);
    }
  });

  it('frees a dormant voice on its note-off', () => {
    const processor = loaded.create(pluck(), 8);
    render(loaded, processor, blocksFor(SETTLE_S), [noteOn(1)]);
    expect(activeVoices(processor)[0]?.dormant).toBe(true);

    const off = render(loaded, processor, 1, [{ type: 'noteOff', id: 1, frame: 0 }]);
    expect(activeVoices(processor)).toHaveLength(0);
    expect(off.samples.every((s) => s === 0)).toBe(true);
  });

  it('never sleeps a voice whose release rises to an end level, so that release is unchanged', () => {
    // Skipping freezes pitch, filter and LFO state as well as the carriers, so
    // a release that is sound must never start from a dormant voice.
    const patch = pluck({
      ops: [{ level: 1, env: { decayTime: DECAY_S, sustainLevel: 0, endLevel: 0.5 } }],
      pitchEnv: { initLevel: 1, attackTime: 2, peakLevel: 0, sustainLevel: 0 },
      pitchEnvAmount: 1,
    });
    const run = (dormancy: boolean) => {
      const processor = loaded.create(patch, 8, undefined, { dormancy });
      render(loaded, processor, blocksFor(SETTLE_S), [noteOn(1)]);
      const wasDormant = activeVoices(processor).some((v) => v.dormant);
      const off = render(loaded, processor, blocksFor(0.2), [{ type: 'noteOff', id: 1, frame: 0 }]);
      return { wasDormant, off };
    };
    const before = run(false);
    const after = run(true);
    expect(after.wasDormant).toBe(false);
    expect(after.off.peak).toBeGreaterThan(0);
    expect(after.off.samples).toEqual(before.off.samples);
  });

  it('wakes on a live retune that raises the sustain, ramping up without a step', () => {
    const processor = loaded.create(pluck(), 8);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    render(loaded, processor, blocksFor(SETTLE_S), [noteOn(1)]);
    const [voice] = activeVoices(processor);
    expect(voice?.dormant).toBe(true);

    processor.inbox({
      type: 'patch',
      patch: pluck({ ops: [{ level: 1, env: { decayTime: DECAY_S, sustainLevel: 0.8 } }] }),
    } as unknown as ScheduledEvent);
    const woken = render(loaded, processor, blocksFor(0.5));
    expect(voice?.dormant).toBe(false);

    const ramp = loaded.ctrlInterval;
    const frames = woken.samples.length / 2;
    // The settled sine, well after the ramp: its peak and its own largest step.
    const steadyFrom = frames >> 1;
    let steadyPeak = 0;
    for (let i = steadyFrom; i < frames; i++) {
      steadyPeak = Math.max(steadyPeak, Math.abs(woken.samples[i * 2] ?? 0));
    }
    expect(steadyPeak).toBeGreaterThan(0);
    // Each ramp sample is bounded by its share of the settled level.
    const tolerance = 1.01;
    for (let k = 0; k < ramp; k++) {
      const bound = ((steadyPeak * (k + 1)) / ramp) * tolerance;
      expect(Math.abs(woken.samples[k * 2] ?? 0)).toBeLessThanOrEqual(bound);
    }
    const steadyStep = largestStep(woken.samples, steadyFrom, frames);
    expect(largestStep(woken.samples, 0, ramp * 2)).toBeLessThanOrEqual(
      steadyStep + (steadyPeak / ramp) * tolerance,
    );
  });
});
