/**
 * `transport.meter` in the song document (windsor#429, record
 * `2026-10-02-one-meter-per-song`): absent stays absent and plays 4/4, each
 * meter round-trips as written, junk is 4/4 and reported, the song and its
 * loop and render are its bars of the meter, a meter change keeps every tick
 * and cuts what falls past a shorter end as lowering Bars does, and a part
 * written without steps (a new one) is one bar of its default step.
 */
import { describe, expect, it } from 'vitest';

import { AUTOMATION_DOCUMENT } from '../__fixtures__/automationSong';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { KICK, PATCHES, song } from '../__fixtures__/documentCases';
import { songSeconds } from '../render/renderSong';
import { METERS } from '../sequencing/meterTables';
import { PPQ } from '../sequencing/scheduler';
import type { Transport } from './arrangement';
import { makeArrangement, type ArrangementDocument } from './arrangementDocument';
import { songTicksOf } from './songClock';

const roundTrip = (document: ArrangementDocument): ReturnType<typeof makeArrangement> =>
  makeArrangement(JSON.parse(JSON.stringify(document)));

const withTransport = (
  document: ArrangementDocument,
  change: Partial<Transport>,
): ArrangementDocument => ({ ...document, transport: { ...document.transport, ...change } });

describe('transport.meter in the document', () => {
  it('round-trips each meter as written, 4/4 included, correction-free', () => {
    for (const meter of METERS) {
      const kick = { ...KICK, regions: [{ start: 0, duration: 72 }] };
      const first = makeArrangement(song([kick], { transport: { bpm: 100, bars: 2, meter } }));
      expect(first.corrections).toEqual([]);
      expect(first.document.transport.meter).toBe(meter);
      const again = roundTrip(first.document);
      expect(again.corrections).toEqual([]);
      expect(JSON.stringify(again.document)).toBe(JSON.stringify(first.document));
    }
  });

  it('corrects a meter off the list to 4/4, reported', () => {
    for (const meter of ['9/8', 4, null]) {
      const result = makeArrangement(song([KICK], { transport: { meter } }));
      expect(result.document.transport.meter).toBe('4/4');
      expect(result.corrections).toEqual([
        `transport.meter: ${JSON.stringify(meter)} is not one of ${METERS.join('|')} — using 4/4`,
      ]);
    }
  });

  it('makes a 4-bar 7/8 song 336 ticks: its regions, loop and render end there', () => {
    const bpm = 120;
    const loop = { start: 0, end: 999, on: true };
    const regions = [{ start: 0, duration: 999 }];
    const { document } = makeArrangement(
      song([{ ...KICK, regions }], { transport: { bpm, bars: 4, meter: '7/8', loop } }),
    );
    expect(songTicksOf(document)).toBe(336);
    expect(document.parts[0]!.regions).toEqual([{ start: 0, duration: 336 }]);
    expect(document.transport.loop).toEqual({ start: 0, end: 336, on: true });
    expect(songSeconds(document)).toBeCloseTo((336 * 60) / bpm / PPQ, 12);
  });

  it("puts a 7/8 bar line on the loop's grid, and keeps a 4/4 loop's ticks in 6/8", () => {
    const at = (meter: string, start: number, end: number) =>
      makeArrangement(song([KICK], { transport: { bars: 4, meter, loop: { start, end } } }))
        .document.transport.loop;
    expect(at('7/8', 84, 168)).toEqual({ start: 84, end: 168, on: false });
    expect(at('6/8', 24, 120)).toEqual({ start: 24, end: 120, on: false });
    expect(at('4/4', 84, 168)).toEqual({ start: 96, end: 168, on: false });
  });
});

describe('a meter change keeps every tick and the bar count', () => {
  const fourFour = makeArrangement(AUTOMATION_DOCUMENT).document;
  const END = 288;
  const threeFour = makeArrangement(withTransport(fourFour, { meter: '3/4' })).document;

  it('cuts a 4-bar 4/4 song at 288 in 3/4 exactly as lowering Bars to 3 does', () => {
    expect(songTicksOf(threeFour)).toBe(END);
    const threeBars = makeArrangement(withTransport(fourFour, { bars: 3 })).document;
    expect(threeFour.parts).toEqual(threeBars.parts);
    expect(threeFour.harmony).toEqual(threeBars.harmony);
    // Everything before the new end is where it was.
    const before = <T extends { start: number }>(list: readonly T[]): number[] =>
      list.map((entry) => entry.start).filter((start) => start < END);
    expect(before(threeFour.harmony.events)).toEqual(before(fourFour.harmony.events));
    fourFour.parts.forEach((part, i) => {
      const lanes = threeFour.parts[i]!.automation ?? [];
      (part.automation ?? []).forEach((lane, j) => {
        const kept = lane.points.filter((point) => point.tick < END);
        expect(lanes[j]!.points.filter((point) => point.tick < END)).toEqual(kept);
      });
    });
  });

  it('does not bring the cut back on switching to 4/4 again', () => {
    const back = makeArrangement(withTransport(threeFour, { meter: '4/4' })).document;
    expect(songTicksOf(back)).toBe(384);
    expect(back.parts.map((part) => part.regions)).toEqual(
      threeFour.parts.map((part) => part.regions),
    );
    expect(back.parts.map((part) => part.automation)).toEqual(
      threeFour.parts.map((part) => part.automation),
    );
  });
});

describe("a part written without steps is one bar of its default step in the song's meter", () => {
  const parts = (meter?: string) =>
    makeArrangement({
      version: ARRANGEMENT_VERSION,
      patches: PATCHES,
      transport: { bars: 1, ...(meter && { meter }) },
      parts: ['euclidean', 'grid', 'bass', 'chord'].map((kind, slot) => ({
        slot,
        preset: 'kick',
        regions: [{ start: 0, duration: 72 }],
        sequencer: kind === 'chord' ? { kind } : { kind, seed: 0 },
      })),
    }).document.parts.map((part) => part.sequencer);

  it('fills 14 sixteenths, 7 eighths and a quarter-note Chord Player in 7/8', () => {
    const [euclid, grid, bass, chord] = parts('7/8');
    expect(euclid).toMatchObject({ steps: 14, divisor: 6 });
    expect(grid).toMatchObject({ length: 14, divisor: 6 });
    expect(bass).toMatchObject({ length: 7, divisor: 12 });
    expect(chord).toMatchObject({ divisor: 24 });
  });

  it('keeps 4/4 and a song without a meter at 16, 16, 8 and the whole note', () => {
    for (const meter of [undefined, '4/4']) {
      const [euclid, grid, bass, chord] = parts(meter);
      expect(euclid).toMatchObject({ steps: 16 });
      expect(grid).toMatchObject({ length: 16 });
      expect(bass).toMatchObject({ length: 8 });
      expect(chord).toMatchObject({ divisor: 96 });
    }
  });
});
