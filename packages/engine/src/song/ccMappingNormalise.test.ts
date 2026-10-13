/**
 * A part's MIDI CC mappings in the song format (windsor#782, record
 * `2026-10-13-midi-cc-mapping` decisions 9 and 10): kept exactly through
 * normalise, export and import; absent when there are none, so a song
 * without them is byte for byte what it was; and each case of the brief's
 * decision 2 corrected and reported, never refused.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_EQ_ID,
  AUTOMATION_TAPE_ID,
} from '../__fixtures__/automationSong';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import { FM_LANES_MAX } from '../automation/automationTargetTables';
import {
  VOICE_AUTOMATION_ROWS,
  formatTargetId,
  requireCatalogRow,
} from '../automation/automationTargets';
import { makeArrangement, type DocumentPart } from './arrangementDocument';
import type { CcMapping } from './ccMapping';

const { hat } = FULL_SLOT;
const tapeDrive = formatTargetId({ kind: 'insert', insertId: AUTOMATION_TAPE_ID, field: 'drive' });
const eqFreq = formatTargetId({
  kind: 'insert',
  insertId: AUTOMATION_EQ_ID,
  field: 'bands.0.freq',
});
const CUTOFF = requireCatalogRow('voice.filter.cutoff');

const mapping = (target: string, cc: number, extra: Partial<CcMapping> = {}): CcMapping =>
  ({
    source: { device: 'Launch Control XL', channel: 1, cc },
    target,
    min: 0,
    max: 1,
    inverted: false,
    ...extra,
  }) as CcMapping;

/** One of each target kind, in normalised form. */
const MAPPINGS: readonly CcMapping[] = [
  mapping('strip.level', 77, { min: 0.25, max: 1.5 }),
  mapping(tapeDrive, 78, { min: -6, max: 12, inverted: true }),
  mapping(eqFreq, 79, { source: { device: null, channel: null, cc: 79 }, min: 80, max: 4000 }),
  mapping('voice.filter.cutoff', 74, {
    source: { device: 'MPK', channel: 16, cc: 74 },
    min: 2000,
    max: 6000,
  }),
  // Macro 8: the hat's patch defines none, and the mapping stays, inert (decision 10).
  mapping('voice.macros.7.value', 2, { inverted: true }),
];

const hatOf = (document: { parts: readonly DocumentPart[] }): DocumentPart =>
  document.parts.find((part) => part.slot === hat)!;

/** `AUTOMATION_DOCUMENT` with the hat's `ccMappings` set to `raw` (absent for undefined). */
const withMappings = (raw: unknown) => ({
  ...AUTOMATION_DOCUMENT,
  parts: AUTOMATION_DOCUMENT.parts.map((part) =>
    part.slot === hat ? { ...part, ...(raw !== undefined && { ccMappings: raw }) } : part,
  ),
});

function normalised(raw: unknown): { mappings: unknown; corrections: string[] } {
  const result = makeArrangement(withMappings(raw));
  expect(result.usable).toBe(true);
  return { mappings: hatOf(result.document).ccMappings, corrections: result.corrections };
}

describe('a song with CC mappings', () => {
  it('keeps every field of every mapping through normalise, export and import', () => {
    const first = makeArrangement(withMappings(MAPPINGS));
    expect(first.corrections).toEqual([]);
    expect(hatOf(first.document).ccMappings).toEqual(MAPPINGS);
    const text = JSON.stringify(first.document);
    const second = makeArrangement(JSON.parse(text));
    expect(second.corrections).toEqual([]);
    expect(JSON.stringify(second.document)).toBe(text);
  });

  it('writes no key for a part without mappings, so such a song exports as before', () => {
    const before = JSON.stringify(makeArrangement(withMappings(undefined)).document);
    expect(before).not.toContain('ccMappings');
    expect(JSON.stringify(makeArrangement(JSON.parse(before)).document)).toBe(before);
    expect(JSON.stringify(makeArrangement(withMappings([])).document)).toBe(before);
  });

  it('keeps mappings past the voice slots, which the console orders at play time', () => {
    const many = VOICE_AUTOMATION_ROWS.slice(0, FM_LANES_MAX + 2).map((row, i) =>
      mapping(row.target, 20 + i, { min: row.min, max: row.max }),
    );
    expect(normalised(many)).toEqual({ mappings: many, corrections: [] });
  });

  it('drops the whole list when it is not one', () => {
    const { mappings, corrections } = normalised({ cc: 74 });
    expect(mappings).toBeUndefined();
    expect(corrections).toEqual([expect.stringContaining('is not a list of CC mappings')]);
  });
});

describe('a mapping the normaliser drops, reported', () => {
  const kept = mapping('strip.pan', 10, { min: -1, max: 1 });
  it.each([
    ['a switch row', mapping(`insert.${AUTOMATION_TAPE_ID}.enabled`, 20), 'no mappable target'],
    ['a sequencer row', mapping('seq.gate', 20), 'no mappable target'],
    ['a target the catalog lacks', mapping('voice.nothing', 20), 'no mappable target'],
    ['an insert the strip does not hold', mapping('insert.gone.drive', 20), 'the part has no'],
    ['a CC past 127', mapping('strip.level', 128), 'no mappable controller'],
    ['a fractional CC', mapping('strip.level', 20.5), 'no mappable controller'],
    ['an ignored CC, sustain', mapping('strip.level', 64), 'no mappable controller'],
    ['an ignored CC, bank select', mapping('strip.level', 0), 'no mappable controller'],
    [
      'channel 0',
      mapping('strip.level', 20, { source: { device: null, channel: 0, cc: 20 } }),
      'no MIDI channel',
    ],
    [
      'channel 17',
      mapping('strip.level', 20, { source: { device: null, channel: 17, cc: 20 } }),
      'no MIDI channel',
    ],
  ])('%s', (_, dropped, reason) => {
    const { mappings, corrections } = normalised([dropped, kept]);
    expect(mappings).toEqual([kept]);
    expect(corrections).toEqual([expect.stringContaining(reason)]);
  });

  it('keeps the first of two mappings on one target', () => {
    const first = mapping('voice.filter.cutoff', 74, { min: 30, max: 18000 });
    const second = mapping('voice.filter.cutoff', 71, { min: 30, max: 18000 });
    const { mappings, corrections } = normalised([first, second]);
    expect(mappings).toEqual([first]);
    expect(corrections).toEqual([expect.stringContaining('an earlier mapping moves')]);
  });
});

describe('a mapping the normaliser corrects, reported', () => {
  it('clamps min and max to the target’s row and fills a missing end with it', () => {
    const { mappings, corrections } = normalised([
      { source: { cc: 74 }, target: 'voice.filter.cutoff', min: 5, max: 40000 },
      { source: { cc: 71 }, target: 'strip.pan' },
    ]);
    expect(mappings).toEqual([
      mapping('voice.filter.cutoff', 74, {
        source: { device: null, channel: null, cc: 74 },
        min: CUTOFF.min,
        max: CUTOFF.max,
      }),
      mapping('strip.pan', 71, {
        source: { device: null, channel: null, cc: 71 },
        min: -1,
        max: 1,
      }),
    ]);
    expect(corrections).toEqual([
      expect.stringContaining('.min: clamped 5 to 30'),
      expect.stringContaining('.max: clamped 40000 to 18000'),
    ]);
  });

  it('reads a device that is not a name as Any', () => {
    const { mappings, corrections } = normalised([
      mapping('strip.level', 20, { source: { device: 7, channel: 2, cc: 20 } as never }),
    ]);
    expect(mappings).toEqual([
      mapping('strip.level', 20, { source: { device: null, channel: 2, cc: 20 } }),
    ]);
    expect(corrections).toEqual([expect.stringContaining('is not a device name — using Any')]);
  });
});
