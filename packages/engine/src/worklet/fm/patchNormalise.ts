/* eslint-disable no-magic-numbers -- DSP: the patch defaults are the engine's, mirrored by makePatch() until #656 shares them; the tunables are fmConstants.ts (#654) */
/**
 * Patch normalisation (#644): the editor and the game send partial patches,
 * and every field is filled here so the audio loop never tests for undefined.
 * Invariant: the defaults are the engine's — `patchNormalise.ts` on the main
 * thread and the console's knob tables read `makePatch()`, which mirrors
 * these (`patch.test.ts`). Only a `patch` message reaches here, never the
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
import { FILT_OFF, LFO_SINE, LOOP_NONE } from './modeIds';
import { WAVE } from './waveIds';

/** The patch the voice reads: every field filled, plus the per-operator feedback scratch. */
export interface WorkletPatch extends Patch {
  feedbackScratch: Float32Array;
}

/* ------------------------------------------------------------------ *
 * Patch normalisation
 *
 * The editor and the game send partial patches; fill in every field here so
 * the audio loop never has to test for undefined.
 * ------------------------------------------------------------------ */

function envDefaults(o: Partial<EnvelopeParams> | null | undefined): EnvelopeParams {
  o = o || {};
  return {
    initLevel: num(o.initLevel, 0),
    attackTime: num(o.attackTime, 0.002),
    attackCurve: num(o.attackCurve, 0),
    peakLevel: num(o.peakLevel, 1),
    decayTime: num(o.decayTime, 0.4),
    decayCurve: num(o.decayCurve, 0.5),
    sustainLevel: num(o.sustainLevel, 0.7),
    releaseTime: num(o.releaseTime, 0.3),
    releaseCurve: num(o.releaseCurve, 0.5),
    endLevel: num(o.endLevel, 0),
    loopMode: num(o.loopMode, LOOP_NONE) | 0,
    keyScale: num(o.keyScale, 0),
  };
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function opDefaults(o: PartialOperator | null | undefined, index: number): Operator {
  o = o || {};
  return {
    wave: num(o.wave, WAVE.SINE) | 0,
    userPartials: o.userPartials || null,
    userKey: o.userKey || '',
    ratio: num(o.ratio, 1),
    fixed: !!o.fixed,
    fixedHz: num(o.fixedHz, 100),
    detune: num(o.detune, 0), // cents
    level: num(o.level, index === 0 ? 1 : 0),
    feedback: Math.max(-1, Math.min(1, num(o.feedback, 0))), // bipolar (#529)
    velSens: num(o.velSens, 0.4),
    levelKeyScale: num(o.levelKeyScale, 0),
    phase: num(o.phase, 0),
    phaseFree: o.phaseFree !== false, // free-running by default
    env: envDefaults(o.env),
  };
}

function normalisePatch(raw: PartialPatch | null | undefined): WorkletPatch {
  raw = raw || {};
  const ops: Operator[] = [];
  for (let i = 0; i < 4; i++) ops.push(opDefaults(raw.ops && raw.ops[i], i));

  const lfoRaw: Partial<LfoSettings> = raw.lfo || {};
  const filtRaw = raw.filter || {};

  const p = {
    name: raw.name || 'untitled',
    algorithm: Math.max(0, Math.min(ALGORITHMS.length - 1, num(raw.algorithm, 0) | 0)),
    volume: num(raw.volume, 0.8),
    tone: Math.max(0.02, Math.min(1, num(raw.tone, 1))),
    glide: num(raw.glide, 0),
    pitchEnv: envDefaults(raw.pitchEnv),
    pitchEnvAmount: num(raw.pitchEnvAmount, 0), // semitones
    pan: num(raw.pan, 0),
    panRandom: num(raw.panRandom, 0),
    panKey: num(raw.panKey, 0),
    spread: num(raw.spread, 0), // cents; >0 doubles voices
    mono: !!raw.mono, // one note at a time, with retrigger (#453)
    ops,
    lfo: {
      shape: num(lfoRaw.shape, LFO_SINE) | 0,
      rate: num(lfoRaw.rate, 5),
      amount: num(lfoRaw.amount, 0),
      delay: num(lfoRaw.delay, 0),
      retrigger: !!lfoRaw.retrigger,
      toPitch: num(lfoRaw.toPitch, 0), // semitones
      modWheelDepth: num(lfoRaw.modWheelDepth, 1),
      toOp: [
        num(lfoRaw.toOp && lfoRaw.toOp[0], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[1], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[2], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[3], 0),
      ],
    },
    filter: {
      mode: num(filtRaw.mode, FILT_OFF) | 0,
      cutoff: num(filtRaw.cutoff, 8000),
      resonance: num(filtRaw.resonance, 0.707),
      drive: num(filtRaw.drive, 1),
      slope24: !!filtRaw.slope24,
      envAmount: num(filtRaw.envAmount, 0), // octaves
      modWheelDepth: num(filtRaw.modWheelDepth, 0), // octaves the wheel adds to envAmount (#586)
      lfoAmount: num(filtRaw.lfoAmount, 0), // octaves
      keyTrack: num(filtRaw.keyTrack, 0),
      env: envDefaults(filtRaw.env),
    },
  } satisfies Patch as WorkletPatch;

  p.feedbackScratch = new Float32Array(4);
  for (let i = 0; i < 4; i++) p.feedbackScratch[i] = ops[i].feedback;
  return p;
}

export { num, normalisePatch };
