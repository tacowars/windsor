/**
 * DSP behaviour, rendered headlessly.
 *
 * These are the properties that are expensive to notice by ear and cheap to
 * assert: silence when idle, no NaN, bounded level, no allocation in the render
 * loop, and no discontinuity when a voice is stolen. None of them is a
 * performance claim -- see docs/design/audio-architecture.md 7 for why timing
 * measured here would not qualify under CLAUDE.md invariant 3.
 *
 * Every render here is seeded (workletHarness.DEFAULT_SEED). The processor
 * draws free-running operator phase from `Math.random` in the game, so an
 * unseeded assertion about a level is a fresh coin toss every run -- which is
 * how the `bass-digital` clip assertion failed once and passed on re-run
 * (#78). Seeding alone would trade that rare true failure for a permanent
 * false pass, so coverage of the random space is a deliberate sweep: it lives
 * in fmProcessorHeadroom.test.ts, which is where the preset levels are on
 * trial.
 */
import { describe, expect, it, vi } from 'vitest';

import { goertzel, loadProcessor, render } from './__fixtures__/workletHarness';
import type { ScheduledEvent } from './__fixtures__/workletHarness';
import { ALGORITHMS, WAVE, makePatch } from './patch';
import type { Patch } from './patch';
import { PRESETS } from './presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;

const held = (note: number, frames: number): ScheduledEvent[] => [
  { type: 'noteOn', id: 1, note, velocity: 0.9, frame: 0 },
  { type: 'noteOff', id: 1, frame: frames },
];

describe('the seed', () => {
  const bass = PRESETS['bass-digital'] as Patch;

  it('makes a render reproducible, and different seeds differ', () => {
    const a = render(loaded, loaded.create(bass, 16, 7), 40, held(60, 12000));
    const b = render(loaded, loaded.create(bass, 16, 7), 40, held(60, 12000));
    const c = render(loaded, loaded.create(bass, 16, 8), 40, held(60, 12000));

    expect(a.samples).toEqual(b.samples);
    // Otherwise the seed could be ignored entirely and the test above would
    // still pass -- on any patch whose operators all start at phase 0.
    expect(a.samples).not.toEqual(c.samples);
  });

  it('is absent in the game, which keeps free-running phase from Math.random', () => {
    const free = () => render(loaded, loaded.create(bass, 16, null), 40, held(60, 12000));

    // Two unseeded renders differ: that is the point of free-running phase, and
    // it is what the game still gets.
    expect(free().samples).not.toEqual(free().samples);

    // ...and the source really is Math.random, not some other fallback: pin it
    // and the same two renders agree again.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      const pinned = free();
      expect(pinned.samples).toEqual(free().samples);
      expect(pinned.peak).toBeGreaterThan(0.002);
    } finally {
      spy.mockRestore();
    }
  });

  it('never leaves a noise generator on the xorshift32 zero fixed point', () => {
    // The per-voice noise and LFO generators are xorshift32, whose fixed point
    // is 0: a voice seeded there emits dead DC for as long as it sounds.
    // `randomSeed32` excludes it, and this is the one behavioural change on the
    // unseeded game path -- so it is asserted on that path, with the draw that
    // reaches it pinned.
    const noisy = makePatch({
      algorithm: 7,
      ops: [
        {
          wave: WAVE.NOISE,
          level: 1,
          env: { attackTime: 0.001, sustainLevel: 1, decayTime: 1 },
        },
      ],
    });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = render(loaded, loaded.create(noisy, 4, null), 40, held(60, 12000));
      expect(result.nonFinite).toBe(0);
      expect(result.peak).toBeGreaterThan(0.002);

      // DC has no zero crossings; noise has thousands.
      let crossings = 0;
      for (let i = 2; i < result.samples.length; i += 2) {
        if ((result.samples[i] ?? 0) * (result.samples[i - 2] ?? 0) < 0) crossings++;
      }
      expect(crossings).toBeGreaterThan(100);
    } finally {
      spy.mockRestore();
    }
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

describe('allNotesOff', () => {
  it('releases the sounding voice with a tail and cancels queued future events', () => {
    const blip = PRESETS['pickup-blip'];
    expect(blip).toBeDefined();
    if (!blip) return;
    const processor = loaded.create(blip, 8);

    // One note sounding now, one queued far in the future -- the shape the
    // #69 scheduler's look-ahead produces at the moment of a mute.
    processor.inbox({ type: 'noteOn', id: 1, note: 60, velocity: 0.9, frame: 0 });
    processor.inbox({ type: 'noteOn', id: 2, note: 72, velocity: 0.9, frame: 24000 });
    const before = render(loaded, processor, 20);
    expect(before.peak).toBeGreaterThan(0.002);

    processor.inbox({ type: 'allNotesOff' } as unknown as ScheduledEvent);
    const after = render(loaded, processor, 300);
    expect(after.nonFinite).toBe(0);

    // The queued note at frame 24000 must never sound; anything after the
    // blip's short release is exact silence.
    let latePeak = 0;
    for (let i = 20000 * 2; i < after.samples.length; i++) {
      latePeak = Math.max(latePeak, Math.abs(after.samples[i] ?? 0));
    }
    expect(latePeak).toBe(0);
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
  it('stays finite and bounded over a long render', () => {
    const pad = PRESETS['pad-drift'];
    expect(pad).toBeDefined();
    if (!pad) return;

    const processor = loaded.create(pad, 16);
    render(loaded, processor, 50, [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]);

    // 2,000 blocks is 256,000 samples. Filter state, phase accumulators and
    // envelope counters all run for the whole of it; a drift or a denormal
    // spiral shows up here and nowhere in the short renders above.
    const long = render(loaded, processor, 2000, [], { collectSamples: false });
    expect(long.nonFinite).toBe(0);
    expect(long.peak).toBeLessThanOrEqual(1);
  });

  // Not tested: that the sample loop performs no allocation. It does not -- the
  // voice pool and every buffer are preallocated, which is the whole shape of
  // Voice and FmPartProcessor -- but the property resisted honest measurement
  // here. `heapUsed` cannot see per-sample garbage, because the scavenger
  // reclaims it before either reading; counting GC events does see it, but only
  // against an ambient floor that varies per run and per machine, and the
  // differential against an idle control was not sharp enough to fail a
  // deliberately injected allocation. A test that passes either way is worse
  // than no test, so the property is maintained by review, and by the note at
  // the top of the worklet, rather than by the gate.
});
