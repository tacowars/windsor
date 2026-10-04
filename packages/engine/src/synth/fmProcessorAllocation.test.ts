/**
 * Worklet rules 2 and 7 for the FM part (windsor#233), measured on V8 rather
 * than read off the source: once its paths have run, it plays notes, holds a
 * chord and changes notes over it, steals voices, releases them, lets held
 * voices fall dormant and ends them, and follows its four parameters, without
 * allocating, and no field of the bundle ever changes its representation.
 *
 * Method, as `inserts/eqAllocation.test.ts`: a heap reading inside Vitest is
 * not repeatable (the runner shares the heap), so the test spawns a Node of
 * its own that runs the shipped bundle (`__fixtures__/workletAllocationProbe.ts`,
 * driven by `fmPartChangeScenario.ts`) with `--expose-gc`, a 64 MB young
 * generation and `--trace-generalization`. Two parts, each a cycle of note
 * events with a parameter change every 24 quanta, played out to silence:
 *
 * - A pad (`pad-drift`, its envelopes shortened so a cycle is about 500
 *   quanta, a pulse operator whose width a sample-and-hold LFO 2 moves, a
 *   noise modulator through its own lowpass and highpass (windsor#362), a
 *   pitch envelope and a biased tube drive with its
 *   tone pole running, windsor#300) in the
 *   fixed-index kernel, the path live playback takes: a three-note chord
 *   held while notes come and go over it and an arpeggio runs, in a pool of
 *   eight voices, two voices a note, so the pool fills and steals, first
 *   the oldest held voices, then released ones.
 * - A pluck (`lead-bell`, its decay shortened, a squeezed saw, a noise
 *   operator through its own highpass (windsor#362), a biased diode drive, the filter at 24 dB, a triangle LFO and a drift
 *   LFO 2) in the generic loop (`specialise: false`), whose carrier sustains
 *   at 0: four voices fall dormant, new notes take a full pool's dormant
 *   voices, a dormant voice's note-off ends it, and a run of short notes
 *   follows.
 *
 * Each message, and the event carrying it, is built once by the scenario and
 * reused, so the run measures the part's handling of a message and not the
 * message: in Chrome the port makes a new one, outside the render. The
 * scenario swaps the part's random source for a constant, as the load meter
 * is turned off: V8 returns each draw as a new heap number, up to five a
 * voice start, which no form of the part's source avoids (what it costs in
 * Chrome is in `docs/research/2026-09-30-worklet-gc-in-chrome/README.md`).
 *
 * The child warms for 96 000 quanta (the load meter reporting for the first
 * half), long enough that V8 has optimised the note-on path as well as the
 * render: with 48 000 it compiled part of the note-on path to its top tier
 * inside the measured run, whose code and whose lower tier's boxed doubles
 * read up to 20 KB. It then forces two collections and reads
 * `used_heap_size` in ten windows across 8 000 quanta with the meter off (it
 * calls Date.now() twice a quantum, and V8 returns each as a new heap
 * number: `docs/research/2026-09-30-load-sampler-allocation/README.md`). The
 * scenario throws, failing the child, unless the measured run took every
 * path. Every run compiles on the main thread (`SYNCHRONOUS_TIERING`), so the
 * tier each function has reached when the heap is read depends on the calls
 * the warm-up made and not on the machine's load: with the compiler on a
 * background thread, busy CI runners read a one-off spike of 7 to 12 KB in a
 * single tenth of an otherwise clean run, enough to pass the bound
 * (windsor#266, as windsor#256 for the load sampler).
 *
 * A third run plays the pad as a context about 25 hours old does: every
 * frame past 2^31, a double in V8, and each note posted 16 quanta ahead of
 * where it lands, as the scheduler's look-ahead, so the next event's frame is
 * read every quantum while it waits. The child keeps the event queue's
 * accessors from being inlined (`%NeverOptimizeFunction`), as V8 may in a
 * larger render than this one, so a frame returned from one is boxed. With
 * the `firstFrame` accessor the render had read the frame through, the run
 * read 143 KB, a heap number a quantum; with `schedule(msg, msg.frame)`, the
 * frame passed as an argument, 21 KB with everything inlined.
 *
 * Three more runs cross 2^31 rather than start past it, since a field first
 * written as a small integer is generalised by the first double it holds
 * (rule 7), on the audio thread, deoptimising the render that reads it. The
 * fourth plays the pad from a frame its frames pass 2^31 from, three quarters
 * of the way through the warm-up: with the frame stamped on each queued
 * message as `_frame`, the trace read `_frame:s->d` there. The crossing also
 * changes the representation of the messages' own `frame` field, as the
 * first message past 2^31 does for the port's in Chrome, which deprecates
 * the message's map and throws away the optimised code of every function
 * that read a message. With `schedule` and `noteOn` reading the messages
 * once each, both stayed in V8's baseline tier for the rest of the run
 * (about 80 000 quanta passed before `noteOn` was optimised again) and the
 * run read 153 KB, about 129 KB of it in `noteOn` and 21 KB in `schedule`,
 * the same with the crossing a quarter, half or three quarters of the way
 * through the warm-up (windsor#270). The render, run every quantum, now reads
 * the messages, and is optimised again within a few hundred. The fifth and
 * sixth hold one note through the whole run, in the kernel and dormant in
 * the generic loop, the warm-up ending by setting its voices' `age` just
 * below 2^31, so it crosses half way through the measured run: with `age`
 * born a small integer, the trace read `age:s->d` and the runs read 40 MB
 * and 1.6 MB as the render deoptimised.
 *
 * A seventh run gives the part a fresh event queue as the warm-up ends, so
 * the measured run holds a queue's first notes and its first burst with the
 * code already warm (windsor#270): each cycle posts 65 notes, a note-on and a
 * note-off each, in one quantum and 16 quanta ahead, two events past the
 * queue's whole room (`EVENT_QUEUE_CAPACITY`), as 65 synchronous triggers
 * would. A truly cold part cannot be held to the bound, since V8's lower
 * tiers box doubles everywhere, so the run checks the growth directly as
 * well: the scenario throws if a render replaced or lengthened any of the
 * queue's arrays, and unless the burst passed the queue's first room and its
 * posts grew it. The posts may grow the queue, on the message path, between
 * quanta; the render may not. With the queue born empty, it grew from 0, 2
 * and 0 slots to 128 each and the run read 420 KB, most of it in the first
 * tenth; with the room given by the constructor and a burst of 64 notes, it
 * read the probe's own 6 KB and the check's 1.2 KB. With growth in the render,
 * the burst of 65 fails the direct check (386 slots to 516); with growth in
 * `post`, the run reads 11.9 KB, 5 KB of it the posts' growth. The
 * warm-up swaps a queue in once at its start too: V8 tracks the part's
 * `events` field, written only by the constructor, as constant, and the
 * first other write deoptimises the render that read it, which read 2 MB
 * when it fell in the measured run.
 *
 * Two more play the pad through the Formant filter (windsor#331), in the
 * kernel and in the generic loop, its three sections running in parallel,
 * while every parameter change also writes the next of seven vowels into
 * the bound patch, across all five rows and between them, as a live edit of
 * the vowel reaches ringing voices (written in place: a posted patch is
 * normalised into a new object on the message path, by design).
 * Two more play it through the Acid ladder (windsor#573), in the kernel and
 * in the generic loop, its Newton solve running a call a sample, while song
 * lanes on its cutoff and Reso toggle with the part's parameters, so it
 * retunes on ringing voices.
 *
 * Tolerance: 16 KiB over the 8 000 quanta; one boxed double a quantum would
 * read 128 KB. The runs read about 6 KB, the eleven readings' own result
 * objects (616 bytes a tenth); with the note-on's message read in `noteOn`
 * they read 10 to 12 KB, about one heap number a note-on more
 * (windsor#270). Before windsor#233 the part read about 3.6 KB a quantum
 * (`docs/research/2026-09-30-worklet-gc-in-chrome/README.md`), and this
 * scenario 4.3 KB a quantum in the pad and 0.7 KB in the pluck.
 */
import { describe, expect, it } from 'vitest';
import type { FmPartChangeConfig, FmPartEvent } from '../__fixtures__/fmPartChangeScenario';
import { ACID_FILTER, ACID_LANE_TOGGLES, ACID_SLOTS } from '../__fixtures__/fmPartChangeScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import type { Patch } from '../patch/patch';
import { DRIVE_SHAPE, FILTER_MODE, WAVE } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import { EVENT_QUEUE_CAPACITY } from '../worklet/fm/fmConstants';
import { VOICE_TARGET_PATHS, type VoiceTargetPath } from '../worklet/fm/voiceTargetTables';

const TOLERANCE_BYTES = 16 * 1024;

/** Notes in the burst: each a note-on and a note-off, so the burst passes the queue's room by two events. */
const BURST_NOTES = EVENT_QUEUE_CAPACITY / 2 + 1;

/** A context about 25 hours old at 48 kHz: every frame a double in V8, whose small integers end at 2^31. */
const LATE_FRAME = 2 ** 32;
/** Quanta the notes are posted ahead of where they land, about 40 ms at 48 kHz, as the scheduler's look-ahead. */
const LOOKAHEAD_QUANTA = 16;

/** The warm-up's and the measured run's quanta, which `probe` passes and the late starts below count. */
const WARMUP_QUANTA = 96000;
const MEASURE_QUANTA = 8000;
const QUANTUM = 128;
/** V8's small integers end below 2^31 (64-bit Node, no pointer compression). */
const SMI_END = 2 ** 31;
/**
 * A held voice's age as the measured run starts: still a small integer, and
 * past 2^31 half way through the run, as a drone held about 12 hours.
 */
const DRONE_AGE = SMI_END - (MEASURE_QUANTA / 2) * QUANTUM;
/**
 * A context's first frame such that its frames pass 2^31 three quarters of
 * the way through the warm-up, so the code the crossing deoptimises in the
 * probe and the scenario (their own frame arithmetic) is optimised again
 * before the heap is read.
 */
const CROSSING_FRAME = SMI_END - ((WARMUP_QUANTA * 3) / 4) * QUANTUM;

const TOGGLES: [string, number][] = [
  ['pitchBend', 2],
  ['modWheel', 0.7],
  ['gain', 0.5],
];

/**
 * Song lanes on every slot (windsor#346): the slot map, and each slot's
 * offset toggled in turn with the part's own parameters, so a lane moves
 * feedback (its ramp), level, width, the cutoff and resonance (windsor#419:
 * the cutoff through a slot), an LFO's rate, the other's amount and the
 * pitch envelope on ringing voices and new ones, and a step's push stacks on
 * four of them.
 */
const LANE_SLOTS = [
  'ops.0.feedback',
  'ops.1.level',
  'ops.1.width',
  'filter.resonance',
  'lfo.rate',
  'lfo2.amount',
  'filter.cutoff',
  'pitchEnvAmount',
];
const LANE_TOGGLES: [string, number][] = [
  ...TOGGLES,
  ...LANE_SLOTS.map((_, i): [string, number] => [`voiceSlot${i}`, i % 2 === 0 ? 0.3 : -0.2]),
];

/**
 * Song lanes on the decay targets (windsor#347): the filter's decay time and
 * each operator's decay curve, and three operators' decay times, toggled so
 * that a running decay changes its rate and is reshaped from its level.
 */
const DECAY_SLOTS = [
  'filter.env.decayTime',
  'ops.0.env.decayCurve',
  'ops.1.env.decayCurve',
  'ops.2.env.decayCurve',
  'ops.3.env.decayCurve',
  'ops.0.env.decayTime',
  'ops.1.env.decayTime',
  'ops.3.env.decayTime',
];

/**
 * A step's offsets for the note that carries them, by target code: the
 * filter's cutoff, envelope amount and resonance, operator A's level, an
 * LFO's rate and the pitch envelope's amount (windsor#419).
 */
const STEP_PUSHES: Partial<Record<VoiceTargetPath, number>> = {
  'filter.cutoff': 0.5,
  'filter.envAmount': 0.3,
  'filter.resonance': -0.4,
  'ops.0.level': 0.25,
  'lfo.rate': 0.4,
  pitchEnvAmount: -0.2,
};
const STEP_MOD = VOICE_TARGET_PATHS.map((path) => STEP_PUSHES[path] ?? 0);

const on = (at: number, offset: number, key: number, note: number): FmPartEvent => ({
  at,
  offset,
  type: 'noteOn',
  key,
  note,
  velocity: 0.8,
});
const off = (at: number, offset: number, key: number): FmPartEvent => ({
  at,
  offset,
  type: 'noteOff',
  key,
});

/** A run of short notes from quantum `from`, one every `gap` quanta, each held `hold`, keyed from `key`. */
function run(from: number, key: number, notes: number[], gap: number, hold: number): FmPartEvent[] {
  return notes.flatMap((note, i) => [
    on(from + i * gap, (17 * i) % 128, key + i, note),
    off(from + i * gap + hold, 0, key + i),
  ]);
}

/** The events in order of quantum, as the scenario reads them. */
const inOrder = (events: FmPartEvent[]): FmPartEvent[] => events.sort((a, b) => a.at - b.at);

/**
 * `pad-drift` with envelopes a cycle can play through, a pitch envelope, a
 * pulse whose width a sample-and-hold LFO 2 moves, a noise modulator with its
 * own colour (windsor#362) and a biased tube drive with its tone pole running.
 */
function pad(): Patch {
  const patch = structuredClone(PRESETS['pad-drift']!);
  for (const op of patch.ops) {
    op.env.attackTime = 0.05;
    op.env.decayTime = 0.3;
    op.env.releaseTime = 0.3;
  }
  patch.ops[1]!.wave = WAVE.PULSE;
  patch.ops[1]!.width = 0.3;
  patch.ops[3]!.wave = WAVE.NOISE;
  // Its own two sections (windsor#362), at cutoffs that are not whole numbers,
  // and the Pulse's lowpass tracking the note (windsor#590).
  Object.assign(patch.ops[3]!, { opLp: 6100.5, opHp: 1800.25 });
  Object.assign(patch.ops[1]!, { opLp: 3200.5, opTrack: 0.75 });
  // The drive stage (windsor#300) with a bias and its tone pole running.
  patch.drive = { gain: 1.3, shape: DRIVE_SHAPE.TUBE, bias: 0.2, tone: 0.6, on: true };
  patch.filter.env.attackTime = 0.05;
  patch.filter.env.releaseTime = 0.3;
  patch.pitchEnvAmount = 0.5;
  patch.pitchEnv.attackTime = 0.02;
  patch.pitchEnv.decayTime = 0.1;
  patch.lfo2 = {
    ...patch.lfo2,
    shape: 5,
    rate: 6,
    amount: 0.5,
    toOp: [0.2, 0, 0.2, 0],
    toWidth: [0, 0.2, 0, 0],
  };
  return patch;
}

/**
 * The pad through the Formant filter (windsor#331), its vowel born between
 * two rows, so the field is a double from the first patch, as a live edit
 * of the console's knob leaves it.
 */
function formantPad(): Patch {
  const patch = pad();
  patch.filter.mode = FILTER_MODE.FORMANT;
  patch.filter.vowel = 0.5;
  return patch;
}

/** The pad through the Acid ladder (windsor#573), its filter the scenario's `ACID_FILTER`. */
const acidPad = (): Patch => ({ ...pad(), filter: { ...pad().filter, ...ACID_FILTER } });

/** The vowels a live edit sweeps the Formant pad through: across every row, both ends and between. */
const VOWEL_SWEEP = [0.5, 1.75, 3.25, 4, 2.5, 0, 1.125];

/**
 * `lead-bell` that falls dormant quickly, with a squeezed saw through its
 * own tracked lowpass (windsor#590) and a noise operator through its own
 * highpass (windsor#362), through a biased diode
 * drive and a 24 dB filter and two LFOs.
 */
function pluck(): Patch {
  const patch = structuredClone(PRESETS['lead-bell']!);
  for (const op of patch.ops) op.env.decayTime = 0.1;
  patch.ops[2]!.wave = WAVE.SAW;
  patch.ops[2]!.width = 0.6;
  Object.assign(patch.ops[2]!, { opLp: 2400.25, opTrack: -0.5 });
  patch.ops[3]!.wave = WAVE.NOISE;
  patch.ops[3]!.opHp = 950.75;
  patch.filter.slope24 = true;
  patch.drive = { gain: 1.4, shape: DRIVE_SHAPE.DIODE, bias: -0.1, tone: 0.8, on: true };
  patch.lfo = { ...patch.lfo, shape: 1, amount: 0.3, toPitch: 0.2 };
  patch.lfo2 = { ...patch.lfo2, shape: 6, rate: 3, amount: 0.5, toOp: [0, 0.3, 0, 0] };
  return patch;
}

/**
 * A held chord (1–3), notes over it that fill the pool and steal (4, 5), a
 * changing pair and a single, then an arpeggio (20–31) as the chord ends.
 */
const PAD_EVENTS: FmPartEvent[] = inOrder([
  on(0, 0, 1, 48),
  on(0, 0, 2, 55),
  on(0, 37, 3, 60),
  { ...on(40, 64, 4, 64), mod: 0.5, stepMod: STEP_MOD },
  on(80, 10, 5, 67),
  off(120, 100, 4),
  off(120, 100, 5),
  on(140, 0, 6, 62),
  on(140, 0, 7, 65),
  off(200, 0, 6),
  off(200, 0, 7),
  on(220, 90, 8, 69),
  off(240, 0, 8),
  off(280, 0, 1),
  off(280, 0, 2),
  off(280, 0, 3),
  ...run(300, 20, [72, 76, 79, 84, 79, 76, 72, 67, 64, 60, 64, 67], 6, 4),
]);

/**
 * Four notes, one released early, the rest falling dormant; two more take
 * dormant voices; all end; then a run of short notes (20–31).
 */
const PLUCK_EVENTS: FmPartEvent[] = inOrder([
  on(0, 0, 1, 60),
  on(0, 0, 2, 64),
  on(0, 21, 3, 67),
  on(0, 21, 4, 72),
  off(10, 0, 4),
  on(80, 0, 5, 62),
  { ...on(80, 50, 6, 69), stepMod: STEP_MOD },
  off(160, 0, 1),
  off(160, 0, 2),
  off(160, 0, 3),
  off(170, 0, 5),
  off(170, 0, 6),
  ...run(200, 20, [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79], 5, 3),
]);

/**
 * Every note of a burst posted in one quantum, as a chord step over every
 * voice with steps posted ahead is: the note-ons at the quantum's first
 * offsets, each note-off 63 frames later, still in it (its last at 127), so
 * the burst posts more than the queue's whole room at once and the queue
 * holds it until it lands.
 */
const BURST_EVENTS: FmPartEvent[] = Array.from({ length: BURST_NOTES }, (_, i) => [
  on(0, i, i + 1, 48 + (i % 24)),
  off(0, i + 63, i + 1),
]).flat();

function probe(
  patch: Patch,
  maxVoices: number,
  specialise: boolean,
  scenarioConfig: FmPartChangeConfig,
  late?: { startFrame?: number; v8Flags?: readonly string[]; voiceSlots?: string[] },
): ProbeRun {
  const voiceSlots = late?.voiceSlots;
  return runAllocationProbe(
    {
      startFrame: late?.startFrame ?? 0,
      bundle: workletBundle('fm-processor.js'),
      rate: 48000,
      params: {},
      options: {
        maxVoices,
        patch,
        seed: 0xa204,
        specialise,
        ...(voiceSlots ? { voiceSlots } : {}),
      },
      messages: [],
      inputChannels: 0,
      loadQuanta: 0,
      warmup: WARMUP_QUANTA,
      measure: MEASURE_QUANTA,
      scenario: probeScenario('fmPartChangeScenario.ts'),
      scenarioConfig,
    },
    late?.v8Flags ?? SYNCHRONOUS_TIERING,
  );
}

/** One note held for the whole run, its voices' ages seeded at `DRONE_AGE`. */
function drone(note: number, path: 'held' | 'dormant'): FmPartChangeConfig {
  return {
    events: [on(0, 0, 1, note)],
    period: 24,
    toggles: TOGGLES,
    rest: 16,
    idStride: 64,
    paths: [path],
    seedAge: DRONE_AGE,
  };
}

function expectClean(run: ProbeRun): void {
  expect(run.changes).toEqual([]);
  expectAllocationFree(run, TOLERANCE_BYTES);
}

/** The pad in the kernel and the pluck in the generic loop, under lanes on `voiceSlots` that toggle. */
function expectLanesClean(voiceSlots: string[]): void {
  const lanes = { voiceSlots };
  const scenario = { period: 6, toggles: LANE_TOGGLES, rest: 16, idStride: 64 };
  const padPaths: FmPartChangeConfig['paths'] = ['held', 'stolen', 'released', 'ended', 'silent'];
  const pluckPaths: FmPartChangeConfig['paths'] = [
    'held',
    'released',
    'dormant',
    'ended',
    'silent',
  ];
  expectClean(probe(pad(), 8, true, { events: PAD_EVENTS, ...scenario, paths: padPaths }, lanes));
  expectClean(
    probe(pluck(), 4, false, { events: PLUCK_EVENTS, ...scenario, paths: pluckPaths }, lanes),
  );
}

describe('the FM part on V8', () => {
  it('plays a held chord and changing notes in the kernel, stealing and releasing, for 8 000 quanta without allocating or changing a field representation', () => {
    expectClean(
      probe(pad(), 8, true, {
        events: PAD_EVENTS,
        period: 24,
        toggles: TOGGLES,
        rest: 16,
        idStride: 64,
        paths: ['held', 'stolen', 'released', 'ended', 'silent'],
      }),
    );
  }, 120_000);

  it('plays notes that fall dormant and end in the generic loop for 8 000 quanta without allocating or changing a field representation', () => {
    expectClean(
      probe(pluck(), 4, false, {
        events: PLUCK_EVENTS,
        period: 24,
        toggles: TOGGLES,
        rest: 16,
        idStride: 64,
        paths: ['held', 'released', 'dormant', 'ended', 'silent'],
      }),
    );
  }, 120_000);

  it('plays the chord with its notes posted ahead, at frames past 2^31, for 8 000 quanta without allocating or changing a field representation', () => {
    expectClean(
      probe(
        pad(),
        8,
        true,
        {
          events: PAD_EVENTS,
          period: 24,
          toggles: TOGGLES,
          rest: 16,
          idStride: 64,
          paths: ['held', 'stolen', 'released', 'ended', 'silent'],
          lookahead: LOOKAHEAD_QUANTA,
          outlineQueueAccessors: true,
        },
        { startFrame: LATE_FRAME, v8Flags: [...SYNCHRONOUS_TIERING, '--allow-natives-syntax'] },
      ),
    );
  }, 120_000);

  it('plays the chord with its notes posted ahead through the frames passing 2^31, then 8 000 quanta without allocating, and changes no field representation', () => {
    expectClean(
      probe(
        pad(),
        8,
        true,
        {
          events: PAD_EVENTS,
          period: 24,
          toggles: TOGGLES,
          rest: 16,
          idStride: 64,
          paths: ['held', 'stolen', 'released', 'ended', 'silent'],
          lookahead: LOOKAHEAD_QUANTA,
        },
        { startFrame: CROSSING_FRAME, v8Flags: SYNCHRONOUS_TIERING },
      ),
    );
  }, 120_000);

  it('gives a fresh event queue its first notes and a burst past its room, posted ahead, growing it only as the burst is posted and never in a render (windsor#270)', () => {
    expectClean(
      probe(pad(), 8, true, {
        events: BURST_EVENTS,
        period: 24,
        toggles: TOGGLES,
        rest: 16,
        idStride: 2 * BURST_NOTES,
        paths: ['stolen', 'released', 'ended', 'silent'],
        lookahead: LOOKAHEAD_QUANTA,
        freshQueue: true,
      }),
    );
  }, 120_000);

  it('follows song lanes on every slot in the kernel and the generic loop for 8 000 quanta without allocating or changing a field representation (windsor#346)', () => {
    expectLanesClean(LANE_SLOTS);
  }, 240_000);

  it('follows decay lanes in the kernel and the generic loop for 8 000 quanta without allocating or changing a field representation (windsor#347)', () => {
    expectLanesClean(DECAY_SLOTS);
  }, 240_000);

  it('plays the Formant pad while live edits sweep its vowel, in the kernel and the generic loop, for 8 000 quanta without allocating or changing a field representation (windsor#331)', () => {
    for (const specialise of [true, false]) {
      expectClean(
        probe(formantPad(), 8, specialise, {
          events: PAD_EVENTS,
          period: 24,
          toggles: TOGGLES,
          rest: 16,
          idStride: 64,
          paths: ['held', 'stolen', 'released', 'ended', 'silent'],
          vowels: VOWEL_SWEEP,
        }),
      );
    }
  }, 240_000);

  it('plays the Acid pad while lanes move its cutoff and Reso, in the kernel and the generic loop, for 8 000 quanta without allocating or changing a field representation (windsor#573)', () => {
    const toggles = [...TOGGLES, ...ACID_LANE_TOGGLES];
    const paths: FmPartChangeConfig['paths'] = ['held', 'stolen', 'released', 'ended', 'silent'];
    const config = { events: PAD_EVENTS, period: 6, toggles, rest: 16, idStride: 64, paths };
    for (const specialise of [true, false]) {
      expectClean(probe(acidPad(), 8, specialise, config, { voiceSlots: ACID_SLOTS }));
    }
  }, 240_000);

  it('holds a note in the kernel while its age passes 2^31, for 8 000 quanta without allocating or changing a field representation', () => {
    expectClean(probe(pad(), 8, true, drone(48, 'held')));
  }, 120_000);

  it('holds a dormant note in the generic loop while its age passes 2^31, for 8 000 quanta without allocating or changing a field representation', () => {
    expectClean(probe(pluck(), 4, false, drone(60, 'dormant')));
  }, 120_000);
});
