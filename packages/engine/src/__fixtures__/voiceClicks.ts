/**
 * The reproduction for windsor#7: the patch and the note line of Pat's
 * `clicks.json` demo, as the grid sequencer sends them to the worklet, and
 * the one measurement the tests make — the largest sample-to-sample step, the
 * zipper check `reverbHarness.ts` uses. The song itself is Pat's file and
 * stays out of the repo; this is its one part, copied by value.
 *
 * The patch is a mono sine carrier with feedback (a saw-like op 1, attack
 * 0.5 ms) under a 12 dB low-pass at 30 Hz, opened by its envelope, the LFO
 * and key tracking. The line is sixteen sixteenth notes at 120 BPM, every
 * step a note: step 0 slides in from the last step, steps 7 and 15 are
 * accented. Research: `docs/research/2026-09-28-voice-clicks/`.
 */
import type { Envelope, Patch } from '../patch/patch';
import type { ScheduledEvent } from './workletHarness';

/** A sixteenth at 120 BPM, at the harness's 48 kHz. */
export const STEP_FRAMES = 6000;
/** Where the first step lands: off the block grid, as a live note does. */
export const FIRST_FRAME = 1000;
/** The patch's glide is 0, so a slide takes the engine's default time. */
export const SLIDE_SECONDS = 0.06;
/** The grid's velocity, and an accented step's (0.8 plus the song's bump, clamped). */
const VELOCITY = 0.8;
const ACCENT_VELOCITY = 1;
/** The song's `accentMod`: an accented step's per-note mod. */
const ACCENT_MOD = 1;

const env = (over: Partial<Envelope> = {}): Envelope => ({
  initLevel: 0,
  attackTime: 0.002,
  attackCurve: 0,
  peakLevel: 1,
  decayTime: 0.4,
  decayCurve: 0.5,
  sustainLevel: 0.7,
  releaseTime: 0.3,
  releaseCurve: 0.5,
  endLevel: 0,
  loopMode: 0,
  keyScale: 0,
  ...over,
});

const op = (level: number, feedback: number, attackTime: number): Patch['ops'][number] => ({
  wave: 0,
  userPartials: null,
  ratio: 1,
  fixed: false,
  fixedHz: 100,
  detune: 0,
  level,
  feedback,
  velSens: 0.4,
  levelKeyScale: 0,
  phase: 0,
  phaseFree: true,
  env: env({ attackTime }),
});

/** `clicks.json`'s `(init:0)`, field for field. */
export const CLICKS_PATCH: Patch = {
  name: 'Init',
  algorithm: 0,
  volume: 0.8,
  tone: 1,
  glide: 0,
  pitchEnvAmount: 0,
  pan: 0,
  panRandom: 0,
  panKey: 0,
  spread: 0,
  mono: true,
  ops: [
    op(1, 0.7307976973684212, 0.0005000000000000001),
    op(0, 0, 0.002),
    op(0, 0, 0.002),
    op(0, 0, 0.002),
  ],
  pitchEnv: env({ decayTime: 0.1, sustainLevel: 0 }),
  lfo: {
    shape: 0,
    rate: 0.1461852562202235,
    amount: 0.11099917763157895,
    delay: 0,
    retrigger: false,
    toPitch: 0,
    modWheelDepth: 1,
    toOp: [0, 0, 0, 0],
  },
  filter: {
    mode: 1,
    cutoff: 30.000000000000004,
    resonance: 0.707,
    drive: 1,
    slope24: false,
    envAmount: 1.1072368421052632,
    modWheelDepth: 0,
    lfoAmount: 4,
    keyTrack: 0.522224506578947,
    env: env({ sustainLevel: 0 }),
  },
};

/**
 * Pat's second demo, `clippy.json` (windsor#7, round 2): the same line and
 * carrier, with sustain 1 and a 0.4 s release, under a resonant low-pass
 * (Q 4.76) at 55 Hz. The filter envelope opens it 4.2 octaves, plus 6 more
 * on an accent (`modWheelDepth` 6 at mod 1). The LFO does not reach the
 * filter.
 */
export const CLIPPY_PATCH: Patch = {
  ...CLICKS_PATCH,
  ops: [
    {
      ...CLICKS_PATCH.ops[0]!,
      env: env({
        attackTime: 0.0005000000000000001,
        decayTime: 0.5448667761520452,
        sustainLevel: 1,
        releaseTime: 0.4008216221420844,
      }),
    },
    ...CLICKS_PATCH.ops.slice(1),
  ],
  filter: {
    ...CLICKS_PATCH.filter,
    cutoff: 55.444153861358735,
    resonance: 4.757779147585374,
    envAmount: 4.164473684210526,
    modWheelDepth: 6,
    lfoAmount: 0,
  },
};

export interface LineStep {
  note: number;
  accent?: boolean;
  slide?: boolean;
}

/** The song's sixteen steps, C natural minor at register octave 2, as MIDI notes. */
export const CLICKS_LINE: readonly LineStep[] = [
  { note: 43, slide: true },
  { note: 55 },
  { note: 38 },
  { note: 48 },
  { note: 24 },
  { note: 38 },
  { note: 29 },
  { note: 36, accent: true },
  { note: 48 },
  { note: 36 },
  { note: 46 },
  { note: 31 },
  { note: 29 },
  { note: 24 },
  { note: 58 },
  { note: 38, accent: true },
];

/**
 * The events the grid sequencer sends for `line` played `loops` times, one
 * step every `STEP_FRAMES` from `FIRST_FRAME`: a plain step is the held
 * note's off then the new note's on, a slide is the on first (legato), and
 * a slide with nothing held is a plain note — `gridSequencer.ts`'s order.
 */
export function lineEvents(line: readonly LineStep[], loops: number): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  let heldId = 0;
  for (let k = 0; k < line.length * loops; k++) {
    const step = line[k % line.length]!;
    const id = k + 1;
    const frame = FIRST_FRAME + k * STEP_FRAMES;
    const on: ScheduledEvent = { type: 'noteOn', id, note: step.note, velocity: VELOCITY, frame };
    if (step.accent) {
      on.velocity = ACCENT_VELOCITY;
      on.mod = ACCENT_MOD;
    }
    const slide = step.slide === true && heldId !== 0;
    if (slide) on.slide = true;
    if (slide) events.push(on);
    if (heldId !== 0) events.push({ type: 'noteOff', id: heldId, frame });
    if (!slide) events.push(on);
    heldId = id;
  }
  return events;
}

/** Blocks that cover `steps` steps from frame 0. */
export function blocksFor(steps: number): number {
  return Math.ceil((FIRST_FRAME + steps * STEP_FRAMES) / 128);
}

/** Largest sample-to-sample step in the left channel of an interleaved render, over `[from, to)`. */
export function maxStep(samples: Float32Array, from = 1, to = samples.length / 2): number {
  let max = 0;
  for (let i = Math.max(1, from); i < to; i++) {
    const step = Math.abs((samples[i * 2] ?? 0) - (samples[(i - 1) * 2] ?? 0));
    if (step > max) max = step;
  }
  return max;
}
