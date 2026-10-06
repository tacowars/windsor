import { describe, expect, it } from 'vitest';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { voiceTargetRow } from '../worklet/fm/voiceTargetTables';
import { FILTER_BOUNDS, FILTER_MODES } from './filterConstants';
import { FILTER_INSERT } from './filterInsert';
import { DEFAULT_FILTER } from './filterSpec';

describe('the Filter insert in a song (windsor#622)', () => {
  it("spans the voice filter's own Cutoff and Reso", () => {
    for (const [field, path] of [
      ['cutoff', 'filter.cutoff'],
      ['resonance', 'filter.resonance'],
    ] as const) {
      const row = voiceTargetRow(path)!;
      expect(FILTER_BOUNDS[field], field).toEqual([row.min, row.max]);
    }
  });

  it('keeps every valid setting, and clamps or drops the rest with a correction', () => {
    const n = new FieldNormaliser();
    for (const mode of FILTER_MODES) {
      const spec = { ...DEFAULT_FILTER, mode, slope24: true, cutoff: 440, resonance: 6, mix: 0.4 };
      expect(FILTER_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
    }
    expect(FILTER_INSERT.normalise({ ...DEFAULT_FILTER }, 'fx', n)).toEqual(DEFAULT_FILTER);
    expect(n.corrections).toEqual([]);
    const fixed = FILTER_INSERT.normalise(
      { mode: 'formant', cutoff: 5, resonance: 40, mix: -1, slope24: 'yes', extra: 1 },
      'fx',
      n,
    );
    expect(fixed).toEqual({
      ...DEFAULT_FILTER,
      mode: 'lowpass',
      cutoff: 30,
      resonance: 12,
      mix: 0,
    });
    expect(n.corrections).toHaveLength(6);
    expect(n.corrections.find((c) => c.startsWith('fx.mode'))).toContain('using lowpass');
  });

  it('round trips on a part strip, a group and the master, unchanged', () => {
    const filter = { ...DEFAULT_FILTER, mode: 'acid' as const, cutoff: 650, resonance: 9 };
    const raw = {
      ...FULL_ARRANGEMENT,
      version: ARRANGEMENT_VERSION,
      patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
      parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [filter] } })),
      groups: [{ id: 1, name: 'Bus', level: 1, pan: 0, inserts: [filter] }],
      master: { inserts: [filter] },
    };
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    const kept = [{ ...filter, id: expect.any(String) }];
    expect(result.document.parts[0]!.strip!.inserts).toEqual(kept);
    expect(result.document.groups![0]!.inserts).toEqual(kept);
    expect(result.document.master!.inserts).toEqual(kept);
    expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
      result.document,
    );
  });
});
