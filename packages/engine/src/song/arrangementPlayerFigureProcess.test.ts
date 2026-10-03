/**
 * The Figure's length schedule and rotation drift through the player
 * (windsor#486, record `2026-10-03-figure-sequencer` decisions 4, 5 and 9),
 * over the listen song `figure-process.json` at the eighth in C major:
 * Clapping Music on slots 0 and 1 for bars 1–36 (slot 1 drifts a cell every
 * 12 bars), then a Glass additive line on slot 2 for bars 37–48 over vi,
 * cells 0–7 the chord's tones upward, scheduled 4, 5 and 6 cells for two
 * bars each. A Figure with neither process plays what windsor#485 played.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  currentDocument,
  type CurrentDocumentFile,
} from '../__fixtures__/arrangementDocumentFiles';
import { recordingPart, type Call } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer } from './arrangementPlayer';

const SONG = currentDocument('figure-process');
const EIGHTH = 12;
const BAR_7_8 = 84;
/** Slot 2's cells 0–7 over vi at register 3: A3 C4 E4, an octave up, then A5 C6. */
const GLASS_OVER_VI = [57, 60, 64, 69, 72, 76, 81, 84];
/** The same cells over I: C3 E3 G3, an octave up, then C5 E5. */
const GLASS_OVER_I = [48, 52, 55, 60, 64, 67, 72, 76];

type Played = Call & { tick: number };

interface Run {
  /** Each slot's note calls, at the transport tick they went out on. */
  played(slot: number): Played[];
  /** The player's `stepAt` at each probe, read before a tick played. */
  steps: number[];
}

/** A song file with `over` merged in, played for `ticks`; `probes` are `[slot, tick]` pairs for `stepAt`. */
function run(
  file: CurrentDocumentFile,
  ticks: number,
  over: Record<string, unknown> = {},
  probes: Array<[number, number]> = [],
): Run {
  const { document, corrections } = makeArrangement({ ...currentDocument(file), ...over });
  expect(corrections).toEqual([]);
  const recorders = new Map(document.parts.map((part) => [part.slot, recordingPart()]));
  const transport = new TickTransport();
  const player = new ArrangementPlayer(transport, recorders, document, document.patches ?? {});
  const steps = probes.map(([slot, tick]) => player.stepAt(slot, tick));
  for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  player.dispose();
  const tick = SECONDS_PER_MINUTE / document.transport.bpm / PPQ;
  const played = (slot: number): Played[] =>
    (recorders.get(slot)?.calls ?? [])
      .filter((c) => c.kind === 'noteOn' || c.kind === 'trigger' || c.kind === 'noteOffByNote')
      .map((c) => ({ ...c, tick: Math.round((c.time ?? 0) / tick) }));
  return { played, steps };
}

/** The 12 eighths from `bar`'s line as x (a note-on) and . (none): one pass of the clap line. */
function claps(played: Played[], bar: number, barTicks = TICKS_PER_BAR): string {
  const ons = new Set(played.filter((c) => c.kind === 'noteOn').map((c) => c.tick));
  const from = bar * barTicks;
  return Array.from({ length: 12 }, (_, i) => (ons.has(from + i * EIGHTH) ? 'x' : '.')).join('');
}

/** The cells of `bar`'s eighths, read back from the notes through `table`. */
function cellsIn(
  played: Played[],
  bar: number,
  table: number[],
  barTicks = TICKS_PER_BAR,
): number[] {
  return played
    .filter((c) => c.kind === 'noteOn' && c.tick >= bar * barTicks && c.tick < (bar + 1) * barTicks)
    .map((c) => table.indexOf(c.note ?? -1));
}

const UNSHIFTED = 'xxx.xx.x.xx.';
const BY_ONE = 'xx.xx.x.xx.x';
const BY_TWO = 'x.xx.x.xx.xx';

/** The listen song's three parts, each with its regions replaced. */
const regionsAll = (regions: object[]): object[] =>
  (SONG['parts'] as object[]).map((part) => ({ ...part, regions }));

describe('the length schedule (windsor#486)', () => {
  it('plays cells 0–3 for two bars, 0–4 for two, 0–5 for two, then 0–3 again, each stage from cell 0', () => {
    const glass = run('figure-process', 48 * TICKS_PER_BAR).played(2);
    const bars = [36, 37, 38, 39, 40, 41, 42].map((bar) => cellsIn(glass, bar, GLASS_OVER_VI));
    expect(bars).toEqual([
      [0, 1, 2, 3, 0, 1, 2, 3],
      [0, 1, 2, 3, 0, 1, 2, 3],
      [0, 1, 2, 3, 4, 0, 1, 2],
      [3, 4, 0, 1, 2, 3, 4, 0],
      [0, 1, 2, 3, 4, 5, 0, 1],
      [2, 3, 4, 5, 0, 1, 2, 3],
      [0, 1, 2, 3, 0, 1, 2, 3],
    ]);
  });
});

describe('the rotation drift (windsor#486)', () => {
  it('Clapping Music: slot 1 slips a cell after 12 bars and two after 24; slot 0 stays put', () => {
    const song = run('figure-process', 26 * TICKS_PER_BAR);
    const [steady, drifting] = [song.played(0), song.played(1)];
    expect([0, 9, 12, 24].map((bar) => claps(drifting, bar))).toEqual([
      UNSHIFTED,
      UNSHIFTED,
      BY_ONE,
      BY_TWO,
    ]);
    expect([0, 12, 24].map((bar) => claps(steady, bar))).toEqual([UNSHIFTED, UNSHIFTED, UNSHIFTED]);
  });

  it('lights the shifted cell: stepAt at bars 0, 12 and 24 on each part', () => {
    const probes = [1, 0].flatMap((slot) =>
      [0, 12, 24].map((bar): [number, number] => [slot, bar * TICKS_PER_BAR]),
    );
    expect(run('figure-process', 0, {}, probes).steps).toEqual([0, 1, 2, 0, 0, 0]);
  });

  it('starts both counters at 0 when a loop jump re-enters the region', () => {
    const loop = { start: 0, end: 14 * TICKS_PER_BAR, on: true };
    const song = run('figure-process', 28 * TICKS_PER_BAR, {
      transport: { ...(SONG['transport'] as object), loop },
      parts: regionsAll([{ start: 0, duration: 14 * TICKS_PER_BAR }]),
    });
    // The second pass starts on bar 14 of the clock: unshifted, then one cell at its own bar 12.
    expect([12, 14, 26].map((bar) => claps(song.played(1), bar))).toEqual([
      BY_ONE,
      UNSHIFTED,
      BY_ONE,
    ]);
    // Slot 2 is in its stage of four cells again, not the stage its 14th bar would be in.
    expect(cellsIn(song.played(2), 14, GLASS_OVER_I)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('changes stage and rotation on 84-tick bar lines in 7/8', () => {
    const bars = 14;
    const whole = { start: 0, duration: bars * BAR_7_8 };
    const song = run(
      'figure-process',
      bars * BAR_7_8,
      {
        transport: { bpm: 180, bars, meter: '7/8' },
        harmony: { root: 0, scale: 'major', events: [{ ...whole, degree: 0, size: 3 }] },
        parts: regionsAll([whole]),
      },
      [[1, 12 * BAR_7_8]],
    );
    const cells = (bar: number): number[] => cellsIn(song.played(2), bar, GLASS_OVER_I, BAR_7_8);
    expect([cells(1), cells(2)]).toEqual([
      [3, 0, 1, 2, 3, 0, 1],
      [0, 1, 2, 3, 4, 0, 1],
    ]);
    const hits = (bar: number): string => claps(song.played(1), bar, BAR_7_8).slice(0, 7);
    expect([hits(11), hits(12)]).toEqual(['x.x.xx.', 'xx.xx.x']);
    expect(song.steps).toEqual([1]); // the bar length handed at build, before a tick is heard
  });

  it('takes a live meter change at once: stepAt on the first moved bar line, before a tick', () => {
    const { document } = makeArrangement(SONG);
    const recorders = new Map(document.parts.map((part) => [part.slot, recordingPart()]));
    const patches = document.patches ?? {};
    const player = new ArrangementPlayer(new TickTransport(), recorders, document, patches);
    expect(player.apply({ transport: { meter: '7/8' } })).toEqual({ ok: true, ignored: [] });
    // Bar 12 of 7/8 starts on tick 1008, mid bar 10 of 4/4: slot 1 slips a cell on that line.
    expect([player.stepAt(1, 12 * BAR_7_8 - EIGHTH), player.stepAt(1, 12 * BAR_7_8)]).toEqual([
      11, 1,
    ]);
    player.dispose();
  });
});

describe('a Figure with neither process (windsor#486)', () => {
  it('emits exactly what windsor#485 emitted', () => {
    const played = run('figure-listen', 4 * TICKS_PER_BAR).played(0);
    const digest = createHash('sha256').update(JSON.stringify(played)).digest('hex');
    // Read on origin/main at windsor#485's merge (41d298b).
    expect(digest).toBe('6015b7ee781aa855773e9b76e74791e61b85b988edeccd841f1744fd27108b2f');
  });
});
