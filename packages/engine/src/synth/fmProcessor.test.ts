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
 * false pass, so no test here puts a preset's level on trial. The bank's
 * seeded clip sweep retired with its headroom record (record
 * `2026-09-28-retire-the-headroom-record`): a hot patch shows on the strip
 * and master meters, and the editor's loudness check warns before a save.
 */
import { describe, expect, it, vi } from 'vitest';

import { goertzel, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, RenderResult, ScheduledEvent } from '../__fixtures__/workletHarness';
import { ALGORITHMS, WAVE, makePatch } from '../patch/patch';
import type { PartialPatch, Patch } from '../patch/patch';
import { PRESETS } from '../patch/presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;

const held = (note: number, frames: number): ScheduledEvent[] => [
  { type: 'noteOn', id: 1, note, velocity: 0.9, frame: 0 },
  { type: 'noteOff', id: 1, frame: frames },
];

/** A hard cut shows up as a large single-sample step; a fade keeps every step small. */
const MAX_CUT_STEP = 0.25;

const largestStep = (samples: Float32Array): number => {
  let max = 0;
  for (let i = 2; i < samples.length; i += 2) {
    max = Math.max(max, Math.abs((samples[i] ?? 0) - (samples[i - 2] ?? 0)));
  }
  return max;
};

/* --- mono (#453) ------------------------------------------------------- */

/** The harness's render block. */
const BLOCK_FRAMES = 128;
/** `Voice.steal()`'s fade-out, mirrored from the worklet. */
const STEAL_FADE_S = 0.004;
const RELEASE_S = 0.5;
const SUSTAIN_REACHED_S = 0.05;
const FIRST_NOTE = 48;
const SECOND_NOTE = 60;
const FIRST_ID = 1;
const SECOND_ID = 2;
const SPREAD_CENTS = 20;
const GLIDE_S = 2;
const SECOND_ON_S = 0.2;
const RUN_S = SECOND_ON_S + 0.4;
/** Past the cut voice's fade, and short enough that a 2 s glide has barely moved. */
const GLIDE_WINDOW_SKIP_S = 0.02;
const GLIDE_WINDOW_S = 0.1;

const frames = (seconds: number): number => Math.round(seconds * SR);
/** Blocks covering `seconds`, plus one so the boundary falls inside the render. */
const blocksFor = (seconds: number): number => Math.ceil(frames(seconds) / BLOCK_FRAMES) + 1;
const noteHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);
const SECOND_ON_FRAME = frames(SECOND_ON_S);

interface MonoVoice {
  active: boolean;
  fading: boolean;
  gate: boolean;
  voiceId: number;
}

/**
 * The part's sounding voices. `gate` and `voiceId` are the worklet Voice's own
 * fields; the harness's structural `VoiceLike` carries only what the older
 * tests read, so they are narrowed here rather than widened for every caller.
 */
const sounding = (processor: ProcessorLike): MonoVoice[] =>
  (processor.voices as unknown as MonoVoice[]).filter((v) => v.active && !v.fading);

/** A plain sustaining sine: a cut and a pitch are both easy to see in it. */
const monoPatch = (over: PartialPatch = {}): Patch =>
  makePatch({
    ops: [
      {
        level: 1,
        env: { attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.8, releaseTime: RELEASE_S },
      },
    ],
    ...over,
  });

/** Two overlapping notes on one part: the second lands while the first sustains. */
function monoRun(over: PartialPatch): { processor: ProcessorLike; result: RenderResult } {
  const processor = loaded.create(monoPatch(over), 8);
  const events: ScheduledEvent[] = [
    { type: 'noteOn', id: FIRST_ID, note: FIRST_NOTE, velocity: 0.9, frame: 0 },
    { type: 'noteOn', id: SECOND_ID, note: SECOND_NOTE, velocity: 0.9, frame: SECOND_ON_FRAME },
  ];
  return { processor, result: render(loaded, processor, blocksFor(RUN_S), events) };
}

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

    expect(largestStep(result.samples)).toBeLessThan(MAX_CUT_STEP);
  });

  it('keeps a stolen voice silent for the rest of its block once it is killed', () => {
    // The steal fade reaches zero mid-block and `kill()`s the voice, but the
    // block's remaining control chunks are still rendered before `process`
    // re-reads `active`. An idle envelope returns its last value, so those
    // chunks used to ramp the dead voice back to full level and then cut it at
    // the block boundary -- a click inside the fade that exists to avoid one.
    // A loud sustained sine shows it where `pad-drift` above does not.
    const processor = loaded.create(monoPatch(), 1); // a pool of one: the next note steals
    const result = render(loaded, processor, blocksFor(RUN_S), [
      { type: 'noteOn', id: FIRST_ID, note: FIRST_NOTE, velocity: 0.9, frame: 0 },
      { type: 'noteOn', id: SECOND_ID, note: SECOND_NOTE, velocity: 0.9, frame: SECOND_ON_FRAME },
    ]);
    expect(largestStep(result.samples)).toBeLessThan(MAX_CUT_STEP);
  });
});

describe('mono (#453)', () => {
  it('leaves one note sounding, where a poly part leaves two', () => {
    const mono = monoRun({ mono: true });
    expect(mono.result.nonFinite).toBe(0);
    expect(sounding(mono.processor)).toHaveLength(1);
    // ...and the cut really is the toggle's doing: the same two overlapping
    // notes on the same patch stack when it is off.
    expect(sounding(monoRun({ mono: false }).processor)).toHaveLength(2);
  });

  it('cuts the sounding note with the steal fade, not a click', () => {
    const { processor, result } = monoRun({ mono: true });
    expect(largestStep(result.samples)).toBeLessThan(MAX_CUT_STEP);

    // The cut voice is gone within the steal fade, and the voice left is the
    // new note's, not the old one's.
    const survivor = sounding(processor)[0];
    expect(survivor?.voiceId).toBe(SECOND_ID);
  });

  it('frees the cut voice within the steal fade', () => {
    const processor = loaded.create(monoPatch({ mono: true }), 8);
    processor.inbox({ type: 'noteOn', id: FIRST_ID, note: FIRST_NOTE, velocity: 0.9, frame: 0 });
    render(loaded, processor, blocksFor(SUSTAIN_REACHED_S));
    const first = sounding(processor)[0];
    expect(first?.voiceId).toBe(FIRST_ID);

    processor.inbox({ type: 'noteOn', id: SECOND_ID, note: SECOND_NOTE, velocity: 0.9, frame: 0 });
    render(loaded, processor, blocksFor(STEAL_FADE_S));
    expect(first?.active).toBe(false);
    expect(sounding(processor)).toHaveLength(1);
  });

  it('does not let the cut note’s later noteOff release the note that replaced it', () => {
    const { processor } = monoRun({ mono: true });

    // The player holding the first note lets go long after mono cut it. Its
    // note-map entry went with the cut, so this must find nothing.
    processor.inbox({ type: 'noteOff', id: FIRST_ID, frame: 0 });
    const after = render(loaded, processor, blocksFor(RELEASE_S * 2));

    const alive = sounding(processor);
    expect(alive).toHaveLength(1);
    expect(alive[0]?.gate).toBe(true);
    // A released voice would have finished inside twice its release time; this
    // one is still sustaining.
    expect(after.peak).toBeGreaterThan(0);

    // ...and the assertion is not vacuous: the note's *own* noteOff releases it.
    processor.inbox({ type: 'noteOff', id: SECOND_ID, frame: 0 });
    render(loaded, processor, blocksFor(RELEASE_S * 2));
    expect(sounding(processor)).toHaveLength(0);
  });

  it('still runs the spread pair for the one note', () => {
    const { processor } = monoRun({ mono: true, spread: SPREAD_CENTS });
    const alive = sounding(processor);
    expect(alive).toHaveLength(2);
    expect(alive.map((v) => v.voiceId)).toEqual([SECOND_ID, SECOND_ID]);
  });

  it('slides from the previous note when glide is set', () => {
    // `lastNote` is what glide slides from, and the mono cut must not disturb
    // it. Measured against the same run with glide off: with glide, the window
    // just after the second note-on is still near the first note's pitch.
    const from = noteHz(FIRST_NOTE);
    const to = noteHz(SECOND_NOTE);
    const at = (patch: PartialPatch): { from: number; to: number } => {
      const samples = monoRun(patch).result.samples;
      const window = samples.subarray(
        (SECOND_ON_FRAME + frames(GLIDE_WINDOW_SKIP_S)) * 2,
        (SECOND_ON_FRAME + frames(GLIDE_WINDOW_SKIP_S + GLIDE_WINDOW_S)) * 2,
      );
      return { from: goertzel(window, from, SR), to: goertzel(window, to, SR) };
    };

    const glided = at({ mono: true, glide: GLIDE_S });
    const jumped = at({ mono: true, glide: 0 });
    expect(glided.from).toBeGreaterThan(glided.to);
    expect(jumped.to).toBeGreaterThan(jumped.from);
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
