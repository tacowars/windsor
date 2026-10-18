/**
 * Duplicate (windsor#904; record `2026-10-18-roll-zoom-bars-and-duplicate`
 * decision 11): the doubled loop's second half is the first, the notes the
 * old loop cut stay cut, the envelopes read the same over both halves as
 * over the old loop, parked notes and points stay parked, Dup is refused
 * past the region and the caps, and the write is one undo step.
 */
import { describe, expect, it } from 'vitest';

import type {
  ApplyResult,
  DocumentPartial,
  RollEnvelope,
  RollNote,
  RollSequencerConfig,
} from '@windsor/engine';
import {
  ROLL_ENVELOPE_POINTS_MAX,
  ROLL_LOOP_TICKS_MAX,
  ROLL_NOTES_MAX,
  TICKS_PER_BAR,
  envelopeValueAt,
  partAt,
} from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import { withGesture } from './gestureHooks';
import type { EngineHost } from './host';
import { patternOf, regionPatternChange, sequencerKindChange } from './partEdits';
import { duplicateLoop, duplicateRefusal, duplicatedSelection } from './rollDuplicate';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const BEAT = BAR / 4;
const LOOP = 2 * BAR;
const REGION = 4 * BAR;

/** Sixteen eighths over two bars, some soft, some accented, some ratcheted. */
const NOTES: RollNote[] = Array.from({ length: 16 }, (_, i) => {
  const note: { -readonly [K in keyof RollNote]: RollNote[K] } = {
    tick: i * (BEAT / 2),
    ticks: BEAT / 2,
    pitch: 36 + (i % 4) * 7,
  };
  if (i % 3 === 0) note.velocity = 0.5;
  if (i % 4 === 1) note.accent = true;
  if (i % 5 === 2) note.ratchet = 3;
  return note;
});

/** One opening on tick 0, one opening late; both ending on another value than they open on. */
const ENVELOPES: RollEnvelope[] = [
  {
    target: 'filter.cutoff',
    on: true,
    points: [
      { tick: 0, value: -0.5, bend: 0.25 },
      { tick: BAR, value: 0.5, bend: 0 },
      { tick: BAR + 2 * BEAT, value: 0.2, bend: -0.3 },
    ],
  },
  {
    target: 'filter.resonance',
    on: true,
    points: [
      { tick: BEAT, value: 0.8, bend: 0 },
      { tick: 5 * BEAT, value: -0.4, bend: 0.5 },
    ],
  },
];

const ROLL: RollSequencerConfig = { loopTicks: LOOP, notes: NOTES, envelopes: ENVELOPES };

const doubled = (config: RollSequencerConfig, region = REGION): RollSequencerConfig => {
  const next = duplicateLoop(config, region);
  if (!next) throw new Error(`refused: ${String(duplicateRefusal(config, region))}`);
  return next;
};

describe('duplicateLoop', () => {
  it('doubles a two-bar loop into four, its second half the first, field for field', () => {
    const next = doubled(ROLL);
    expect(next.loopTicks).toBe(2 * LOOP);
    expect(next.notes).toHaveLength(32);
    expect(next.notes.slice(0, 16)).toEqual(NOTES);
    expect(next.notes.slice(16)).toEqual(
      NOTES.map((note) => ({ ...note, tick: note.tick + LOOP })),
    );
  });

  it('reads each envelope the same at t and t + 2 bars as the old loop did at t', () => {
    const next = doubled(ROLL);
    next.envelopes?.forEach((envelope, e) => {
      const old = ENVELOPES[e]!;
      for (let t = 0; t < LOOP; t++) {
        const was = envelopeValueAt(old, t, LOOP);
        expect(envelopeValueAt(envelope, t, 2 * LOOP)).toBe(was);
        expect(envelopeValueAt(envelope, t + LOOP, 2 * LOOP)).toBe(was);
      }
    });
  });

  it('adds a seam point only where the hold or the opening would differ, and none where a point sits', () => {
    const [cutoff, resonance] = doubled(ROLL).envelopes!;
    // Cutoff opens on tick 0, so its copy opens the new half: the hold's point alone.
    expect(cutoff!.points.map((p) => p.tick)).toEqual([
      0,
      BAR,
      BAR + 2 * BEAT,
      LOOP - 1,
      LOOP,
      LOOP + BAR,
      LOOP + BAR + 2 * BEAT,
    ]);
    expect(cutoff!.points[3]).toEqual({ tick: LOOP - 1, value: 0.2, bend: 0 });
    // Resonance opens late: the hold's point and the opening's, on the old loop's end.
    expect(resonance!.points).toEqual([
      ...ENVELOPES[1]!.points,
      { tick: LOOP - 1, value: -0.4, bend: 0 },
      { tick: LOOP, value: 0.8, bend: 0 },
      ...ENVELOPES[1]!.points.map((p) => ({ ...p, tick: p.tick + LOOP })),
    ]);
    // An envelope that closes on the value it opens on needs no seam, and an off one is copied too.
    const flat: RollEnvelope = {
      target: 'filter.cutoff',
      on: false,
      points: [
        { tick: BEAT, value: 0.3, bend: 0 },
        { tick: BAR, value: -1, bend: 0.5 },
        { tick: BAR + BEAT, value: 0.3, bend: 0 },
      ],
    };
    const copied = doubled({ loopTicks: LOOP, notes: [], envelopes: [flat] }).envelopes![0]!;
    expect(copied).toEqual({
      ...flat,
      points: [...flat.points, ...flat.points.map((p) => ({ ...p, tick: p.tick + LOOP }))],
    });
  });

  it('keeps a note the old loop cut cut in both halves', () => {
    const late: RollNote = { tick: LOOP - BEAT, ticks: BAR, pitch: 60, ratchet: 4 };
    const next = doubled({ loopTicks: LOOP, notes: [late] });
    expect(next.notes).toEqual([
      { ...late, ticks: BEAT },
      { ...late, tick: 2 * LOOP - BEAT, ticks: BEAT },
    ]);
  });

  it('moves a parked note and point one loop later, still parked', () => {
    const parked: RollNote = { tick: LOOP + BEAT, ticks: BEAT, pitch: 48 };
    const point = { tick: LOOP + BEAT, value: 1, bend: 0 };
    const envelope: RollEnvelope = { target: 'filter.cutoff', on: true, points: [point] };
    const next = doubled({ loopTicks: LOOP, notes: [NOTES[0]!, parked], envelopes: [envelope] });
    expect(next.notes).toEqual([
      NOTES[0],
      { ...NOTES[0], tick: LOOP },
      { ...parked, tick: 2 * LOOP + BEAT },
    ]);
    expect(next.notes[2]!.tick).toBeGreaterThanOrEqual(next.loopTicks);
    expect(next.envelopes![0]!.points).toEqual([{ ...point, tick: 2 * LOOP + BEAT }]);
  });

  it('doubles an empty loop with nothing copied, and keeps the other fields', () => {
    const empty: RollSequencerConfig = { loopTicks: BAR, notes: [], accentVelocity: 0.3 };
    expect(doubled(empty)).toEqual({ loopTicks: 2 * BAR, notes: [], accentVelocity: 0.3 });
  });
});

describe('duplicateRefusal', () => {
  it('passes a loop that doubles to the region exactly', () => {
    expect(duplicateRefusal(ROLL, REGION)).toBeNull();
  });

  it('refuses a loop as long as its region, and a loop past half the longest', () => {
    expect(duplicateRefusal(ROLL, LOOP)).toBe('region');
    expect(duplicateLoop(ROLL, LOOP)).toBeNull();
    const long = { loopTicks: ROLL_LOOP_TICKS_MAX / 2 + BAR, notes: [] };
    expect(duplicateRefusal(long, 2 * ROLL_LOOP_TICKS_MAX)).toBe('longest');
    const half = { loopTicks: ROLL_LOOP_TICKS_MAX / 2, notes: [] };
    expect(duplicateRefusal(half, ROLL_LOOP_TICKS_MAX)).toBeNull();
  });

  it('refuses a roll past half the note cap, counting only the notes inside', () => {
    const at = (count: number): RollSequencerConfig => ({
      loopTicks: LOOP,
      notes: Array.from({ length: count }, (_, i) => ({
        tick: i % LOOP,
        ticks: 1,
        pitch: Math.floor(i / LOOP),
      })),
    });
    expect(duplicateRefusal(at(ROLL_NOTES_MAX / 2), REGION)).toBeNull();
    expect(duplicateRefusal(at(ROLL_NOTES_MAX / 2 + 1), REGION)).toBe('notes');
    const parked = { tick: LOOP, ticks: 1, pitch: 0 };
    const full = at(ROLL_NOTES_MAX / 2);
    expect(duplicateRefusal({ ...full, notes: [...full.notes, parked] }, REGION)).toBe('notes');
  });

  it('refuses an envelope past half the point cap, its seam points counted', () => {
    const loop = 32 * BAR;
    const at = (count: number, value: (i: number) => number): RollSequencerConfig => ({
      loopTicks: loop,
      notes: [],
      envelopes: [
        {
          target: 'filter.cutoff',
          on: true,
          points: Array.from({ length: count }, (_, i) => ({ tick: i, value: value(i), bend: 0 })),
        },
      ],
    });
    const level = (): number => 0.5;
    const zigzag = (i: number): number => (i % 2) - 0.5;
    const half = ROLL_ENVELOPE_POINTS_MAX / 2;
    expect(duplicateRefusal(at(half, level), 2 * loop)).toBeNull();
    expect(duplicateRefusal(at(half + 1, level), 2 * loop)).toBe('points');
    // Opening on −0.5 and closing on 0.5, the hold's point makes one more: past the cap.
    expect(duplicateRefusal(at(half, zigzag), 2 * loop)).toBe('points');
    expect(duplicateRefusal(at(half - 2, zigzag), 2 * loop)).toBeNull();
  });

  it('refuses when a parked note or point would move past the longest loop', () => {
    const loop = ROLL_LOOP_TICKS_MAX / 4;
    const region = ROLL_LOOP_TICKS_MAX;
    const note = (tick: number): RollSequencerConfig => ({
      loopTicks: loop,
      notes: [{ tick, ticks: 1, pitch: 60 }],
    });
    expect(duplicateRefusal(note(ROLL_LOOP_TICKS_MAX - 1 - loop), region)).toBeNull();
    expect(duplicateRefusal(note(ROLL_LOOP_TICKS_MAX - loop), region)).toBe('parked');
    const point: RollSequencerConfig = {
      loopTicks: loop,
      notes: [],
      envelopes: [
        {
          target: 'filter.cutoff',
          on: true,
          points: [{ tick: ROLL_LOOP_TICKS_MAX - loop, value: 0, bend: 0 }],
        },
      ],
    };
    expect(duplicateRefusal(point, region)).toBe('parked');
  });
});

describe('duplicatedSelection', () => {
  it('keeps the selection on the same notes, the parked ones past the copies', () => {
    const parked: RollNote = { tick: LOOP + BEAT, ticks: BEAT, pitch: 48 };
    const notes = [NOTES[0]!, NOTES[1]!, parked];
    expect(duplicatedSelection(notes, LOOP, [1, 2])).toEqual([1, 4]);
    const next = doubled({ loopTicks: LOOP, notes });
    expect(next.notes[1]).toEqual(NOTES[1]);
    expect(next.notes[4]).toEqual({ ...parked, tick: parked.tick + LOOP });
  });
});

describe('the write', () => {
  function openConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
    const model = new DocumentModel(newSong());
    const kind = sequencerKindChange(model.doc, 0, 'roll', (raw) => model.preview(raw));
    if (kind) model.merge(kind);
    model.merge({ transport: { bars: 8 } });
    const pattern = { kind: 'roll', ...ROLL };
    model.merge({ parts: { 0: { regions: [{ start: 0, duration: REGION, pattern }] } } });
    const host: ContextHost = {
      apply: (_partial: DocumentPartial): ApplyResult => ({ ok: true, ignored: [] }),
      build: () => Promise.resolve(),
      isBuilding: false,
      capturePattern: () => null,
      part: () => null,
    };
    const ctx = new AppContext<TabPanel>({
      host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
      model,
      notify: () => undefined,
    });
    ctx.addTab('song', { hidden: false }, () => {});
    return { ctx, model };
  }

  it('lands as the normaliser keeps it, and one undo restores the roll exactly', () => {
    const { ctx, model } = openConsole();
    const before = patternOf(model.doc, 0, 0);
    expect(before).toMatchObject({ loopTicks: LOOP, notes: NOTES, envelopes: ENVELOPES });
    const next = doubled(ROLL);
    const { loopTicks, notes, envelopes } = next;
    withGesture('Duplicate loop', () => {
      const partial = regionPatternChange(model.doc, 0, 0, { loopTicks, notes, envelopes });
      expect(partial && ctx.change(partial).ok).toBe(true);
    });
    expect(patternOf(model.doc, 0, 0)).toEqual({ kind: 'roll', ...next });
    expect(partAt(model.doc, 0)?.regions).toHaveLength(1);
    expect(ctx.undo()).toBe(true);
    expect(patternOf(model.doc, 0, 0)).toStrictEqual(before);
    expect(ctx.canUndo).toBe(false);
  });
});
