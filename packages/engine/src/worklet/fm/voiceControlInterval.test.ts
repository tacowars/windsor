/**
 * Each voice's control interval from its state (windsor#326): every clause
 * of the rule, and both edges of each threshold. The voice is the fields the
 * rule reads, over real envelopes and a normalised patch, so no wave table
 * is warmed.
 */
import { describe, expect, it } from 'vitest';

import type { Voice } from './voice';
import { Envelope, ST_ATTACK, ST_DECAY, ST_DONE, ST_RELEASE, ST_SUSTAIN } from './envelope';
import { CTRL_INTERVAL, CTRL_INTERVAL_LONG } from './fmConstants';
import {
  FILT_LP,
  FILT_OFF,
  LFO_DRIFT,
  LFO_SAW_DOWN,
  LFO_SAW_UP,
  LFO_SH,
  LFO_SINE,
  LFO_SQUARE,
  LFO_TRI,
  LOOP_LOOP,
  LOOP_TRIGGER,
} from './modeIds';
import { makeMacro } from '../../patch/patch';
import { normalisePatch } from './patchNormalise';
import { compileMacros } from './voiceMacros';
import { CONTROL_INTERVALS, controlInterval, controlIntervalTable } from './voiceControlInterval';
import {
  VOICE_TARGET_COUNT,
  VT_MACRO_BASE,
  VT_OP_BASE,
  VT_OP_RATIO,
  VT_OP_STRIDE,
} from './voiceTargetTables';
import { layoutVoiceTargets } from './voiceTargets';

const SR = 48000;
const FINE = CTRL_INTERVAL;
const LONG = CTRL_INTERVAL_LONG;
/** Either side of the 0.1 s floor. */
const SHORT_S = 0.099;
const FLOOR_S = 0.1;
const SLOW = { attackTime: 2, decayTime: 2, releaseTime: 2 };

type PatchInput = Parameters<typeof normalisePatch>[0];

/**
 * The fields `controlInterval` reads, over `patch`: every envelope in its
 * sustain, no glide, and the synced bits the bind sets from the ops' `sync`.
 */
function voiceOf({ op, ...input }: Record<string, unknown> = {}): Voice {
  const patch = normalisePatch({
    ...input,
    ops: [0, 1, 2, 3].map(() => ({ env: SLOW, ...(op as object) })),
  } as PatchInput);
  const envelope = (params: (typeof patch.ops)[number]['env']): Envelope => {
    const env = new Envelope();
    env.configure(params, SR);
    env.noteOn();
    env.state = ST_SUSTAIN;
    return env;
  };
  const liveValues = new Float64Array(VOICE_TARGET_COUNT);
  layoutVoiceTargets(patch, liveValues);
  const synced = patch.ops.reduce((bits, o, i) => (o.sync === 'off' ? bits : bits | (1 << i)), 0);
  return {
    patch,
    liveValues,
    sync: { synced },
    partOffsets: new Float64Array(VOICE_TARGET_COUNT),
    fbRamp: 0,
    ampEnv: patch.ops.map((op) => envelope(op.env)),
    pitchEnv: envelope(patch.pitchEnv),
    filtEnv: envelope(patch.filter.env),
    pitchCur: 60,
    pitchTarget: 60,
    glideSeconds: 0,
    lfo: { rate: patch.lfo.rate },
    lfo2: { rate: patch.lfo2.rate },
  } as unknown as Voice;
}

/** `env` in `state`, the segment's time `seconds` before key scaling. */
function inSegment(env: Envelope, state: number, seconds: number, timeScale = 1): void {
  const p = { ...env.p!, attackTime: seconds, releaseTime: seconds, decayTime: seconds };
  env.configure(p, SR);
  env.state = state;
  env.timeScale = timeScale;
}

describe('controlInterval (windsor#326)', () => {
  it('reads long for a voice in sustain with no LFO, and with every envelope done', () => {
    const voice = voiceOf();
    expect(controlInterval(voice)).toBe(LONG);
    for (const env of [...voice.ampEnv, voice.pitchEnv, voice.filtEnv]) env.state = ST_DONE;
    expect(controlInterval(voice)).toBe(LONG);
  });

  it.each([
    ['attack', ST_ATTACK],
    ['decay', ST_DECAY],
    ['release', ST_RELEASE],
  ])('reads fine for an operator %s under 0.1 s and long at 0.1 s', (_name, state) => {
    for (const op of [0, 3]) {
      const voice = voiceOf();
      inSegment(voice.ampEnv[op]!, state, SHORT_S);
      expect(controlInterval(voice)).toBe(FINE);
      inSegment(voice.ampEnv[op]!, state, FLOOR_S);
      expect(controlInterval(voice)).toBe(LONG);
    }
  });

  it('times a segment after key scaling, and a reshaped decay by what is left of it', () => {
    const voice = voiceOf();
    inSegment(voice.ampEnv[1]!, ST_ATTACK, 0.4, 0.2);
    expect(controlInterval(voice)).toBe(FINE);
    inSegment(voice.ampEnv[1]!, ST_ATTACK, 0.04, 4);
    expect(controlInterval(voice)).toBe(LONG);
    inSegment(voice.ampEnv[1]!, ST_DECAY, 1);
    voice.ampEnv[1]!.decayLeft = 0.05;
    expect(controlInterval(voice)).toBe(FINE);
  });

  it('reads the pitch envelope only while its amount is not 0', () => {
    const quiet = voiceOf();
    inSegment(quiet.pitchEnv, ST_DECAY, SHORT_S);
    expect(controlInterval(quiet)).toBe(LONG);
    const swept = voiceOf({ pitchEnvAmount: 12 });
    inSegment(swept.pitchEnv, ST_DECAY, SHORT_S);
    expect(controlInterval(swept)).toBe(FINE);
    inSegment(swept.pitchEnv, ST_DECAY, FLOOR_S);
    expect(controlInterval(swept)).toBe(LONG);
  });

  it('reads the filter envelope only with the filter on and an amount or a wheel depth', () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ mode: FILT_OFF, envAmount: 2 }, LONG],
      [{ mode: FILT_LP, envAmount: 0 }, LONG],
      [{ mode: FILT_LP, envAmount: 2 }, FINE],
      [{ mode: FILT_LP, envAmount: 0, modWheelDepth: 1 }, FINE],
    ];
    for (const [filter, expected] of cases) {
      const voice = voiceOf({ filter });
      inSegment(voice.filtEnv, ST_RELEASE, SHORT_S);
      expect(controlInterval(voice), JSON.stringify(filter)).toBe(expected);
    }
  });

  it('reads fine for an amplitude envelope in Loop or Trigger mode until it is done', () => {
    for (const loopMode of [LOOP_LOOP, LOOP_TRIGGER]) {
      const voice = voiceOf({ op: { env: { ...SLOW, loopMode } } });
      inSegment(voice.ampEnv[2]!, ST_DECAY, 2);
      expect(controlInterval(voice)).toBe(FINE);
      for (const env of voice.ampEnv) env.state = ST_DONE;
      expect(controlInterval(voice)).toBe(LONG);
    }
  });

  it('reads fine for a glide under 0.1 s in progress, and long once it has arrived', () => {
    const voice = voiceOf({ glide: SHORT_S });
    voice.pitchCur = 55;
    expect(controlInterval(voice)).toBe(FINE);
    voice.pitchCur = voice.pitchTarget;
    expect(controlInterval(voice)).toBe(LONG);
    const slow = voiceOf({ glide: FLOOR_S });
    slow.pitchCur = 55;
    expect(controlInterval(slow)).toBe(LONG);
    // A slide's own time comes first (#602).
    slow.glideSeconds = 0.05;
    expect(controlInterval(slow)).toBe(FINE);
  });

  it.each([
    ['toPitch', { toPitch: 0.5 }, {}],
    ['an operator level', { toOp: [0, 0, 0.5, 0] }, {}],
    ['an operator width', { toWidth: [0, 0.5, 0, 0] }, {}],
    // An operator ratio (windsor#646) follows the LFO-on-pitch rule in a voice with no synced operator.
    ['an operator ratio', { toRatio: [0, 0, 0, 0.5] }, {}],
    ['the filter', {}, { mode: FILT_LP }],
  ])('reads fine for an LFO at 8 Hz on %s, and long at 7.99 Hz', (_name, target, filter) => {
    for (const second of [false, true]) {
      const lfo = { rate: 8, amount: 1, ...target };
      const filterAmount = second ? { lfo2Amount: 1 } : { lfoAmount: 1 };
      const voice = voiceOf({
        [second ? 'lfo2' : 'lfo']: lfo,
        filter: { ...filter, ...('mode' in filter ? filterAmount : {}) },
      });
      expect(controlInterval(voice)).toBe(FINE);
      (second ? voice.lfo2 : voice.lfo).rate = 7.99;
      expect(controlInterval(voice)).toBe(LONG);
    }
  });

  it('reads long for an LFO at 8 Hz that reaches nothing', () => {
    // No destination; then a destination with no depth; then the filter's depth with the filter off.
    expect(controlInterval(voiceOf({ lfo: { rate: 8, amount: 1 } }))).toBe(LONG);
    const deaf = { rate: 8, amount: 0, modWheelDepth: 0, toPitch: 1 };
    expect(controlInterval(voiceOf({ lfo: deaf, lfo2: deaf }))).toBe(LONG);
    const off = voiceOf({ lfo: { rate: 8, amount: 1 }, filter: { mode: FILT_OFF, lfoAmount: 1 } });
    expect(controlInterval(off)).toBe(LONG);
    // The wheel's depth alone is a depth.
    const wheel = voiceOf({ lfo: { rate: 8, amount: 0, modWheelDepth: 1, toPitch: 1 } });
    expect(controlInterval(wheel)).toBe(FINE);
  });

  it('reads fine for a slow LFO whose shape jumps, and long for a smooth one', () => {
    for (const shape of [LFO_SQUARE, LFO_SH, LFO_SAW_UP, LFO_SAW_DOWN]) {
      const slow = { shape, rate: 0.5, amount: 1, toOp: [1, 0, 0, 0] };
      expect(controlInterval(voiceOf({ lfo2: slow })), `shape ${shape}`).toBe(FINE);
      // A jump that reaches nothing is no transient.
      expect(controlInterval(voiceOf({ lfo2: { ...slow, toOp: [0, 0, 0, 0] } }))).toBe(LONG);
    }
    for (const shape of [LFO_SINE, LFO_TRI, LFO_DRIFT]) {
      const slow = { shape, rate: 0.5, amount: 1, toOp: [1, 0, 0, 0] };
      expect(controlInterval(voiceOf({ lfo: slow })), `shape ${shape}`).toBe(LONG);
    }
  });

  it('reads fine while a song lane ramps an operator feedback', () => {
    const voice = voiceOf();
    voice.fbRamp = 0b0100;
    expect(controlInterval(voice)).toBe(FINE);
  });

  // The fine interval for a ratio sweep is a synced voice's only (windsor#655,
  // record `2026-10-09-sync-direct-shape` decision 4): an unsynced one keeps
  // the LFO rule above.
  const SYNCED = { op: { sync: 'note' } };

  it('reads fine while a synced voice’s LFO ratio depth is not 0, at any rate, shape or amount (windsor#655)', () => {
    for (const second of [false, true]) {
      const lfo = second ? 'lfo2' : 'lfo';
      const slow = { shape: LFO_TRI, rate: 0.25, amount: 0, toRatio: [0, 0, 0, 0.5] };
      expect(controlInterval(voiceOf({ ...SYNCED, [lfo]: slow }))).toBe(FINE);
      expect(controlInterval(voiceOf({ [lfo]: slow })), 'unsynced').toBe(LONG);
      const none = { ...slow, amount: 1, toRatio: [0, 0, 0, 0] };
      expect(controlInterval(voiceOf({ ...SYNCED, [lfo]: none }))).toBe(LONG);
    }
  });

  it('reads fine while a song lane moves a synced voice’s ratio, directly or through a macro (windsor#655)', () => {
    const ratio = VT_OP_BASE + 2 * VT_OP_STRIDE + VT_OP_RATIO;
    const unsynced = voiceOf();
    unsynced.partOffsets[ratio] = 0.25;
    expect(controlInterval(unsynced), 'unsynced').toBe(LONG);
    const voice = voiceOf(SYNCED);
    voice.partOffsets[ratio] = 0.25;
    expect(controlInterval(voice)).toBe(FINE);
    voice.partOffsets[ratio] = 0;
    // A lane on another row of the operator is not one on its ratio.
    voice.partOffsets[ratio - 1] = 0.25;
    expect(controlInterval(voice)).toBe(LONG);
    for (const [target, interval] of [
      ['ops.1.ratio', FINE],
      ['ops.1.level', LONG],
    ] as const) {
      const mapped = voiceOf(SYNCED);
      mapped.patch = compileMacros(
        normalisePatch({
          ops: [0, 1, 2, 3].map(() => ({ env: SLOW, sync: 'note' })),
          macros: [makeMacro({ mappings: [{ target, min: 1, max: 4 }] })],
        } as PatchInput),
      );
      expect(controlInterval(mapped), target).toBe(LONG);
      mapped.partOffsets[VT_MACRO_BASE] = 0.1;
      expect(controlInterval(mapped), target).toBe(interval);
    }
  });

  it('takes its table: a long interval equal to the fine one, or another floor', () => {
    const voice = voiceOf();
    expect(controlInterval(voice, controlIntervalTable({ long: FINE }))).toBe(FINE);
    inSegment(voice.ampEnv[0]!, ST_ATTACK, 0.15);
    expect(controlInterval(voice, CONTROL_INTERVALS)).toBe(LONG);
    expect(controlInterval(voice, controlIntervalTable({ minSegmentSeconds: 0.2 }))).toBe(FINE);
    // The fine interval is the render loops' and no override moves it.
    expect(controlIntervalTable({ long: 64 }).fine).toBe(CTRL_INTERVAL);
  });
});
