/**
 * DSP behaviour, rendered headlessly.
 *
 * These are the properties that are expensive to notice by ear and cheap to
 * assert: silence when idle, no NaN, bounded level, no allocation in the render
 * loop, and no discontinuity when a voice is stolen. None of them is a
 * performance claim -- see docs/design/audio-architecture.md 7 for why timing
 * measured here would not qualify under CLAUDE.md invariant 3.
 */
import { describe, expect, it } from 'vitest';

import { goertzel, loadProcessor, render } from './__fixtures__/workletHarness';
import type { ScheduledEvent } from './__fixtures__/workletHarness';
import { ALGORITHMS, WAVE, makePatch } from './patch';
import { PRESETS, PRESET_NAMES } from './presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;

const held = (note: number, frames: number): ScheduledEvent[] => [
  { type: 'noteOn', id: 1, note, velocity: 0.9, frame: 0 },
  { type: 'noteOff', id: 1, frame: frames },
];

describe('presets render clean audio', () => {
  it.each(PRESET_NAMES)('%s sounds, stays finite and does not clip', (name) => {
    const patch = PRESETS[name];
    expect(patch).toBeDefined();
    if (!patch) return;

    const result = render(loaded, loaded.create(patch), 400, held(60, 12000));
    expect(result.nonFinite).toBe(0);
    expect(result.peak).toBeGreaterThan(0.002);
    expect(result.peak).toBeLessThanOrEqual(1);
  });
});

describe('algorithms', () => {
  it.each(ALGORITHMS.map((a, i) => [i, a.label] as const))('%i (%s) produces output', (index) => {
    const patch = makePatch({
      algorithm: index,
      ops: [
        { wave: WAVE.SINE, ratio: 1, level: 1 },
        { wave: WAVE.SINE, ratio: 2, level: 0.8 },
        { wave: WAVE.SINE, ratio: 3, level: 0.7 },
        { wave: WAVE.SINE, ratio: 1.5, level: 0.6 },
      ],
    });
    const result = render(loaded, loaded.create(patch), 200, [
      { type: 'noteOn', id: 1, note: 57, velocity: 1, frame: 0 },
    ]);
    expect(result.nonFinite).toBe(0);
    expect(result.peak).toBeGreaterThan(0.01);
  });
});

describe('voice lifecycle', () => {
  it('emits exact silence with no notes', () => {
    const bell = PRESETS['lead-bell'];
    expect(bell).toBeDefined();
    if (!bell) return;
    expect(render(loaded, loaded.create(bell), 50, []).peak).toBe(0);
  });

  it('frees every voice once the release finishes', () => {
    const blip = PRESETS['pickup-blip'];
    expect(blip).toBeDefined();
    if (!blip) return;
    const processor = loaded.create(blip, 8);
    render(loaded, processor, 300, held(72, 2000));
    expect(processor.voices.filter((v) => v.active)).toHaveLength(0);
  });

  it('holds the sounding limit and steals without a click', () => {
    const pad = PRESETS['pad-drift'];
    expect(pad).toBeDefined();
    if (!pad) return;

    const maxVoices = 4;
    const processor = loaded.create(pad, maxVoices);
    const events: ScheduledEvent[] = [];
    for (let i = 0; i < 24; i++) {
      events.push({ type: 'noteOn', id: 100 + i, note: 48 + i, velocity: 0.8, frame: i * 600 });
    }

    const result = render(loaded, processor, 200, events);
    expect(result.nonFinite).toBe(0);
    expect(processor.voices.filter((v) => v.active && !v.fading).length).toBeLessThanOrEqual(
      maxVoices,
    );

    // A hard cut shows up as a large single-sample step; the 4 ms steal fade
    // keeps every step small.
    let maxStep = 0;
    for (let i = 2; i < result.samples.length; i += 2) {
      maxStep = Math.max(
        maxStep,
        Math.abs((result.samples[i] ?? 0) - (result.samples[i - 2] ?? 0)),
      );
    }
    expect(maxStep).toBeLessThan(0.25);
  });
});

describe('scheduling', () => {
  it('places a note within one sample of the requested frame', () => {
    const patch = makePatch({
      ops: [
        {
          wave: WAVE.SINE,
          ratio: 1,
          level: 1,
          env: { attackTime: 0.0002, sustainLevel: 1, decayTime: 0.5 },
        },
      ],
    });
    const target = 1000;
    const result = render(loaded, loaded.create(patch, 4), 20, [
      { type: 'noteOn', id: 1, note: 69, velocity: 1, frame: target },
    ]);

    let onset = -1;
    for (let i = 0; i < result.samples.length; i += 2) {
      if (Math.abs(result.samples[i] ?? 0) > 1e-5) {
        onset = i / 2;
        break;
      }
    }
    expect(onset).toBeGreaterThanOrEqual(target);
    expect(onset).toBeLessThanOrEqual(target + 1);
  });
});

describe('filter', () => {
  const sawPatch = (mode: number, cutoff = 8000) =>
    makePatch({
      algorithm: 7,
      filter: { mode, cutoff },
      ops: [
        {
          wave: WAVE.SAW,
          ratio: 1,
          level: 1,
          env: { attackTime: 0.001, sustainLevel: 1, decayTime: 1 },
        },
      ],
    });

  it('removes energy and stays stable when closed down', () => {
    const note: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
    const open = render(loaded, loaded.create(sawPatch(0)), 100, note);
    const closed = render(loaded, loaded.create(sawPatch(1, 120)), 100, note);

    expect(closed.rms).toBeLessThan(open.rms * 0.6);
    expect(closed.nonFinite).toBe(0);
    expect(closed.peak).toBeLessThan(4);
  });
});

describe('bandlimited wavetables', () => {
  // A correctly bandlimited oscillator cannot put energy below its own
  // fundamental. A naive one folds harmonics down there, audibly.
  const NOTE = 105;
  const f0 = 440 * Math.pow(2, (NOTE - 69) / 12);

  const worstAliasRatio = (wave: number): number => {
    const patch = makePatch({
      algorithm: 7,
      ops: [
        {
          wave,
          ratio: 1,
          level: 1,
          env: { attackTime: 0.001, sustainLevel: 1, decayTime: 4, releaseTime: 1 },
        },
      ],
    });
    const result = render(loaded, loaded.create(patch), 400, [
      { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 },
    ]);

    const fold = (f: number) => {
      const m = f % SR;
      return m > SR / 2 ? SR - m : m;
    };
    const fundamental = goertzel(result.samples, f0, SR) + 1e-12;
    let worst = 0;
    for (let k = 2; k <= 16; k++) {
      const f = fold(k * f0);
      if (f > 200 && f < f0 * 0.9) {
        worst = Math.max(worst, goertzel(result.samples, f, SR) / fundamental);
      }
    }
    return worst;
  };

  it('keeps a high saw free of sub-fundamental energy', () => {
    expect(worstAliasRatio(WAVE.SAW)).toBeLessThan(0.02);
  });

  it('still aliases the deliberately raw Saw D', () => {
    expect(worstAliasRatio(WAVE.SAW_D)).toBeGreaterThan(worstAliasRatio(WAVE.SAW) * 5);
  });
});

describe('render loop', () => {
  it('does not allocate in steady state', () => {
    const pad = PRESETS['pad-drift'];
    expect(pad).toBeDefined();
    if (!pad) return;

    const processor = loaded.create(pad, 16);
    render(loaded, processor, 50, [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]);

    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    render(loaded, processor, 2000, []);
    global.gc?.();
    const after = process.memoryUsage().heapUsed;

    // A per-sample allocation would add megabytes over 256,000 frames.
    expect(Math.abs(after - before) / 1024).toBeLessThan(2048);
  });
});
