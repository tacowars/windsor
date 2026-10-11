/**
 * A Roll's clip envelopes through the normaliser (windsor#701): a document
 * carrying them on the part's sequencer and on a region's pattern loads
 * clean and round-trips byte for byte; the normaliser drops what no
 * envelope may hold, clamps, sorts, collapses and caps the points, and
 * writes an empty list as no key.
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { ROLL_ENVELOPE_POINTS_MAX } from '../sequencing/rollEnvelopeTables';
import { ROLL_LOOP_TICKS_MAX } from '../sequencing/rollSequencer';
import type { RollSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { FieldNormaliser } from './arrangementFields';
import { regionPattern } from './regionPattern';
import { normaliseRegionPattern, normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';

function roll(envelopes: unknown): { spec: RollSpec; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'roll', loopTicks: 96, envelopes }, PATH, n) as RollSpec;
  return { spec, corrections: n.corrections };
}

const FIXTURE = currentDocument('roll-envelopes');
const WRITTEN = FIXTURE.parts as { sequencer: object; regions: object[] }[];

describe('a Roll with envelopes in a document (windsor#701)', () => {
  it('loads with no correction and round-trips byte for byte, on the sequencer and in a pattern', () => {
    const first = makeArrangement(FIXTURE);
    expect(first.corrections).toEqual([]);
    const part = first.document.parts[0]!;
    expect(JSON.stringify(part.sequencer)).toBe(JSON.stringify(WRITTEN[0]!.sequencer));
    expect(JSON.stringify(part.regions)).toBe(JSON.stringify(WRITTEN[0]!.regions));
    const text = JSON.stringify(first.document);
    expect(JSON.stringify(makeArrangement(JSON.parse(text)).document)).toBe(text);
    // Each region plays its own envelopes: the first the part's, the second its pattern's.
    const targets = (index: number): string[] =>
      ((regionPattern(part, index) as RollSpec).envelopes ?? []).map((e) => e.target);
    expect(targets(0)).toEqual(['filter.cutoff', 'ops.1.level']);
    expect(targets(1)).toEqual(['macros.0.value']);
  });
});

describe('Roll envelope normalisation (windsor#701)', () => {
  it('writes an absent or empty list as no key, silently', () => {
    expect(roll(undefined)).toEqual({
      spec: { kind: 'roll', loopTicks: 96, notes: [] },
      corrections: [],
    });
    expect(roll([])).toEqual(roll(undefined));
  });

  it('drops an unknown target, a repeated one and a fifth envelope, each reported', () => {
    const targets = ['filter.cutoff', 'strip.level', 'filter.cutoff', 'ops.0.level'];
    const more = ['lfo.rate', 'macros.3.value', 'filter.resonance'];
    const { spec, corrections } = roll(
      [...targets, ...more].map((target) => ({ target, points: [] })),
    );
    expect(spec.envelopes?.map((e) => e.target)).toEqual([
      'filter.cutoff',
      'ops.0.level',
      'lfo.rate',
      'macros.3.value',
    ]);
    expect(spec.envelopes?.every((e) => e.on)).toBe(true);
    expect(corrections).toEqual([
      'parts[0].sequencer.envelopes[1]: "strip.level" is not a voice target — envelope dropped',
      'parts[0].sequencer.envelopes[2]: filter.cutoff already has an envelope — envelope dropped',
      'parts[0].sequencer.envelopes[6]: more than 4 envelopes — envelope dropped',
    ]);
  });

  it('clamps values, bends and ticks, sorts the points and keeps the later of two on a tick', () => {
    const points = [
      { tick: 48, value: 2, bend: 0 },
      { tick: -3, value: 0.5, bend: -4 },
      { tick: ROLL_LOOP_TICKS_MAX + 10, value: -0.5 },
      { tick: 12.5, value: 0.1, bend: 0.2 },
      { tick: 12.5, value: 0.9, bend: 0.3 },
      { tick: 20, value: Number.NaN },
    ];
    const { spec, corrections } = roll([{ target: 'filter.cutoff', on: false, points }]);
    expect(spec.envelopes).toEqual([
      {
        target: 'filter.cutoff',
        on: false,
        points: [
          { tick: 0, value: 0.5, bend: -1 },
          { tick: 12.5, value: 0.9, bend: 0.3 },
          { tick: 48, value: 1, bend: 0 },
          { tick: ROLL_LOOP_TICKS_MAX - 1, value: -0.5, bend: 0 },
        ],
      },
    ]);
    const at = 'parts[0].sequencer.envelopes[0].points';
    expect(corrections).toEqual([
      `${at}[0].value: clamped 2 to 1`,
      `${at}[1].tick: clamped -3 to 0`,
      `${at}[1].bend: clamped -4 to -1`,
      `${at}[2].tick: clamped ${ROLL_LOOP_TICKS_MAX + 10} to ${ROLL_LOOP_TICKS_MAX - 1}`,
      `${at}[5]: {"tick":20,"value":null} is not a point — dropped`,
      `${at}: 1 points shared a tick — the earlier dropped`,
    ]);
  });

  it('trims the points past the cap, on a region pattern as on the sequencer', () => {
    const points = Array.from({ length: ROLL_ENVELOPE_POINTS_MAX + 2 }, (_, i) => ({
      tick: i / 2,
      value: 0,
      bend: 0,
    }));
    const n = new FieldNormaliser();
    const raw = { kind: 'roll', loopTicks: 96, envelopes: [{ target: 'lfo.amount', points }] };
    const pattern = normaliseRegionPattern(
      raw,
      'roll',
      'parts[0].regions[0].pattern',
      n,
    ) as RollSpec;
    expect(pattern.envelopes?.[0]?.points).toHaveLength(ROLL_ENVELOPE_POINTS_MAX);
    expect(pattern.envelopes?.[0]?.points.at(-1)?.tick).toBe((ROLL_ENVELOPE_POINTS_MAX - 1) / 2);
    expect(n.corrections).toEqual([
      `parts[0].regions[0].pattern.envelopes[0].points: ${ROLL_ENVELOPE_POINTS_MAX + 2} points trimmed to ${ROLL_ENVELOPE_POINTS_MAX}`,
    ]);
  });
});
