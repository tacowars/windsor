/**
 * A decay lane's change lands on a running decay with no jump in its level
 * (windsor#347 decisions 1 and 2), for each of the nine targets, at both
 * ends of the register, where key scaling makes the decay four times shorter
 * and three times longer.
 *
 * Each run renders one control block a call and reads the envelope the lane
 * moves after each. At the block the lane changes:
 * - a new time keeps the decay's phase and runs on at the new rate, so the
 *   level is the one the old segment's curve gives at the advanced phase;
 * - a new curve starts what is left again from the level it was at, over the
 *   time it had left, so the level is the new curve's first step from there,
 *   and the decay reaches its sustain on the block it would have.
 * Either way the step is no larger than twice the largest any block of the
 * decay makes with the lane held at its new value throughout.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor } from '../__fixtures__/workletHarness';
import { catalogRow } from '../automation/automationTargets';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { ST_DECAY, ST_SUSTAIN, segmentLevel } from '../worklet/fm/envelope';
import { voiceSlotParamName } from './audioPart';
import { voiceOffset } from './voiceAutomation';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const CTRL = loaded.ctrlInterval;
const SLOTS = 8;
const ADDITIVE = 7;
/** The decay's time and key scaling: 1 s at middle C, 0.25 s at C8 and 3.1 s at A0. */
const DECAY = 1;
const KEY_SCALE = 0.5;
const SUSTAIN = 0.5;
/** The control block a lane changes on: 133 ms in, inside every decay here. */
const CHANGE = 200;
/** The block a held lane moves on, and the block a patch edit lands before: inside every decay. */
const LANE_MOVES = 20;
const EDIT_AT = 40;
/** The register's ends: A0 and C8. */
const NOTES = [21, 108] as const;

const DECAYS: readonly string[] = [
  'filter.env.decayTime',
  ...[0, 1, 2, 3].flatMap((i) => [`ops.${i}.env.decayTime`, `ops.${i}.env.decayCurve`]),
];

const env = (decayCurve: number, sustainLevel: number): ReturnType<typeof makeEnvelope> =>
  makeEnvelope({
    attackTime: 0.002,
    decayTime: DECAY,
    decayCurve,
    sustainLevel,
    keyScale: KEY_SCALE,
  });

/** Four carriers whose decays bow both ways, and a low-pass whose envelope decays to 0. */
const PATCH: Patch = makePatch({
  algorithm: ADDITIVE,
  ops: [1, -1, 0.5, -0.5].map((decayCurve, i) => ({
    wave: WAVE.SINE,
    ratio: i + 1,
    level: 0.5,
    env: env(decayCurve, SUSTAIN),
  })),
  filter: { mode: FILTER_MODE.LOWPASS, cutoff: 300, resonance: 1, envAmount: 4, env: env(0, 0) },
});

/** What these tests read off an envelope. */
interface EnvView {
  state: number;
  value: number;
  phase: number;
  segStart: number;
  segCurve: number;
  decayLeft: number;
  timeScale: number;
}

interface VoiceView {
  active: boolean;
  ampEnv: EnvView[];
  filtEnv: EnvView;
}

/** The envelope `path` moves. */
function envOf(voice: VoiceView, path: string): EnvView {
  return path.startsWith('filter.') ? voice.filtEnv : voice.ampEnv[Number(path.split('.')[1])]!;
}

const isTime = (path: string): boolean => path.endsWith('decayTime');

/** The lane's new value: a quarter of the time, or the curve flipped. */
function laneValue(path: string): number {
  if (isTime(path)) return DECAY / 4;
  return -PATCH.ops[Number(path.split('.')[1])]!.env.decayCurve;
}

const offsetFor = (path: string): number =>
  voiceOffset(PATCH, path, catalogRow(`voice.${path}`)!, laneValue(path));

/**
 * Each control block's copy of the envelope `path` moves, a note held, slot 0
 * at `offset` from block `from`. With `edit`, live retune is on and the
 * patch becomes `edit.to` before block `edit.at`, as a console knob sends it,
 * and from that block (or from `edit.resyncAt`) the slot carries
 * `edit.offset` where it carried `offset`: the lane's value resynced against
 * the new patch.
 */
function trace(
  note: number,
  path: string,
  offset: number,
  from: number,
  edit?: { at: number; to: Patch; offset: number; resyncAt?: number },
): EnvView[] {
  const processor = loaded.create(PATCH, 4, undefined, { voiceSlots: [path] });
  if (edit) processor.inbox({ type: 'liveRetune', enabled: true } as never);
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const left = new Float32Array(CTRL);
  const right = new Float32Array(CTRL);
  processor.inbox({ type: 'noteOn', id: 1, note, velocity: 1, frame: 0 });
  const seen: EnvView[] = [];
  for (let b = 0; b < 20_000; b++) {
    loaded.setFrame(b * CTRL);
    if (b === edit?.at) processor.inbox({ type: 'patch', patch: edit.to } as never);
    const lane = edit && b >= (edit.resyncAt ?? edit.at) ? edit.offset : offset;
    params.voiceSlot0![0] = b >= from ? lane : 0;
    processor.process([], [[left, right]], params);
    const voice = (processor.voices as unknown as VoiceView[]).find((v) => v.active)!;
    const e = envOf(voice, path);
    const { state, value, phase, segStart, segCurve, decayLeft, timeScale } = e;
    seen.push({ state, value, phase, segStart, segCurve, decayLeft, timeScale });
    if (seen.at(-1)!.state === ST_SUSTAIN) break;
  }
  return seen;
}

/** The largest step any block of `seen` makes. */
function largestStep(seen: readonly EnvView[]): number {
  let max = 0;
  for (let b = 1; b < seen.length; b++) {
    max = Math.max(max, Math.abs(seen[b]!.value - seen[b - 1]!.value));
  }
  return max;
}

const cases = NOTES.flatMap((note) => DECAYS.map((path) => [path, note] as const));

describe('a decay lane on a running decay, at the register ends (windsor#347)', () => {
  it.each(cases)('%s at note %i runs on from the level it is at', (path, note) => {
    const offset = offsetFor(path);
    const moved = trace(note, path, offset, CHANGE);
    const plain = trace(note, path, 0, Infinity);
    const before = moved[CHANGE - 1]!;
    const at = moved[CHANGE]!;
    expect(before).toEqual(plain[CHANGE - 1]);
    expect(before.state).toBe(ST_DECAY);
    expect(before.phase).toBeGreaterThan(0.02);
    expect(before.phase).toBeLessThan(0.9);
    const target = path.startsWith('filter.') ? 0 : SUSTAIN;
    const time = DECAY * before.timeScale;
    if (isTime(path)) {
      const phase = before.phase + CTRL / (laneValue(path) * time * SR);
      expect(at.value).toBeCloseTo(
        segmentLevel(before.segStart, target, phase, before.segCurve),
        9,
      );
    } else {
      const left = 1 - before.phase;
      const level = segmentLevel(before.value, target, CTRL / (left * time * SR), laneValue(path));
      expect(at.value).toBeCloseTo(level, 9);
      expect(at.decayLeft).toBeCloseTo(left, 12);
      expect(moved.length).toBe(plain.length);
    }
    const steady = trace(note, path, offset, 0);
    expect(Math.abs(at.value - before.value)).toBeLessThanOrEqual(2 * largestStep(steady));
    expect(moved.at(-1)!.value).toBe(target);
  });
});

/** An edit no lane moves: operator 0's level, half again. */
const UNRELATED: Patch = (() => {
  const to = structuredClone(PATCH);
  to.ops[0]!.level = 0.75;
  return to;
})();

/**
 * Codex P1 on PR #400: a rebind configures each envelope from the new patch
 * and binds the step's values before the lane's go back over them, so the
 * decay's fields hold the patch's for a moment. Only a change in the lane's
 * own value reshapes a running decay; a rebind that leaves it where it was
 * leaves the decay's level, phase and rate as they were, to the bit, whether
 * the lane has held its value since the note began or moved during the decay.
 */
describe('a held decay lane through a live patch edit (windsor#347)', () => {
  const held = NOTES.flatMap((note) =>
    DECAYS.flatMap((path) => [[path, note, 0] as const, [path, note, LANE_MOVES] as const]),
  );
  it.each(held)('%s at note %i, moved at block %i, keeps its decay', (path, note, from) => {
    const offset = offsetFor(path);
    const plain = trace(note, path, offset, from);
    const edited = trace(note, path, offset, from, { at: EDIT_AT, to: UNRELATED, offset });
    expect(plain[EDIT_AT]!.state).toBe(ST_DECAY);
    expect(plain[EDIT_AT]!.phase).toBeGreaterThan(0);
    if (from > 0 && !isTime(path)) expect(plain[EDIT_AT]!.decayLeft).toBeLessThan(1);
    expect(edited).toEqual(plain);
  });
});

const BASE_CURVE = 0.3;

/** `PATCH` with the base under `path` moved, to values whose offsets a float32 slot rounds. */
function baseMoved(path: string): Patch {
  const to = structuredClone(PATCH);
  const e = path.startsWith('filter.') ? to.filter.env : to.ops[Number(path.split('.')[1])]!.env;
  if (isTime(path)) e.decayTime = 1.7 * DECAY;
  else e.decayCurve = BASE_CURVE;
  return to;
}

/**
 * An edit of the very value a held lane moves, its offset resynced against
 * the new patch as the main thread sends it (`AudioSystem.apply`, in the
 * edit's quantum), or for a curve a block late: the lane's value has not
 * moved, so the decay is not started again. Until the resync the voice holds
 * the curve it plays. The offset rides a float32 slot, so the value after
 * the resync may lie an ulp from the one before; a curve then runs on from
 * its phase over the time it had left, and a time at its phase within that
 * rounding, which may end the decay a block apart. A time is not held: a
 * resync a block late would play that block at the old offset over the new
 * base, as every other lane target does (windsor#346).
 */
describe('a held decay lane through an edit of its own base (windsor#347)', () => {
  const held = NOTES.flatMap((note) =>
    DECAYS.flatMap((path) =>
      [0, LANE_MOVES].flatMap((from) =>
        (isTime(path) ? [0] : [0, 1]).map((late) => [path, note, from, late] as const),
      ),
    ),
  );
  it.each(held)('%s at note %i, moved at block %i, resynced %i late', (path, note, from, late) => {
    const offset = offsetFor(path);
    const to = baseMoved(path);
    const resynced = voiceOffset(to, path, catalogRow(`voice.${path}`)!, laneValue(path));
    const plain = trace(note, path, offset, from);
    const resyncAt = EDIT_AT + late;
    const edit = { at: EDIT_AT, to, offset: resynced, resyncAt };
    const edited = trace(note, path, offset, from, edit);
    expect(Math.abs(edited.length - plain.length)).toBeLessThanOrEqual(isTime(path) ? 1 : 0);
    expect(edited.slice(0, resyncAt)).toEqual(plain.slice(0, resyncAt));
    // The hold ends at the resync: the curve is then the new base's, offset.
    if (!isTime(path)) expect(edited[resyncAt]!.segCurve).toBe(BASE_CURVE + Math.fround(resynced));
    const n = Math.min(edited.length, plain.length) - 1;
    for (let b = resyncAt; b < n; b++) {
      expect(edited[b]!.state).toBe(plain[b]!.state);
      expect(edited[b]!.decayLeft).toBe(plain[b]!.decayLeft);
      expect(edited[b]!.value).toBeCloseTo(plain[b]!.value, isTime(path) ? 5 : 7);
    }
  });
});
