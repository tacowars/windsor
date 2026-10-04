/**
 * The Macros card's rules (windsor#561): the list edits, the picker, and what
 * a mapping plays, pinned to the mockup's readouts worked by hand from record
 * `2026-10-04-patch-macro-knobs` decision 4. The engine's `macroShape.test.ts`
 * holds the shaping to the voice's (windsor#566).
 */
import { describe, expect, it } from 'vitest';
import {
  MACRO_CURVE,
  MACRO_CURVE_NAMES,
  MACRO_MAPPINGS_MAX,
  MACROS_MAX,
  makeMacro,
  type Macro,
  type VoiceTargetPath,
  voiceTargetRow,
} from '@windsor/engine';
import {
  addMacro,
  addMapping,
  canAddMacro,
  canAddMapping,
  floorSeedNote,
  mappedKnob,
  macroTileNames,
  mappingPickerGroups,
  mappingPlays,
  nextMacroName,
  removeMacro,
  removeMapping,
  renameMacro,
  setMacroValue,
  setMappingField,
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

const plays = (macro: Macro, at: number): number | undefined =>
  mappingPlays(macro.mappings[at]!, macro.value);

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

  it('starts a decay at 0 at its floor, which it plays at every macro value', () => {
    const floor = voiceTargetRow('ops.0.env.decayTime')!.floor;
    expect(floor).toBeGreaterThan(0);
    const next = addMapping([makeMacro()], 0, 'ops.0.env.decayTime', 0);
    const mapping = next[0]!.mappings[0]!;
    expect([mapping.min, mapping.max]).toEqual([floor, floor]);
    for (const x of [0, 0.5, 1]) expect(mappingPlays(mapping, x)).toBeCloseTo(floor, 12);
    const above = addMapping([makeMacro()], 0, 'ops.0.env.decayTime', 0.4)[0]!.mappings[0]!;
    expect([above.min, above.max]).toEqual([0.4, 0.4]);
    expect(floorSeedNote('ops.0.env.decayTime', 0)).toBe(
      'Op A Decay is at 0, which a macro cannot reach; the mapping starts at 1 ms.',
    );
    expect(floorSeedNote('ops.0.env.decayTime', 0.4)).toBeUndefined();
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

describe('what a mapping plays (record decision 4)', () => {
  it('plays the mockup’s values: linear on an add row, in octaves on a ratio row', () => {
    expect(plays(ACCENT, 0)).toBeCloseTo(0.575, 12);
    expect(plays(ACCENT, 1)).toBeCloseTo(437.3, 1);
    expect(plays(ACCENT, 2)).toBeCloseTo(0.0851, 4);
    expect(plays(WOBBLE, 0)).toBeCloseTo(0.4059, 4);
    expect(plays(WOBBLE, 1)).toBeCloseTo(1.0876, 4);
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
