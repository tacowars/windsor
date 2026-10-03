/**
 * A patch's macros (windsor#559, record `2026-10-04-patch-macro-knobs`
 * decisions 2, 5 and 9): `makePatch` completes them, a merge replaces the
 * list wholesale, the library loader checks them element by element and
 * refuses a mapping no macro may hold, and a song carries them through
 * export and import, reporting and dropping what the loader would refuse.
 * A patch with no `macros` loads as it did.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from '../song/arrangementDocument';
import { MACRO_CURVE, makePatch, mergePatch } from './patch';
import type { PartialMacro, Patch } from './patch';
import { PATCH_FILE_FORMAT, loadPatchFile } from './patchLibrary';

const ACCENT: PartialMacro = {
  name: 'Accent',
  value: 0.5,
  mappings: [{ target: 'filter.cutoff', min: 200, max: 2000 }],
};

/** A file around `patch`, raw, as a hand-written one would be. */
const fileWith = (patch: Record<string, unknown>): Record<string, unknown> => ({
  format: PATCH_FILE_FORMAT,
  name: 'probe',
  category: 'Bass',
  tags: [],
  description: 'A patch that exists only inside this test.',
  patch: { name: 'probe', ...patch },
});

/** Two macros and three mappings, as the Macros card would write them. */
const TWO_MACROS = [
  {
    name: 'Accent',
    value: 0.25,
    mappings: [
      { target: 'ops.0.level', min: 0.4, max: 1, curve: MACRO_CURVE.EXP, inverted: false },
      { target: 'filter.cutoff', min: 300, max: 3000 },
    ],
  },
  { name: 'Wobble', value: 0, mappings: [{ target: 'lfo.amount', max: 0.6, inverted: true }] },
];

const load = (macros: unknown): Patch => loadPatchFile('probe', fileWith({ macros })).patch;

describe('makePatch and the macros (windsor#559)', () => {
  it('has none by default', () => {
    expect(makePatch().macros).toEqual([]);
  });

  it('fills a mapping’s curve and inverted, and keeps it', () => {
    expect(makePatch({ macros: [ACCENT] }).macros).toEqual([
      {
        name: 'Accent',
        value: 0.5,
        mappings: [
          {
            target: 'filter.cutoff',
            min: 200,
            max: 2000,
            curve: MACRO_CURVE.LINEAR,
            inverted: false,
          },
        ],
      },
    ]);
    expect(makePatch({ macros: [{}] }).macros).toEqual([{ name: 'Macro', value: 0, mappings: [] }]);
  });

  it('replaces the list wholesale on a merge', () => {
    const base = makePatch({ macros: [ACCENT, { name: 'Wobble' }] });
    expect(mergePatch(base, { macros: [{ name: 'Drive' }] }).macros).toEqual([
      { name: 'Drive', value: 0, mappings: [] },
    ]);
    expect(mergePatch(base, { volume: 0.5 }).macros).toEqual(base.macros);
  });
});

describe('the loader and the macros (windsor#559)', () => {
  it('accepts two macros and three mappings, and returns them completed', () => {
    const [accent, wobble] = load(TWO_MACROS).macros;
    expect(accent!.mappings[1]).toEqual({
      target: 'filter.cutoff',
      min: 300,
      max: 3000,
      curve: MACRO_CURVE.LINEAR,
      inverted: false,
    });
    expect(wobble).toEqual({
      name: 'Wobble',
      value: 0,
      mappings: [
        { target: 'lfo.amount', min: 0, max: 0.6, curve: MACRO_CURVE.LINEAR, inverted: true },
      ],
    });
  });

  it('loads a file with no macros as it did', () => {
    expect(loadPatchFile('probe', fileWith({})).patch).toEqual(makePatch({ name: 'probe' }));
  });

  const nine = <T>(item: (i: number) => T): T[] => Array.from({ length: 9 }, (_, i) => item(i));
  const OPS = ['level', 'feedback', 'width'] as const;
  const mapping = (i: number) => ({ target: `ops.${i % 4}.${OPS[Math.floor(i / 4)]!}` });

  it.each<[string, unknown, RegExp]>([
    ['nine macros', nine(() => ({})), /patch\.macros: length 9, at most 8/],
    [
      'nine mappings',
      [{ mappings: nine(mapping) }],
      /patch\.macros\[0\]\.mappings: length 9, at most 8/,
    ],
    [
      'an unknown mapping key',
      [{ mappings: [{ target: 'filter.cutoff', depth: 1 }] }],
      /patch\.macros\[0\]\.mappings\[0\]: unknown field depth/,
    ],
    [
      'a non-number min',
      [{ mappings: [{ target: 'filter.cutoff', min: 'low' }] }],
      /patch\.macros\[0\]\.mappings\[0\]\.min: expected a number/,
    ],
    [
      'a macro row as a target',
      [{}, { mappings: [{ target: 'macros.1.value' }] }],
      /patch\.macros\[1\]\.mappings\[0\]\.target: macros\.1\.value is a macro/,
    ],
    [
      'a target the table lacks',
      [{ mappings: [{ target: 'ops.0.ratio' }] }],
      /patch\.macros\[0\]\.mappings\[0\]\.target: "ops\.0\.ratio" is not a voice target/,
    ],
    [
      'a target an earlier macro maps',
      [{ mappings: [{ target: 'lfo.rate' }] }, { mappings: [{ target: 'lfo.rate' }] }],
      /patch\.macros\[1\]\.mappings\[0\]\.target: lfo\.rate is already mapped/,
    ],
  ])('refuses %s, naming the path', (_what, macros, message) => {
    expect(() => load(macros)).toThrow(message);
  });
});

describe("a song's macros (windsor#559)", () => {
  const PATCHES = { kick: { macros: TWO_MACROS }, hat: {} };

  it('are kept through export and import, and none is added to a patch without', () => {
    const first = makeArrangement(song([KICK], { patches: PATCHES }));
    expect(first.corrections).toEqual([]);
    const patches = first.document.patches!;
    expect(patches['kick']!.macros).toEqual(load(TWO_MACROS).macros);
    expect(patches['hat']!.macros).toEqual([]);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)) as unknown);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('drop and report what the loader refuses', () => {
    const macros = [
      { name: 'Accent', value: 0.5, mappings: [{ target: 'filter.cutoff' }, { target: 'pan' }] },
      { mappings: [{ target: 'filter.cutoff' }, { target: 'macros.0.value' }, 'sweep'] },
      ...nineMore(),
    ];
    const result = makeArrangement(song([KICK], { patches: { kick: { macros } } }));
    const kick = result.document.patches!['kick']!;
    expect(kick.macros).toHaveLength(8);
    expect(kick.macros[0]!.mappings.map((m) => m.target)).toEqual(['filter.cutoff']);
    expect(kick.macros[1]!.mappings).toEqual([]);
    expect(result.corrections).toEqual([
      'patches.kick.macros: 11 entries, at most 8 — the rest dropped',
      'patches.kick.macros[0].mappings[1]: "pan" is not a voice target — dropped',
      'patches.kick.macros[1].mappings[0]: filter.cutoff is already mapped — dropped',
      'patches.kick.macros[1].mappings[1]: macros.0.value is a macro — dropped',
      'patches.kick.macros[1].mappings[2]: not a mapping — dropped',
    ]);
  });
});

/** Nine empty macros, past the bound with the two before them. */
const nineMore = (): object[] => Array.from({ length: 9 }, () => ({}));
