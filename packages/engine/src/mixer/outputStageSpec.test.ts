/** The song's `master.output` (windsor#93 decision 11): defaults, clamps and round trips. */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { masterOutput, mergeMasterPartial, normaliseMaster } from './masterSpec';
import { DEFAULT_OUTPUT_STAGE, normaliseOutputStage } from './outputStageSpec';

describe('master.output', () => {
  it('is absent from an old song, which plays on the limiter at −1 dBFS without lookahead', () => {
    const old = makeArrangement({ ...FULL_DOCUMENT, master: { level: 0.8, inserts: [] } });
    expect(old.corrections).toEqual([]);
    expect(old.document.master).toEqual({ level: 0.8, inserts: [] });
    expect(masterOutput(old.document.master)).toEqual({
      mode: 'limiter',
      ceilingDb: -1,
      lookahead: false,
    });
    expect(masterOutput(undefined)).toBe(DEFAULT_OUTPUT_STAGE);
  });

  it('round-trips a song that sets it, unchanged', () => {
    const output = { mode: 'soft', ceilingDb: -3.5, lookahead: true } as const;
    const raw = { ...FULL_DOCUMENT, master: { level: 1, inserts: [], output } };
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    expect(first.document.master?.output).toEqual(output);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document).toEqual(first.document);
  });

  it('fills a missing field with its default, silently', () => {
    const n = new FieldNormaliser();
    expect(normaliseOutputStage({ mode: 'hard' }, n)).toEqual({
      mode: 'hard',
      ceilingDb: -1,
      lookahead: false,
    });
    expect(n.corrections).toEqual([]);
  });

  it('clamps an out-of-range ceiling and replaces junk, with a correction for each', () => {
    const n = new FieldNormaliser();
    const master = normaliseMaster(
      { level: 1, inserts: [], output: { mode: 'fuzz', ceilingDb: 3, lookahead: 'yes', knee: 2 } },
      n,
    );
    expect(master.output).toEqual({ mode: 'limiter', ceilingDb: 0, lookahead: false });
    expect(n.corrections).toHaveLength(4);
    expect(n.corrections.join('\n')).toMatch(/master\.output\.ceilingDb: clamped 3 to 0/);
    const low = new FieldNormaliser();
    expect(normaliseOutputStage({ ceilingDb: -40 }, low).ceilingDb).toBe(-12);
    expect(low.corrections).toHaveLength(1);
  });

  it('merges a live partial output over the settings in force', () => {
    const spec = {
      level: 1,
      inserts: [],
      output: { mode: 'hard', ceilingDb: -4, lookahead: true },
    } as const;
    expect(mergeMasterPartial(spec, { output: { mode: 'soft' } })).toEqual({
      output: { mode: 'soft', ceilingDb: -4, lookahead: true },
    });
    expect(mergeMasterPartial({ level: 1, inserts: [] }, { output: { ceilingDb: -2 } })).toEqual({
      output: { mode: 'limiter', ceilingDb: -2, lookahead: false },
    });
    expect(mergeMasterPartial(spec, { level: 0.5 })).toEqual({ level: 0.5 });
  });
});
