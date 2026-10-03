/**
 * The Parts tab's knob ranges against the automation catalog (windsor#436,
 * record `2026-10-02-knob-ranges-from-the-catalog`): a knob over a voice
 * target takes its range from the target's catalog row, every voice target
 * has its knob, and every knob's range is pinned to what it was before the
 * ranges moved to the catalog, so a deliberate one-off change fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  STRIP_AUTOMATION_ROWS,
  VOICE_AUTOMATION_ROWS,
  catalogRow,
  requireCatalogRow,
  voiceTargetId,
} from '@windsor/engine';
import { knobRangeOf, voiceKnobRange } from './patchKnobRange';
import { allPatchKnobs } from './patchKnobTables';

describe('knobRangeOf', () => {
  it('reads a linear row as a linear knob over its bounds', () => {
    expect(knobRangeOf(requireCatalogRow('voice.filter.envAmount'))).toEqual({ min: -6, max: 6 });
  });

  it('reads any other scale as a log knob, octaves and log alike', () => {
    expect(knobRangeOf(requireCatalogRow('voice.filter.cutoff'))).toEqual({
      min: 30,
      max: 18000,
      curve: 'log',
    });
    expect(knobRangeOf(requireCatalogRow('voice.filter.resonance'))).toEqual({
      min: 0.5,
      max: 12,
      curve: 'log',
    });
  });

  it("takes a zero-end row's floor as the log knob's floor", () => {
    expect(knobRangeOf(requireCatalogRow('voice.ops.2.env.decayTime'))).toEqual({
      min: 0,
      max: 20,
      curve: 'log',
      logFloor: 0.001,
    });
  });

  it('reads a strip row too', () => {
    expect(knobRangeOf(STRIP_AUTOMATION_ROWS[1]!)).toEqual({ min: -1, max: 1 });
  });
});

describe('voiceKnobRange', () => {
  it("is the catalog row's range at the path", () => {
    expect(voiceKnobRange('lfo2.rate')).toEqual(knobRangeOf(requireCatalogRow('voice.lfo2.rate')));
  });
});

describe('the Parts tab knobs over voice targets', () => {
  const knobs = new Map(allPatchKnobs().map((knob) => [knob.path, knob.entry.o]));

  it('cover every voice target but the macros, whose knobs are the Macros card’s (windsor#558)', () => {
    for (const row of VOICE_AUTOMATION_ROWS) {
      expect(knobs.has(row.path), row.path).toBe(row.section.kind !== 'macro');
    }
  });

  it("take each one's own catalog row, on every operator and envelope slot", () => {
    for (const [path, o] of knobs) {
      const row = catalogRow(voiceTargetId(path));
      if (!row) continue;
      const { min, max, curve, logFloor } = o;
      expect({ min, max, curve, logFloor }, path).toEqual({
        curve: undefined,
        logFloor: undefined,
        ...knobRangeOf(row),
      });
    }
  });
});

/** A pinned range: the path, min and max, then the curve and the log floor where it has them. */
type PinnedRange = readonly [string, number, number, 'log'?, number?];

/** Every knob's range before windsor#436, in `allPatchKnobs()` order. */
const PINNED: readonly PinnedRange[] = [
  ['volume', 0, 1.5],
  ['tone', 0.02, 1],
  ['glide', 0, 2, 'log'],
  ['spread', 0, 50],
  ['pan', -1, 1],
  ['panRandom', 0, 1],
  ['drive.gain', 1, 16, 'log'],
  ['drive.bias', -1, 1],
  ['drive.tone', 0, 1],
  ['filter.cutoff', 30, 18000, 'log'],
  ['filter.resonance', 0.5, 12, 'log'],
  ['filter.vowel', 0, 4],
  ['filter.envAmount', -6, 6],
  ['filter.modWheelDepth', -6, 6],
  ['filter.lfoAmount', -4, 4],
  ['filter.lfo2Amount', -4, 4],
  ['filter.keyTrack', -1, 2],
  ['lfo.rate', 0.02, 40, 'log'],
  ['lfo.amount', 0, 1],
  ['lfo.modWheelDepth', 0, 1],
  ['lfo.delay', 0, 6, 'log'],
  ['lfo.toPitch', 0, 12],
  ['lfo.toOp.0', -1, 1],
  ['lfo.toOp.1', -1, 1],
  ['lfo.toOp.2', -1, 1],
  ['lfo.toOp.3', -1, 1],
  ['lfo.toWidth.0', -1, 1],
  ['lfo.toWidth.1', -1, 1],
  ['lfo.toWidth.2', -1, 1],
  ['lfo.toWidth.3', -1, 1],
  ['lfo2.rate', 0.02, 40, 'log'],
  ['lfo2.amount', 0, 1],
  ['lfo2.modWheelDepth', 0, 1],
  ['lfo2.delay', 0, 6, 'log'],
  ['lfo2.toPitch', 0, 12],
  ['lfo2.toOp.0', -1, 1],
  ['lfo2.toOp.1', -1, 1],
  ['lfo2.toOp.2', -1, 1],
  ['lfo2.toOp.3', -1, 1],
  ['lfo2.toWidth.0', -1, 1],
  ['lfo2.toWidth.1', -1, 1],
  ['lfo2.toWidth.2', -1, 1],
  ['lfo2.toWidth.3', -1, 1],
  ['pitchEnvAmount', -48, 48],
  ['ops.0.fixedHz', 1, 8000, 'log'],
  ['ops.0.detune', -100, 100],
  ['ops.0.level', 0, 1],
  ['ops.0.feedback', -1, 1],
  ['ops.0.width', 0.05, 1],
  ['ops.0.velSens', 0, 1],
  ['ops.0.noiseLp', 0, 20000, 'log', 20],
  ['ops.0.noiseHp', 0, 20000, 'log', 20],
  ['ops.0.phase', 0, 1],
  ['ops.1.fixedHz', 1, 8000, 'log'],
  ['ops.1.detune', -100, 100],
  ['ops.1.level', 0, 1],
  ['ops.1.feedback', -1, 1],
  ['ops.1.width', 0.05, 1],
  ['ops.1.velSens', 0, 1],
  ['ops.1.noiseLp', 0, 20000, 'log', 20],
  ['ops.1.noiseHp', 0, 20000, 'log', 20],
  ['ops.1.phase', 0, 1],
  ['ops.2.fixedHz', 1, 8000, 'log'],
  ['ops.2.detune', -100, 100],
  ['ops.2.level', 0, 1],
  ['ops.2.feedback', -1, 1],
  ['ops.2.width', 0.05, 1],
  ['ops.2.velSens', 0, 1],
  ['ops.2.noiseLp', 0, 20000, 'log', 20],
  ['ops.2.noiseHp', 0, 20000, 'log', 20],
  ['ops.2.phase', 0, 1],
  ['ops.3.fixedHz', 1, 8000, 'log'],
  ['ops.3.detune', -100, 100],
  ['ops.3.level', 0, 1],
  ['ops.3.feedback', -1, 1],
  ['ops.3.width', 0.05, 1],
  ['ops.3.velSens', 0, 1],
  ['ops.3.noiseLp', 0, 20000, 'log', 20],
  ['ops.3.noiseHp', 0, 20000, 'log', 20],
  ['ops.3.phase', 0, 1],
  ['ops.0.env.attackTime', 0, 12, 'log', 0.0005],
  ['ops.0.env.decayTime', 0, 20, 'log', 0.001],
  ['ops.0.env.sustainLevel', 0, 1],
  ['ops.0.env.releaseTime', 0.001, 20, 'log'],
  ['ops.0.env.initLevel', 0, 1],
  ['ops.0.env.peakLevel', 0, 1],
  ['ops.0.env.endLevel', 0, 1],
  ['ops.0.env.attackCurve', -1, 1],
  ['ops.0.env.decayCurve', -1, 1],
  ['ops.0.env.releaseCurve', -1, 1],
  ['ops.0.env.keyScale', -1, 1],
  ['ops.1.env.attackTime', 0, 12, 'log', 0.0005],
  ['ops.1.env.decayTime', 0, 20, 'log', 0.001],
  ['ops.1.env.sustainLevel', 0, 1],
  ['ops.1.env.releaseTime', 0.001, 20, 'log'],
  ['ops.1.env.initLevel', 0, 1],
  ['ops.1.env.peakLevel', 0, 1],
  ['ops.1.env.endLevel', 0, 1],
  ['ops.1.env.attackCurve', -1, 1],
  ['ops.1.env.decayCurve', -1, 1],
  ['ops.1.env.releaseCurve', -1, 1],
  ['ops.1.env.keyScale', -1, 1],
  ['ops.2.env.attackTime', 0, 12, 'log', 0.0005],
  ['ops.2.env.decayTime', 0, 20, 'log', 0.001],
  ['ops.2.env.sustainLevel', 0, 1],
  ['ops.2.env.releaseTime', 0.001, 20, 'log'],
  ['ops.2.env.initLevel', 0, 1],
  ['ops.2.env.peakLevel', 0, 1],
  ['ops.2.env.endLevel', 0, 1],
  ['ops.2.env.attackCurve', -1, 1],
  ['ops.2.env.decayCurve', -1, 1],
  ['ops.2.env.releaseCurve', -1, 1],
  ['ops.2.env.keyScale', -1, 1],
  ['ops.3.env.attackTime', 0, 12, 'log', 0.0005],
  ['ops.3.env.decayTime', 0, 20, 'log', 0.001],
  ['ops.3.env.sustainLevel', 0, 1],
  ['ops.3.env.releaseTime', 0.001, 20, 'log'],
  ['ops.3.env.initLevel', 0, 1],
  ['ops.3.env.peakLevel', 0, 1],
  ['ops.3.env.endLevel', 0, 1],
  ['ops.3.env.attackCurve', -1, 1],
  ['ops.3.env.decayCurve', -1, 1],
  ['ops.3.env.releaseCurve', -1, 1],
  ['ops.3.env.keyScale', -1, 1],
  ['filter.env.attackTime', 0, 12, 'log', 0.0005],
  ['filter.env.decayTime', 0, 20, 'log', 0.001],
  ['filter.env.sustainLevel', 0, 1],
  ['filter.env.releaseTime', 0.001, 20, 'log'],
  ['filter.env.initLevel', 0, 1],
  ['filter.env.peakLevel', 0, 1],
  ['filter.env.endLevel', 0, 1],
  ['filter.env.attackCurve', -1, 1],
  ['filter.env.decayCurve', -1, 1],
  ['filter.env.releaseCurve', -1, 1],
  ['filter.env.keyScale', -1, 1],
  ['pitchEnv.attackTime', 0, 12, 'log', 0.0005],
  ['pitchEnv.decayTime', 0, 20, 'log', 0.001],
  ['pitchEnv.sustainLevel', 0, 1],
  ['pitchEnv.releaseTime', 0.001, 20, 'log'],
  ['pitchEnv.initLevel', 0, 1],
  ['pitchEnv.peakLevel', 0, 1],
  ['pitchEnv.endLevel', 0, 1],
  ['pitchEnv.attackCurve', -1, 1],
  ['pitchEnv.decayCurve', -1, 1],
  ['pitchEnv.releaseCurve', -1, 1],
];

describe('every patch knob range', () => {
  it('is unchanged by windsor#436', () => {
    const ranges = allPatchKnobs().map(({ path, entry: { o } }) => {
      const tail = o.logFloor !== undefined ? [o.curve, o.logFloor] : o.curve ? [o.curve] : [];
      return [path, o.min, o.max, ...tail];
    });
    expect(ranges).toEqual(PINNED);
  });
});
