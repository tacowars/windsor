/**
 * What a mapping plays (windsor#566): each curve worked by hand from record
 * `2026-10-04-patch-macro-knobs` decision 4, a ratio end below the floor
 * raised to it, and the scalar held to the voice's own in-place arithmetic
 * (`voiceMacros.ts`) over a sweep.
 */
import { describe, expect, it } from 'vitest';

import type { MacroMapping } from '../../patch/patch';
import { MACRO_CURVE, makeMacroMapping } from '../../patch/patch';
import { macroMappedValue } from './macroShape';
import type { VoiceTargetPath, VoiceTargetRow } from './voiceTargetTables';
import {
  VOICE_TARGET_COUNT,
  VT_MACRO_BASE,
  voiceTargetCode,
  voiceTargetRow,
} from './voiceTargetTables';

// `patchNormalise` reaches the wave cache, which reads the scope's sample rate at load.
Object.assign(globalThis, { sampleRate: 48000 });
const { compileMacros, applyMacroBases } = await import('./voiceMacros');
const { normalisePatch } = await import('./patchNormalise');

const row = (path: VoiceTargetPath): VoiceTargetRow => voiceTargetRow(path)!;
const NO_PUSH = new Float64Array(VOICE_TARGET_COUNT);

/** What the voice writes for `mapping` with its macro at `x`. */
function voicePlays(mapping: MacroMapping, x: number): number {
  const values = new Float64Array(VOICE_TARGET_COUNT);
  values[VT_MACRO_BASE] = x;
  const patch = compileMacros(normalisePatch({ macros: [{ mappings: [mapping] }] }));
  applyMacroBases(patch, values, values, NO_PUSH);
  return values[voiceTargetCode(mapping.target)]!;
}

/** Rows the pin sweeps: two add rows, a ratio row, and a ratio row mapped up from below its floor. */
const PIN_ROWS: readonly (readonly [VoiceTargetPath, number, number])[] = [
  ['ops.0.level', 0.4, 0.9],
  ['lfo2.amount', 0, 0.6],
  ['filter.cutoff', 400, 3200],
  ['ops.1.env.decayTime', 0, 1.2],
];

describe('macroMappedValue', () => {
  it('shapes the travel: Linear, Exp x³, Log 1 − (1 − x)³, S x²(3 − 2x), inverted first', () => {
    const level = (curve: number, inverted = false): MacroMapping =>
      makeMacroMapping({ target: 'ops.0.level', min: 0, max: 1, curve, inverted });
    const at = (m: MacroMapping, x: number): number => macroMappedValue(row('ops.0.level'), m, x);
    expect([0, 1, 2, 3].map((c) => at(level(c), 0.5))).toEqual([0.5, 0.125, 0.875, 0.5]);
    expect(at(level(MACRO_CURVE.EXP, true), 0.25)).toBeCloseTo(0.421875, 12);
  });

  it('sweeps a ratio row in octaves and raises an end below its floor to it', () => {
    const cutoff = makeMacroMapping({ target: 'filter.cutoff', min: 200, max: 3200 });
    expect(macroMappedValue(row('filter.cutoff'), cutoff, 0.5)).toBeCloseTo(800, 9);
    const decay = makeMacroMapping({ target: 'ops.1.env.decayTime', min: 0, max: 1 });
    const decayRow = row('ops.1.env.decayTime');
    expect(macroMappedValue(decayRow, decay, 0)).toBe(decayRow.floor);
  });

  it('plays what the voice plays: every curve, both polarities', () => {
    for (const [target, min, max] of PIN_ROWS) {
      for (const curve of [0, 1, 2, 3]) {
        for (const inverted of [false, true]) {
          const m = makeMacroMapping({ target, min, max, curve, inverted });
          for (const x of [0, 0.25, 0.35, 0.5, 0.62, 1]) {
            const want = voicePlays(m, x);
            const got = macroMappedValue(row(target), m, x);
            expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want)));
          }
        }
      }
    }
  });
});
