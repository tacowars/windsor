/**
 * Patch normalisation (#644): the console and its songs send partial patches,
 * and every field is filled here so the audio loop never tests for undefined.
 * Invariant: every default and clamp bound is read from `patchDefaults.ts`,
 * the table `makePatch()` in `patch/patch.ts` fills from too, so the engine
 * and the console's knobs cannot disagree (#670; `patchDefaults.test.ts`
 * pins the two fills equal). Only a `patch` message reaches here, never the
 * audio loop, so allocation is fine.
 */

import type {
  Envelope as EnvelopeParams,
  LfoSettings,
  Operator,
  PartialOperator,
  PartialPatch,
  Patch,
} from '../../patch/patch';
import { ALGORITHMS } from './algorithms';
import {
  ENVELOPE_DEFAULTS,
  FEEDBACK_RANGE,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO2_DEFAULTS,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  LFO_TO_WIDTH_DEFAULT,
  OPERATOR_COUNT,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
  TONE_RANGE,
  WIDTH_RANGE,
} from './patchDefaults';

/** The patch the voice reads: every field filled, plus the per-operator feedback scratch. */
export interface WorkletPatch extends Patch {
  feedbackScratch: Float32Array;
}

/* ------------------------------------------------------------------ *
 * Patch normalisation
 *
 * The console and its songs send partial patches; fill in every field here so
 * the audio loop never has to test for undefined.
 * ------------------------------------------------------------------ */

function envDefaults(
  o: Partial<EnvelopeParams> | null | undefined,
  d: EnvelopeParams = ENVELOPE_DEFAULTS,
): EnvelopeParams {
  o = o || {};
  return {
    initLevel: num(o.initLevel, d.initLevel),
    attackTime: num(o.attackTime, d.attackTime),
    attackCurve: num(o.attackCurve, d.attackCurve),
    peakLevel: num(o.peakLevel, d.peakLevel),
    decayTime: num(o.decayTime, d.decayTime),
    decayCurve: num(o.decayCurve, d.decayCurve),
    sustainLevel: num(o.sustainLevel, d.sustainLevel),
    releaseTime: num(o.releaseTime, d.releaseTime),
    releaseCurve: num(o.releaseCurve, d.releaseCurve),
    endLevel: num(o.endLevel, d.endLevel),
    loopMode: num(o.loopMode, d.loopMode) | 0,
    keyScale: num(o.keyScale, d.keyScale),
  };
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function clamp(v: number, range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, v));
}

function opDefaults(o: PartialOperator | null | undefined, index: number): Operator {
  o = o || {};
  const d = OPERATOR_DEFAULTS;
  return {
    wave: num(o.wave, d.wave) | 0,
    userPartials: o.userPartials || d.userPartials,
    ratio: num(o.ratio, d.ratio),
    fixed: !!o.fixed,
    fixedHz: num(o.fixedHz, d.fixedHz),
    detune: num(o.detune, d.detune), // cents
    level: num(o.level, index === 0 ? LEAD_OPERATOR_LEVEL : d.level),
    feedback: clamp(num(o.feedback, d.feedback), FEEDBACK_RANGE), // bipolar (#529)
    width: clamp(num(o.width, d.width), WIDTH_RANGE), // the duty for PULSE
    velSens: num(o.velSens, d.velSens),
    levelKeyScale: num(o.levelKeyScale, d.levelKeyScale),
    phase: num(o.phase, d.phase),
    phaseFree: o.phaseFree !== false, // free-running by default (OPERATOR_DEFAULTS.phaseFree)
    env: envDefaults(o.env),
  };
}

/** One per-operator depth array, filled index by index. */
function perOperator(raw: unknown[] | null | undefined, d: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) out.push(num(raw && raw[i], d));
  return out;
}

/** Either LFO: the first and the second share a shape and differ only in their defaults. */
function lfoDefaults(
  raw: Partial<LfoSettings> | null | undefined,
  ld: typeof LFO_DEFAULTS,
): LfoSettings {
  raw = raw || {};
  return {
    shape: num(raw.shape, ld.shape) | 0,
    rate: num(raw.rate, ld.rate),
    amount: num(raw.amount, ld.amount),
    delay: num(raw.delay, ld.delay),
    retrigger: !!raw.retrigger,
    oneShot: !!raw.oneShot, // runs once from note-on and holds
    unipolar: !!raw.unipolar, // 0..1 instead of -1..1
    toPitch: num(raw.toPitch, ld.toPitch), // semitones
    modWheelDepth: num(raw.modWheelDepth, ld.modWheelDepth),
    toOp: perOperator(raw.toOp, LFO_TO_OP_DEFAULT),
    toWidth: perOperator(raw.toWidth, LFO_TO_WIDTH_DEFAULT),
  };
}

function normalisePatch(raw: PartialPatch | null | undefined): WorkletPatch {
  raw = raw || {};
  const ops: Operator[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) ops.push(opDefaults(raw.ops && raw.ops[i], i));

  const filtRaw = raw.filter || {};
  const pd = PATCH_DEFAULTS,
    fd = FILTER_DEFAULTS;

  const p = {
    name: raw.name || pd.name,
    algorithm: Math.max(0, Math.min(ALGORITHMS.length - 1, num(raw.algorithm, pd.algorithm) | 0)),
    volume: num(raw.volume, pd.volume),
    tone: clamp(num(raw.tone, pd.tone), TONE_RANGE),
    glide: num(raw.glide, pd.glide),
    pitchEnv: envDefaults(raw.pitchEnv, PITCH_ENV_DEFAULTS),
    pitchEnvAmount: num(raw.pitchEnvAmount, pd.pitchEnvAmount), // semitones
    pan: num(raw.pan, pd.pan),
    panRandom: num(raw.panRandom, pd.panRandom),
    panKey: num(raw.panKey, pd.panKey),
    spread: num(raw.spread, pd.spread), // cents; >0 doubles voices
    mono: !!raw.mono, // one note at a time, with retrigger (#453)
    ops,
    lfo: lfoDefaults(raw.lfo, LFO_DEFAULTS),
    lfo2: lfoDefaults(raw.lfo2, LFO2_DEFAULTS),
    filter: {
      mode: num(filtRaw.mode, fd.mode) | 0,
      cutoff: num(filtRaw.cutoff, fd.cutoff),
      resonance: num(filtRaw.resonance, fd.resonance),
      drive: num(filtRaw.drive, fd.drive),
      slope24: !!filtRaw.slope24,
      envAmount: num(filtRaw.envAmount, fd.envAmount), // octaves
      modWheelDepth: num(filtRaw.modWheelDepth, fd.modWheelDepth), // octaves the wheel adds to envAmount (#586)
      lfoAmount: num(filtRaw.lfoAmount, fd.lfoAmount), // octaves
      lfo2Amount: num(filtRaw.lfo2Amount, fd.lfo2Amount), // octaves, from LFO 2
      keyTrack: num(filtRaw.keyTrack, fd.keyTrack),
      env: envDefaults(filtRaw.env, FILTER_ENV_DEFAULTS),
    },
  } satisfies Patch as WorkletPatch;

  p.feedbackScratch = new Float32Array(OPERATOR_COUNT);
  for (let i = 0; i < OPERATOR_COUNT; i++) p.feedbackScratch[i] = ops[i].feedback;
  return p;
}

export { num, normalisePatch };
