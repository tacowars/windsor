import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { spectreCellPayload, spectreRampCells, SPECTRE_PAYLOAD_LENGTH } from './spectreCells';
import { SPECTRE_BOUNDS, SPECTRE_CELLS } from './spectreConstants';
import { spectreParameters, SPECTRE_PARAMS } from './spectreParameters';
import { DEFAULT_SPECTRE, normaliseSpectre } from './spectreSpec';

const normalise = (raw: Record<string, unknown>) => {
  const n = new FieldNormaliser();
  return { spec: normaliseSpectre({ kind: 'spectre', ...raw }, 's', n), n };
};

describe('normaliseSpectre', () => {
  it('reads the defaults back unchanged, silently', () => {
    const { spec, n } = normalise({ ...DEFAULT_SPECTRE });
    expect(spec).toEqual(DEFAULT_SPECTRE);
    expect(n.corrections).toEqual([]);
  });

  it('fills a bare spec with the defaults', () => {
    expect(normalise({}).spec).toEqual(DEFAULT_SPECTRE);
  });

  it('clamps every number to its bounds and refuses unknown choices', () => {
    const { spec, n } = normalise({
      gainShift: 99,
      outputDb: -99,
      bands: '999',
      overlap: '3x',
      mod: 'reverse',
      grid: '1/5',
      unknown: 1,
    });
    expect(spec.gainShift).toBe(SPECTRE_BOUNDS.gainShift[1]);
    expect(spec.outputDb).toBe(SPECTRE_BOUNDS.outputDb[0]);
    expect([spec.bands, spec.overlap, spec.mod, spec.grid]).toEqual([
      DEFAULT_SPECTRE.bands,
      DEFAULT_SPECTRE.overlap,
      DEFAULT_SPECTRE.mod,
      DEFAULT_SPECTRE.grid,
    ]);
    expect(n.corrections).toHaveLength(7);
  });

  it('stores cells to the song’s precision, holds them to 0..1 and falls back for junk', () => {
    const left = spectreRampCells(0, 1).map((v, i) => (i === 3 ? 1.5 : i === 4 ? 0.12345 : v));
    const { spec, n } = normalise({
      curves: { delay: { left, link: true, steps: true }, gain: 'x', extra: [] },
    });
    expect(spec.curves.delay.left[3]).toBe(1);
    expect(spec.curves.delay.left[4]).toBe(0.123);
    expect(spec.curves.delay.steps).toBe(true);
    expect(spec.curves.gain).toBe(DEFAULT_SPECTRE.curves.gain);
    expect(spec.curves.feedback).toBe(DEFAULT_SPECTRE.curves.feedback);
    // a cell outside 0..1, the junk gain, the unknown key; rounding is silent
    expect(n.corrections).toHaveLength(3);
  });

  it('resamples a list of the wrong length and samples a breakpoint curve into cells', () => {
    const short = normalise({ curves: { gain: { left: [0, 1], link: true } } });
    expect(short.spec.curves.gain.left).toHaveLength(SPECTRE_CELLS);
    expect(short.spec.curves.gain.left[0]).toBe(0);
    expect(short.spec.curves.gain.left[SPECTRE_CELLS - 1]).toBe(1);
    const points = normalise({
      curves: {
        delay: [
          { at: 0, value: 0 },
          { at: 1, value: 1 },
        ],
      },
    });
    expect(points.spec.curves.delay).toEqual({
      left: spectreRampCells(0, 1),
      link: true,
      steps: false,
    });
    expect(points.n.corrections).toHaveLength(1);
  });

  it('keeps the right cells only while unlinked, and starts them from the left', () => {
    const right = spectreRampCells(1, 0);
    const unlinked = normalise({
      curves: { delay: { left: spectreRampCells(0, 1), right, link: false } },
    }).spec.curves.delay;
    expect(unlinked.right).toEqual(right);
    const linked = normalise({
      curves: { delay: { left: spectreRampCells(0, 1), right, link: true } },
    }).spec.curves.delay;
    expect(linked.right).toBeUndefined();
    const fresh = normalise({
      curves: { delay: { left: spectreRampCells(0, 1), link: false } },
    }).spec.curves.delay;
    expect(fresh.right).toEqual(spectreRampCells(0, 1));
  });

  it('sorts, merges and holds the selection to the cells', () => {
    const { spec, n } = normalise({
      selection: [[50, 60], [10, 20], [55, 70], [170, 400], [5, 5], 'x'],
    });
    expect(spec.selection).toEqual([
      [10, 20],
      [50, 70],
      [170, SPECTRE_CELLS],
    ]);
    // the two junk ranges, then the reorder
    expect(n.corrections).toHaveLength(3);
  });

  it('lays the payload out as the processor reads it', () => {
    const payload = spectreCellPayload({
      ...DEFAULT_SPECTRE,
      curves: {
        ...DEFAULT_SPECTRE.curves,
        delay: {
          left: spectreRampCells(0, 1),
          right: spectreRampCells(1, 0),
          link: false,
          steps: true,
        },
      },
      selection: [[2, 4]],
    });
    expect(payload).toHaveLength(SPECTRE_PAYLOAD_LENGTH);
    const C = SPECTRE_CELLS;
    const gain = Math.fround(DEFAULT_SPECTRE.curves.gain.left[0]!);
    expect([payload[0], payload[C]]).toEqual([gain, gain]);
    expect([payload[2 * C], payload[3 * C]]).toEqual([
      Math.fround(spectreRampCells(0, 1)[0]!),
      Math.fround(spectreRampCells(1, 0)[0]!),
    ]);
    expect([...payload.subarray(6 * C, 6 * C + 5)]).toEqual([0, 0, 1, 1, 0]);
    expect([...payload.subarray(7 * C)]).toEqual([0, 1, 0]);
  });
});

describe('spectreParameters', () => {
  it('writes every descriptor, folding the tempo into the synced time, the grid and the LFO', () => {
    const values = spectreParameters({ ...DEFAULT_SPECTRE, lfoSync: true }, 120);
    // Every descriptor but the stage's own `pitches` (Follow's key or chord).
    expect(Object.keys(values).sort()).toEqual(
      SPECTRE_PARAMS.map((p) => p.name)
        .filter((name) => name !== 'pitches')
        .sort(),
    );
    // Twelve choices and switches, nineteen moves, the three folded times and `pitches`; the cells are posted.
    expect(SPECTRE_PARAMS).toHaveLength(35);
    // '1/2' is two beats, the grid a sixteenth, the LFO a bar's cycle, at 120 BPM.
    expect([values.timeMs, values.gridMs, values.lfoHz]).toEqual([1000, 125, 0.5]);
    const free = spectreParameters(
      { ...DEFAULT_SPECTRE, sync: false, timeMs: 333, grid: 'off' },
      90,
    );
    expect([free.timeMs, free.gridMs]).toEqual([333, 0]);
  });

  it('writes each LFO slot’s destination and Freeze’s mode as their index', () => {
    const values = spectreParameters(
      {
        ...DEFAULT_SPECTRE,
        lfoDest1: 'gainShift',
        lfoDest3: 'feedbackSelect',
        freezeMode: 'carve',
      },
      120,
    );
    expect([values.lfoDest1, values.lfoDest2, values.lfoDest3, values.freezeMode]).toEqual([
      0, 0, 8, 1,
    ]);
  });
});
