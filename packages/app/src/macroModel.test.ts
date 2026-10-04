/**
 * The Macros card's rules (windsor#561): the list edits, the picker, and the
 * shaping arithmetic, pinned to values worked by hand from record
 * `2026-10-04-patch-macro-knobs` decision 4 (the mockup's readouts) and to
 * the voice's own shaping (windsor#560) over a sweep.
 */
import { describe, expect, it } from 'vitest';
import {
  MACRO_CURVE,
  MACRO_CURVE_NAMES,
  MACRO_MAPPINGS_MAX,
  MACROS_MAX,
  VOICE_TARGET_COUNT,
  VOICE_TARGET_PATHS,
  VT_MACRO_BASE,
  makeMacro,
  makeMacroMapping,
  voiceTargetRow,
  type Macro,
  type MacroMapping,
  type VoiceTargetPath,
} from '@windsor/engine';
import {
  addMacro,
  addMapping,
  canAddMacro,
  canAddMapping,
  mappedKnob,
  macroTileNames,
  mappedValue,
  mappingPickerGroups,
  nextMacroName,
  removeMacro,
  removeMapping,
  renameMacro,
  setMacroValue,
  setMappingField,
  shapeMacro,
} from './macroModel';
import { CURVE_GLYPH_PATHS, CURVE_SEGMENT_LABELS } from './macroTables';

const ACCENT = makeMacro({
  name: 'Accent',
  value: 0.35,
  mappings: [
    { target: 'ops.0.level', min: 0.4, max: 0.9 },
    { target: 'filter.cutoff', min: 400, max: 3200, curve: MACRO_CURVE.EXP },
    { target: 'ops.0.env.decayTime', min: 0.045, max: 0.12, inverted: true },
  ],
});
const WOBBLE = makeMacro({
  name: 'Wobble',
  value: 0.62,
  mappings: [
    { target: 'lfo2.amount', min: 0, max: 0.6, curve: MACRO_CURVE.S },
    { target: 'filter.env.decayTime', min: 0.2, max: 1.2, curve: MACRO_CURVE.LOG },
  ],
});
const MACROS: readonly Macro[] = [ACCENT, WOBBLE];

/** The two calls of the voice's `voiceMacros.ts` this test pins the app's copy to. */
interface VoiceMacros {
  compileMacros(patch: { macros: readonly Macro[] }): unknown;
  applyMacroBases(patch: unknown, src: Float64Array, dst: Float64Array, push: Float64Array): void;
}
const NO_PUSH = new Float64Array(VOICE_TARGET_COUNT);

/** Rows the pin sweeps: an add row, a ratio row, and a ratio row mapped up from below its floor. */
const PIN_ROWS: readonly (readonly [VoiceTargetPath, number, number])[] = [
  ['ops.0.level', 0.4, 0.9],
  ['lfo2.amount', 0, 0.6],
  ['filter.cutoff', 400, 3200],
  ['ops.1.env.decayTime', 0, 1.2],
];

const plays = (macro: Macro, at: number): number => {
  const m = macro.mappings[at]!;
  return mappedValue(m, macro.value, voiceTargetRow(m.target)!);
};

describe('the macro list', () => {
  it('adds `Macro <n>` at value 0 until eight, at the lowest free number', () => {
    let macros: Macro[] = [];
    for (let i = 0; i < MACROS_MAX + 1; i++) macros = addMacro(macros);
    expect(macros).toHaveLength(MACROS_MAX);
    expect(canAddMacro(macros)).toBe(false);
    expect(macros[2]).toEqual({ name: 'Macro 3', value: 0, mappings: [] });
    expect(nextMacroName(removeMacro(macros, 1))).toBe('Macro 2');
    expect(nextMacroName([ACCENT])).toBe('Macro 2');
  });

  it('renames, sets a value and removes, leaving the input untouched', () => {
    expect(renameMacro(MACROS, 0, '  Bite ')[0]?.name).toBe('Bite');
    expect(renameMacro(MACROS, 0, '   ')[0]?.name).toBe('Accent');
    // The tile's knob and remove button announce the new name, not the old one.
    const bite = renameMacro(MACROS, 0, 'Bite')[0];
    expect(bite && macroTileNames(bite, 0)).toEqual({ knob: 'Bite', remove: 'Remove macro Bite' });
    expect(setMacroValue(MACROS, 1, 0.1)[1]?.value).toBe(0.1);
    expect(removeMacro(MACROS, 0)).toEqual([WOBBLE]);
    expect(MACROS[0]).toBe(ACCENT);
  });
});

describe('a mapping', () => {
  it('starts at the target’s current value, Linear, not inverted', () => {
    const next = addMapping(MACROS, 1, 'filter.resonance', 0.71);
    expect(next[1]?.mappings[2]).toEqual({
      target: 'filter.resonance',
      min: 0.71,
      max: 0.71,
      curve: MACRO_CURVE.LINEAR,
      inverted: false,
    });
    expect(plays(next[1]!, 2)).toBeCloseTo(0.71, 12);
  });

  it('is refused on a mapped target, a macro row, or a full macro', () => {
    expect(addMapping(MACROS, 1, 'filter.cutoff', 1000)).toEqual(MACROS);
    expect(addMapping(MACROS, 1, 'macros.0.value' as VoiceTargetPath, 0)).toEqual(MACROS);
    const full = makeMacro({
      mappings: ['ops.1.level', 'ops.2.level', 'ops.3.level', 'ops.1.width', 'ops.2.width']
        .concat(['ops.3.width', 'ops.1.feedback', 'ops.2.feedback'])
        .map((target) => ({ target: target as VoiceTargetPath })),
    });
    expect(full.mappings).toHaveLength(MACRO_MAPPINGS_MAX);
    expect(canAddMapping([full], 0)).toBe(false);
    expect(addMapping([full], 0, 'lfo.rate', 5)).toEqual([full]);
  });

  it('sets a field and is removed', () => {
    expect(setMappingField(MACROS, 0, 1, 'inverted', true)[0]?.mappings[1]?.inverted).toBe(true);
    expect(setMappingField(MACROS, 0, 1, 'max', 5000)[0]?.mappings[1]?.max).toBe(5000);
    expect(removeMapping(MACROS, 0, 0)[0]?.mappings.map((m) => m.target)).toEqual([
      'filter.cutoff',
      'ops.0.env.decayTime',
    ]);
  });
});

describe('the target picker', () => {
  const groups = mappingPickerGroups(MACROS);

  it('lists the voice’s groups without the macros', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Filter',
      'Op A',
      'Op B',
      'Op C',
      'Op D',
      'LFO',
      'Pitch',
    ]);
    const opA = groups.find((g) => g.label === 'Op A')!;
    expect(opA.options.map((o) => o.label)).toEqual(['Level', 'Decay', 'Dcy Crv', 'Fdbk', 'Width']);
  });

  it('names the macro holding each mapped target', () => {
    const taken = groups.flatMap((g) => g.options).filter((o) => o.takenBy);
    expect(taken.map((o) => [o.path, o.takenBy])).toEqual([
      ['filter.cutoff', 'Accent'],
      ['filter.env.decayTime', 'Wobble'],
      ['ops.0.level', 'Accent'],
      ['ops.0.env.decayTime', 'Accent'],
      ['lfo2.amount', 'Wobble'],
    ]);
  });
});

describe('the shaping (record decision 4)', () => {
  it('shapes the travel: Linear, Exp x³, Log 1 − (1 − x)³, S x²(3 − 2x), inverted first', () => {
    expect([0, 1, 2, 3].map((c) => shapeMacro(0.5, c, false))).toEqual([0.5, 0.125, 0.875, 0.5]);
    expect(shapeMacro(0.25, MACRO_CURVE.EXP, true)).toBeCloseTo(0.421875, 12);
    expect(shapeMacro(1.5, MACRO_CURVE.LINEAR, false)).toBe(1);
  });

  it('plays the mockup’s values: linear on an add row, in octaves on a ratio row', () => {
    expect(plays(ACCENT, 0)).toBeCloseTo(0.575, 12);
    expect(plays(ACCENT, 1)).toBeCloseTo(437.3, 1);
    expect(plays(ACCENT, 2)).toBeCloseTo(0.0851, 4);
    expect(plays(WOBBLE, 0)).toBeCloseTo(0.4059, 4);
    expect(plays(WOBBLE, 1)).toBeCloseTo(1.0876, 4);
  });

  it('raises a ratio row’s end to its floor: a decay mapped from 0 plays 1 ms at the bottom', () => {
    const decay = makeMacro({ mappings: [{ target: 'ops.1.env.decayTime', min: 0, max: 1 }] });
    expect(plays(decay, 0)).toBe(voiceTargetRow('ops.1.env.decayTime')!.floor);
  });

  it('plays what the voice plays: the engine’s own shaping, every curve, both polarities', async () => {
    // The voice's shaping (windsor#560) compiles only under the worklet's own
    // flags, so it cannot ride the engine's index; a runtime import reaches
    // it here without pulling it into the app's type check.
    const at = '@windsor/engine/worklet/fm/voiceMacros';
    const voice = (await import(/* @vite-ignore */ at)) as VoiceMacros;
    const voicePlays = (mapping: MacroMapping, x: number): number => {
      const values = new Float64Array(VOICE_TARGET_COUNT);
      values[VT_MACRO_BASE] = x;
      const macro = { name: '', value: 0, mappings: [mapping] };
      voice.applyMacroBases(voice.compileMacros({ macros: [macro] }), values, values, NO_PUSH);
      return values[VOICE_TARGET_PATHS.indexOf(mapping.target)] ?? NaN;
    };
    for (const [target, min, max] of PIN_ROWS) {
      for (const curve of [0, 1, 2, 3]) {
        for (const inverted of [false, true]) {
          const m = makeMacroMapping({ target, min, max, curve, inverted });
          for (const x of [0, 0.25, 0.35, 0.5, 0.62, 1]) {
            const want = voicePlays(m, x);
            const got = mappedValue(m, x, voiceTargetRow(target)!);
            expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(want)));
          }
        }
      }
    }
  });

  it('finds the mapped knob by path, at a lane’s value where one holds the macro', () => {
    expect(mappedKnob(MACROS, 'lfo2.amount')).toEqual({ macro: 'Wobble', value: plays(WOBBLE, 0) });
    expect(mappedKnob(MACROS, 'lfo2.amount', () => 0)?.value).toBe(0);
    expect(mappedKnob(MACROS, 'lfo.amount')).toBeUndefined();
  });
});

it('gives every curve a segment label and a glyph', () => {
  expect(MACRO_CURVE_NAMES.map((name) => CURVE_SEGMENT_LABELS[name])).toEqual([
    'Lin',
    'Exp',
    'Log',
    'S',
  ]);
  for (const name of MACRO_CURVE_NAMES) expect(CURVE_GLYPH_PATHS[name]).toMatch(/^M/);
});
