/**
 * Codex's two P1s on PR #400 after its last round (windsor#405).
 *
 * - A legato slide never reshapes a running decay a curve lane holds: only a
 *   change in the lane's offset does (decision 1). `Voice.retarget` binds the
 *   new step over the patch, which writes the step's curve into each
 *   envelope; the voice keeps the curve it plays across it. The operators'
 *   decays have no key scaling, so a slide leaves their rate alone and the
 *   slid note's envelopes run bit for bit as the held note's.
 * - A step's decay push stacks on a decay lane's absolute value (decision 2):
 *   over a patch decay of 0, a lane above the 1 ms floor and a step pushing
 *   up play longer than the lane alone, where the step's own value was the
 *   floor and the lane's ratio scaled that floor straight to the lane's.
 */
import { describe, expect, it } from 'vitest';

import { voiceLaneOffset } from '../__fixtures__/voiceLaneOffset';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { ST_DECAY } from '../worklet/fm/envelope';
import {
  VOICE_TARGET_PATHS,
  VOICE_TARGET_COUNT,
  VOICE_TARGET_TABLE,
} from '../worklet/fm/voiceTargetTables';
import type { VoiceTargetPath } from '../worklet/fm/voiceTargetTables';
import { stepModValue } from '../worklet/fm/voiceTargetValue';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const CTRL = loaded.ctrlInterval;
const SLOTS = 8;
const ADDITIVE = 7;
const NOTE = 57;
/** The block a lane moves on, the block a patch edit lands on, and the block the note slides on. */
const LANE_MOVES = 20;
const EDIT_AT = 40;
const SLIDE_AT = 60;
const BLOCKS = 90;

const CURVES = [0, 1, 2, 3].map((i) => `ops.${i}.env.decayCurve`);

/** Four carriers whose 1 s decays bow both ways, with no key scaling, and a low-pass. */
const MONO: Patch = {
  ...makePatch({
    algorithm: ADDITIVE,
    ops: [1, -1, 0.5, -0.5].map((decayCurve, i) => ({
      wave: WAVE.SINE,
      ratio: i + 1,
      level: 0.5,
      env: makeEnvelope({ attackTime: 0.002, decayTime: 1, decayCurve, sustainLevel: 0.5 }),
    })),
    filter: { mode: FILTER_MODE.LOWPASS, cutoff: 300, resonance: 1, envAmount: 4 },
  }),
  mono: true,
};

/** Each curve's base moved, to values whose offsets a float32 slot rounds. */
const REBASED: Patch = (() => {
  const to = structuredClone(MONO);
  to.ops.forEach((op, i) => (op.env.decayCurve = 0.3 - 0.2 * i));
  return to;
})();

/** Each curve's lane, flipped from its patch's, as an offset against `patch`. */
const curveOffset = (patch: Patch, path: string, i: number): number =>
  voiceLaneOffset(patch, path, -MONO.ops[i]!.env.decayCurve);

function stepMod(param: VoiceTargetPath, value: number): number[] {
  const out = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  out[VOICE_TARGET_PATHS.indexOf(param)] = value;
  return out;
}

/** A step pushing every curve, which a slide keeps (`slideKeeps`), the slide's own ignored. */
const curveSteps = (value: number): number[] =>
  CURVES.reduce((out, path) => {
    out[VOICE_TARGET_PATHS.indexOf(path as VoiceTargetPath)] = value;
    return out;
  }, new Array<number>(VOICE_TARGET_COUNT).fill(0));

interface EnvView {
  state: number;
  value: number;
  phase: number;
  segStart: number;
  segCurve: number;
  decayLeft: number;
  decayCurve: number;
}

interface Run {
  /** The block the lanes take their offsets from. */
  from: number;
  slide: boolean;
  /** A live edit of the curves' bases, the lanes resynced against it from `resyncAt`. */
  edit?: { resyncAt: number };
}

const freshParams = (): Record<string, Float32Array> => {
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  return params;
};

/** The four operators' envelopes after each control block, a curve lane on each. */
function trace(run: Run): EnvView[][] {
  const processor = loaded.create(MONO, 4, undefined, { voiceSlots: CURVES, slideSeconds: 0.05 });
  if (run.edit) processor.inbox({ type: 'liveRetune', enabled: true } as never);
  const params = freshParams();
  const left = new Float32Array(CTRL);
  const right = new Float32Array(CTRL);
  processor.inbox({
    type: 'noteOn',
    id: 1,
    note: NOTE,
    velocity: 1,
    frame: 0,
    stepMod: curveSteps(0.25),
  });
  const seen: EnvView[][] = [];
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * CTRL);
    if (run.edit && b === EDIT_AT) processor.inbox({ type: 'patch', patch: REBASED } as never);
    if (run.slide && b === SLIDE_AT) {
      const frame = b * CTRL;
      processor.inbox({
        type: 'noteOn',
        id: 2,
        note: NOTE + 7,
        velocity: 0.7,
        frame,
        slide: true,
        stepMod: curveSteps(-0.5),
      });
    }
    const against = run.edit && b >= run.edit.resyncAt ? REBASED : MONO;
    CURVES.forEach((path, i) => {
      params[voiceSlotParamName(i)]![0] = b >= run.from ? curveOffset(against, path, i) : 0;
    });
    processor.process([], [[left, right]], params);
    const voices = processor.voices as unknown as { active: boolean; ampEnv: EnvView[] }[];
    const live = voices.filter((v) => v.active);
    expect(live).toHaveLength(1);
    seen.push(
      live[0]!.ampEnv.map(({ state, value, phase, segStart, segCurve, decayLeft, decayCurve }) => ({
        state,
        value,
        phase,
        segStart,
        segCurve,
        decayLeft,
        decayCurve,
      })),
    );
  }
  return seen;
}

describe('a held decay-curve lane through a legato slide (windsor#405)', () => {
  const runs: [string, Omit<Run, 'slide'>][] = [
    ['held from the note-on', { from: 0 }],
    ['moved during the decay', { from: LANE_MOVES }],
    ['over an edited base, resynced at once', { from: 0, edit: { resyncAt: EDIT_AT } }],
    ['moved, then its base edited', { from: LANE_MOVES, edit: { resyncAt: EDIT_AT } }],
    [
      'over an edited base, sliding before the resync',
      { from: 0, edit: { resyncAt: SLIDE_AT + 1 } },
    ],
  ];
  it.each(runs)('a lane %s keeps every operator’s decay as it runs', (_name, run) => {
    const held = trace({ ...run, slide: false });
    const slid = trace({ ...run, slide: true });
    for (let i = 0; i < 4; i++) {
      expect(held[SLIDE_AT]![i]!.state).toBe(ST_DECAY);
      expect(held[SLIDE_AT]![i]!.phase).toBeGreaterThan(0);
    }
    expect(slid).toEqual(held);
  });
});

const DECAY_TIMES = ['filter.env.decayTime', ...[0, 1, 2, 3].map((i) => `ops.${i}.env.decayTime`)];

/** `MONO` with every decay time 0. */
const ZEROED: Patch = (() => {
  const to = structuredClone(MONO);
  to.filter.env.decayTime = 0;
  for (const op of to.ops) op.env.decayTime = 0;
  return to;
})();

/** The decay time the envelope `path` names plays after two blocks, its lane held at `lane`. */
function decayPlayed(path: string, lane: number, push: number): number {
  const processor = loaded.create(ZEROED, 4, undefined, { voiceSlots: [path] });
  const params = freshParams();
  params.voiceSlot0![0] = voiceLaneOffset(ZEROED, path, lane);
  const left = new Float32Array(CTRL);
  const right = new Float32Array(CTRL);
  const step = stepMod(path as VoiceTargetPath, push);
  processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0, stepMod: step });
  for (let b = 0; b < 2; b++) {
    loaded.setFrame(b * CTRL);
    processor.process([], [[left, right]], params);
  }
  const voice = processor.voices.find((v) => v.active) as unknown as {
    ampEnv: { decayTime: number }[];
    filtEnv: { decayTime: number };
  };
  const op = path.startsWith('filter.') ? -1 : Number(path.split('.')[1]);
  return op < 0 ? voice.filtEnv.decayTime : voice.ampEnv[op]!.decayTime;
}

describe("a step's decay push over a decay lane on a zero-decay patch (windsor#405)", () => {
  const LANE = 0.5;
  it.each(DECAY_TIMES.map((path) => [path]))('%s stacks the step on the lane’s value', (path) => {
    const row = VOICE_TARGET_TABLE[VOICE_TARGET_PATHS.indexOf(path as VoiceTargetPath)]!;
    const alone = decayPlayed(path, LANE, 0);
    const offset = Math.fround(voiceLaneOffset(ZEROED, path, LANE));
    expect(alone).toBe(0.001 * Math.pow(2, offset));
    expect(alone).toBeCloseTo(LANE, 6);
    const longer = decayPlayed(path, LANE, 0.25);
    expect(longer).toBeGreaterThan(alone);
    expect(longer).toBe(stepModValue(row, alone, 0.25));
    const shorter = decayPlayed(path, LANE, -0.25);
    expect(shorter).toBeLessThan(alone);
    expect(shorter).toBe(stepModValue(row, alone, -0.25));
    // Clamped to the row's range: pushed past its top, or under its floor from a lane near it.
    expect(decayPlayed(path, LANE, 1)).toBe(row.max);
    expect(decayPlayed(path, 0.002, -1)).toBe(row.min);
  });

  it.each(DECAY_TIMES.map((path) => [path]))('%s without a lane plays the step alone', (path) => {
    const processor = loaded.create(ZEROED, 4);
    const row = VOICE_TARGET_TABLE[VOICE_TARGET_PATHS.indexOf(path as VoiceTargetPath)]!;
    const params = freshParams();
    const left = new Float32Array(CTRL);
    const right = new Float32Array(CTRL);
    const step = stepMod(path as VoiceTargetPath, 0.25);
    processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0, stepMod: step });
    processor.process([], [[left, right]], params);
    const voice = processor.voices.find((v) => v.active) as unknown as {
      ampEnv: { decayTime: number }[];
      filtEnv: { decayTime: number };
    };
    const op = path.startsWith('filter.') ? -1 : Number(path.split('.')[1]);
    const played = op < 0 ? voice.filtEnv.decayTime : voice.ampEnv[op]!.decayTime;
    expect(played).toBe(stepModValue(row, 0, 0.25));
  });
});
