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
  DriveSettings,
  Envelope as EnvelopeParams,
  LfoSettings,
  Macro,
  Operator,
  PartialOperator,
  PartialPatch,
  Patch,
} from '../../patch/patch';
import { ALGORITHMS } from './algorithms';
import type { MacroTables } from './voiceMacros';
import { effectiveMacroMappings } from './macroMappings';
import { DRIVE_FOLD, DRIVE_SOFT, FILT_FORMANT, FILT_OFF } from './modeIds';
import {
  DRIVE_BIAS_RANGE,
  DRIVE_DEFAULTS,
  DRIVE_GAIN_RANGE,
  DRIVE_TONE_RANGE,
  driveOnByDefault,
  ENVELOPE_DEFAULTS,
  FEEDBACK_RANGE,
  FILTER_DEFAULTS,
  FILTER_ENV_DEFAULTS,
  LEAD_OPERATOR_LEVEL,
  LFO2_DEFAULTS,
  LFO_DEFAULTS,
  LFO_TO_OP_DEFAULT,
  LFO_TO_WIDTH_DEFAULT,
  MACRO_DEFAULTS,
  MACRO_VALUE_RANGE,
  MACROS_MAX,
  NOISE_COLOUR_RANGE,
  OPERATOR_COUNT,
  OPERATOR_DEFAULTS,
  PATCH_DEFAULTS,
  PITCH_ENV_DEFAULTS,
  TONE_RANGE,
  VOWEL_RANGE,
  WIDTH_RANGE,
} from './patchDefaults';

/**
 * The patch the voice reads: every field filled, and its macro mappings
 * compiled onto it (`compileMacros`, windsor#560). The per-operator feedback
 * the loops read is the voice's own since windsor#17 (`Voice.opFeedback`).
 */
export type WorkletPatch = Patch & MacroTables;

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
    noiseLp: clamp(num(o.noiseLp, d.noiseLp), NOISE_COLOUR_RANGE), // Hz, 0 off; Noise only (windsor#362)
    noiseHp: clamp(num(o.noiseHp, d.noiseHp), NOISE_COLOUR_RANGE),
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

/**
 * The drive stage (windsor#300): a shape id outside the table plays `soft`,
 * and the gain, bias and tone are clamped to their ranges (the gain's
 * bound keeps the shaper's operand finite, windsor#308). A patch with no
 * boolean `on` takes `driveOnByDefault` of its gain and bias (windsor#309).
 * `on` is added after the four-number literal, not written in it: a fifth
 * literal key starts a new object shape whose numbers are born small
 * integers (the default patch's 1 and 0) and then generalise to doubles
 * under a driven patch, which `fmProcessorAllocation.test.ts` refuses.
 */
function driveDefaults(raw: Partial<DriveSettings> | null | undefined): DriveSettings {
  raw = raw || {};
  const d = DRIVE_DEFAULTS;
  const shape = num(raw.shape, d.shape) | 0;
  const gain = clamp(num(raw.gain, d.gain), DRIVE_GAIN_RANGE);
  const bias = clamp(num(raw.bias, d.bias), DRIVE_BIAS_RANGE);
  const drive = {
    gain,
    shape: shape < DRIVE_SOFT || shape > DRIVE_FOLD ? DRIVE_SOFT : shape,
    bias,
    tone: clamp(num(raw.tone, d.tone), DRIVE_TONE_RANGE),
  } as DriveSettings;
  drive.on = typeof raw.on === 'boolean' ? raw.on : driveOnByDefault(gain, bias);
  return drive;
}

/**
 * The macros: at most `MACROS_MAX`, each value in 0..1, each with the
 * mappings `effectiveMacroMappings` keeps for it (the one rule the main
 * thread reads too, windsor#560).
 */
function macrosDefaults(raw: unknown): Macro[] {
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  const out: Macro[] = [];
  for (let i = 0; i < list.length && i < MACROS_MAX; i++) {
    const o = (list[i] || {}) as Partial<Macro>;
    out.push({
      name: typeof o.name === 'string' ? o.name : MACRO_DEFAULTS.name,
      value: clamp(num(o.value, MACRO_DEFAULTS.value), MACRO_VALUE_RANGE),
      mappings: [],
    });
  }
  for (const { macro, mapping } of effectiveMacroMappings({ macros: list })) {
    out[macro]!.mappings.push(mapping);
  }
  return out;
}

function normalisePatch(raw: PartialPatch | null | undefined): Patch {
  raw = raw || {};
  const ops: Operator[] = [];
  for (let i = 0; i < OPERATOR_COUNT; i++) ops.push(opDefaults(raw.ops && raw.ops[i], i));

  const filtRaw = raw.filter || {};
  const pd = PATCH_DEFAULTS,
    fd = FILTER_DEFAULTS;
  // A mode outside the table plays Off, as it always sounded (windsor#331).
  const mode = num(filtRaw.mode, fd.mode) | 0;

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
      mode: mode < FILT_OFF || mode > FILT_FORMANT ? FILT_OFF : mode,
      cutoff: num(filtRaw.cutoff, fd.cutoff),
      resonance: num(filtRaw.resonance, fd.resonance),
      slope24: !!filtRaw.slope24,
      envAmount: num(filtRaw.envAmount, fd.envAmount), // octaves
      modWheelDepth: num(filtRaw.modWheelDepth, fd.modWheelDepth), // octaves the wheel adds to envAmount (#586)
      lfoAmount: num(filtRaw.lfoAmount, fd.lfoAmount), // octaves
      lfo2Amount: num(filtRaw.lfo2Amount, fd.lfo2Amount), // octaves, from LFO 2
      keyTrack: num(filtRaw.keyTrack, fd.keyTrack),
      vowel: clamp(num(filtRaw.vowel, fd.vowel), VOWEL_RANGE), // Formant only (windsor#331)
      env: envDefaults(filtRaw.env, FILTER_ENV_DEFAULTS),
    },
    drive: driveDefaults(raw.drive),
    macros: macrosDefaults(raw.macros),
  } satisfies Patch;
  return p;
}

export { num, normalisePatch };
