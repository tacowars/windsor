/**
 * Each voice's control interval (windsor#326): at every control boundary the
 * part asks how many samples the next control block spans, and the voice
 * answers from its own state, `CTRL_INTERVAL` (32) while anything fast is
 * happening and `CTRL_INTERVAL_LONG` (128) while nothing is. A pad in its
 * sustain or a long release runs the control update and the kernel's
 * prologue once a quantum instead of four times; a drum hit, a fast sweep or
 * a fast LFO never leaves the fine interval, so it renders as it always did.
 *
 * Fast is any of:
 * - an operator's amplitude envelope, the pitch envelope while its amount is
 *   not 0, or the filter's envelope while the filter is on and its amount
 *   (or wheel depth) is not 0, in a running segment (attack, decay,
 *   release) whose time after key scaling is under
 *   `CTRL_LONG_MIN_SEGMENT_SECONDS`;
 * - an operator's amplitude envelope in a Loop or Trigger mode, until it is
 *   done: its segments recur, so their ends keep landing in small blocks;
 * - a glide in progress whose time is under that same floor;
 * - an LFO that reaches anything, a depth (its amount or its wheel depth)
 *   and a destination (pitch, an operator's level, width or ratio, or the filter
 *   while it is on), at `CTRL_LONG_MAX_LFO_HZ` or faster, or at any rate in
 *   a shape that jumps (square, sample and hold, either saw): a jump is a
 *   transient, and a long block would stretch its amplitude ramp from 32
 *   samples to 128 and move it by up to 128;
 * - an operator's feedback ramping under a song lane: the render loops time
 *   that ramp in fine blocks (`FEEDBACK_RAMP_STEP`);
 * - in a voice with a synced operator, an operator's ratio being modulated
 *   (windsor#655, record `2026-10-09-sync-direct-shape` decision 4): an
 *   LFO's `toRatio` on any operator that is not 0, whatever its rate, shape
 *   or depth, or a song lane's offset that is not 0 on any `ops.<i>.ratio`
 *   row, directly or through a macro that maps the row. A ratio stepped
 *   every 128 samples puts a floor of about −43 dB under a sync sweep's
 *   alias (`docs/research/2026-10-09-sync-antialias-study/`); a step's push
 *   is fixed for the note, so it steps nothing. The study measured the
 *   stepping with sync on only, so a voice with no synced operator reads
 *   its ratio LFO by the LFO rule above, as it did before.
 * A segment end inside a long block is one of windsor#301's knots, at its
 * own sample (`voiceAmpRamp.ts`), so a long block holds a long segment's end
 * and the short one after it exactly.
 *
 * Invariant: reads only, allocation free, and no double crosses a call
 * (windsor#233): the thresholds are the table's fields, the times the
 * envelopes' and the LFOs', and the answer a small integer. The part asks
 * after the song's lanes are on the voice (`applyVoiceOffsets`), so the
 * rates, amounts and decay times read here are the ones the block plays.
 * With `long` equal to `fine` the part renders exactly as before this
 * module. `voiceControlInterval.test.ts` pins every clause and threshold;
 * `synth/fmProcessorControlInterval.test.ts` the render under both tables.
 */

import type { Envelope } from './envelope';
import type { Voice } from './voice';
import { ST_ATTACK, ST_DECAY, ST_DONE, ST_IDLE, ST_RELEASE } from './envelope';
import { OPERATOR_COUNT } from './patchDefaults';
import {
  CTRL_INTERVAL,
  CTRL_INTERVAL_LONG,
  CTRL_LONG_MAX_LFO_HZ,
  CTRL_LONG_MIN_SEGMENT_SECONDS,
} from './fmConstants';
import {
  FILT_OFF,
  LFO_SAW_DOWN,
  LFO_SAW_UP,
  LFO_SH,
  LFO_SQUARE,
  LOOP_LOOP,
  LOOP_TRIGGER,
} from './modeIds';
import {
  VT_ENV_AMOUNT,
  VT_LFO2_AMOUNT,
  VT_LFO_AMOUNT,
  VT_OP_BASE,
  VT_OP_RATIO,
  VT_OP_STRIDE,
  VT_PITCH_ENV_AMOUNT,
} from './voiceTargetTables';

/** The two intervals, in samples, and the two thresholds between them. */
interface ControlIntervalTable {
  fine: number;
  long: number;
  minSegmentSeconds: number;
  maxLfoHz: number;
}

/** What a harness may set (`processorOptions.controlIntervals`); the fine interval is the loops' and stays. */
type ControlIntervalOverrides = Partial<Omit<ControlIntervalTable, 'fine'>>;

/** The shipped table, from `fmConstants.ts`. */
const CONTROL_INTERVALS: ControlIntervalTable = {
  fine: CTRL_INTERVAL,
  long: CTRL_INTERVAL_LONG,
  minSegmentSeconds: CTRL_LONG_MIN_SEGMENT_SECONDS,
  maxLfoHz: CTRL_LONG_MAX_LFO_HZ,
};

/** The part's table: the shipped one with a harness's overrides, built once at construction. */
function controlIntervalTable(overrides?: ControlIntervalOverrides): ControlIntervalTable {
  return { ...CONTROL_INTERVALS, ...overrides, fine: CTRL_INTERVAL };
}

/**
 * `env` keeps the voice fine: a running segment under the table's floor,
 * or, for an operator's amplitude envelope (`looping`), a Loop or Trigger
 * mode still running. Read at a control boundary, where the render has
 * passed every knot of the block before, so the envelope's own stage is the
 * one heard (`voiceQuiet.ts`'s `heardStage` reads the same there).
 */
function envelopeFast(env: Envelope, looping: boolean, table: ControlIntervalTable): boolean {
  const state = env.state;
  if (state === ST_IDLE || state === ST_DONE) return false;
  const p = env.p!;
  if (looping && (p.loopMode === LOOP_LOOP || p.loopMode === LOOP_TRIGGER)) return true;
  let time: number;
  if (state === ST_ATTACK) time = p.attackTime;
  else if (state === ST_DECAY) time = env.decayTime * env.decayLeft;
  else if (state === ST_RELEASE) time = p.releaseTime;
  else return false;
  return time * env.timeScale < table.minSegmentSeconds;
}

/** An LFO shape whose level jumps once a cycle or more: square, sample and hold, either saw. */
function lfoShapeJumps(shape: number): boolean {
  return shape === LFO_SQUARE || shape === LFO_SH || shape === LFO_SAW_UP || shape === LFO_SAW_DOWN;
}

/** LFO 1 (or 2, `second`) reaches anything, at the table's rate or faster or in a shape that jumps. */
function lfoFast(voice: Voice, second: boolean, table: ControlIntervalTable): boolean {
  const patch = voice.patch!;
  const p = second ? patch.lfo2 : patch.lfo;
  const lfo = second ? voice.lfo2 : voice.lfo;
  if (!(lfo.rate >= table.maxLfoHz) && !lfoShapeJumps(p.shape)) return false;
  const amount = voice.liveValues[second ? VT_LFO2_AMOUNT : VT_LFO_AMOUNT];
  if (amount === 0 && p.modWheelDepth === 0) return false;
  if (p.toPitch !== 0) return true;
  for (let i = 0; i < p.toOp.length; i++) {
    if (p.toOp[i] !== 0 || p.toWidth[i] !== 0 || p.toRatio[i] !== 0) return true;
  }
  const f = patch.filter;
  return f.mode !== FILT_OFF && (second ? f.lfo2Amount : f.lfoAmount) !== 0;
}

/** Whether `code` is an operator's ratio row. */
function isRatioRow(code: number): boolean {
  const k = code - VT_OP_BASE;
  return k >= 0 && k < OPERATOR_COUNT * VT_OP_STRIDE && k % VT_OP_STRIDE === VT_OP_RATIO;
}

/**
 * A synced voice's operator ratio is modulated: an LFO's `toRatio` on it, or
 * a song lane's offset on its ratio row or on a macro mapped to that row.
 * Never for a voice with no synced operator.
 */
function ratioModulated(voice: Voice): boolean {
  if (voice.sync.synced === 0) return false;
  const patch = voice.patch!;
  const offsets = voice.partOffsets;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if (patch.lfo.toRatio[i] !== 0 || patch.lfo2.toRatio[i] !== 0) return true;
    if (offsets[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_RATIO] !== 0) return true;
  }
  for (let j = 0; j < patch.macroMapCount; j++) {
    if (isRatioRow(patch.macroMapTarget[j]) && offsets[patch.macroMapMacro[j]] !== 0) return true;
  }
  return false;
}

/** The voice's next control interval: the table's `fine` while anything is fast, else its `long`. */
function controlInterval(voice: Voice, table: ControlIntervalTable = CONTROL_INTERVALS): number {
  if (voice.fbRamp !== 0 || ratioModulated(voice)) return table.fine;
  for (let i = 0; i < voice.ampEnv.length; i++) {
    if (envelopeFast(voice.ampEnv[i], true, table)) return table.fine;
  }
  const patch = voice.patch!;
  const live = voice.liveValues;
  if (live[VT_PITCH_ENV_AMOUNT] !== 0 && envelopeFast(voice.pitchEnv, false, table)) {
    return table.fine;
  }
  const f = patch.filter;
  const filterEnv = f.mode !== FILT_OFF && (live[VT_ENV_AMOUNT] !== 0 || f.modWheelDepth !== 0);
  if (filterEnv && envelopeFast(voice.filtEnv, false, table)) return table.fine;
  if (voice.pitchCur !== voice.pitchTarget) {
    const glide = voice.glideSeconds > 0 ? voice.glideSeconds : patch.glide;
    if (glide < table.minSegmentSeconds) return table.fine;
  }
  if (lfoFast(voice, false, table) || lfoFast(voice, true, table)) return table.fine;
  return table.long;
}

export type { ControlIntervalOverrides, ControlIntervalTable };
export { CONTROL_INTERVALS, controlInterval, controlIntervalTable };
