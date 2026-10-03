/**
 * The Figure through the player (windsor#485, record
 * `2026-10-03-figure-sequencer`), over the listen song `figure-listen.json`
 * (C major: I for bar 1, Im7 for bar 2) with its cells replaced per case:
 * a cell voices the chord at its onset, a tie keeps its pitch across a
 * change, a cell's velocity scales the part's, slides and ratchets play as
 * the Grid's, and a note outside MIDI is dropped. The other kinds emit what
 * they emitted before the Figure played.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { recordingPart, type Call } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { figureNoteCell as note, type FigureCell } from '../sequencing/figureSequencer';
import { PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer } from './arrangementPlayer';

const SONG = currentDocument('figure-listen');
const BPM = (SONG['transport'] as { bpm: number }).bpm;
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;
const TIE: FigureCell = { kind: 'tie' };

type Played = Call & { tick: number };

/** The listen song with its Figure's fields replaced, played for `bars`: each note call and its tick. */
function play(over: Record<string, unknown>, bars = 2): Played[] {
  const [part] = SONG['parts'] as { sequencer: object }[];
  const raw = { ...SONG, parts: [{ ...part, sequencer: { ...part?.sequencer, ...over } }] };
  const { document, corrections } = makeArrangement(raw);
  expect(corrections).toEqual([]);
  const recorder = recordingPart();
  const transport = new TickTransport();
  const patches = document.patches ?? {};
  const player = new ArrangementPlayer(transport, new Map([[0, recorder]]), document, patches);
  for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  player.dispose();
  return recorder.calls
    .filter((c) => c.kind === 'noteOn' || c.kind === 'trigger' || c.kind === 'noteOffByNote')
    .map((c) => ({ ...c, tick: Math.round((c.time ?? 0) / TICK) }));
}

const cells = (
  written: FigureCell[],
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  cells: written,
  length: written.length,
  ...over,
});
const onsAt = (played: Played[], ticks: number[]): (number | undefined)[] =>
  ticks.map((t) => played.find((c) => c.kind === 'noteOn' && c.tick === t)?.note);

describe('a Figure through the player (windsor#485)', () => {
  it('voices tones 0–3 over the chord at each onset, with no edit to the part', () => {
    const played = play(cells([note(0), note(1), note(2), note(3)]));
    expect(onsAt(played, [0, 6, 12, 18])).toEqual([48, 52, 55, 60]); // C3 E3 G3 C4
    expect(onsAt(played, [96, 102, 108, 114])).toEqual([48, 51, 55, 58]); // C3 E♭3 G3 B♭3
  });

  it('moves only the cell after a chord change; a tie across it keeps its pitch', () => {
    // Step 15 strikes E3 over I, step 16 (bar 2, Im7) ties it, step 17 strikes E♭3.
    const played = play(cells([note(1), TIE, note(1)]));
    expect(onsAt(played, [90, 96, 102])).toEqual([52, undefined, 51]);
    const off = played.find((c) => c.kind === 'noteOffByNote' && c.note === 52 && c.tick >= 90);
    expect(off?.tick).toBe(99); // half of the tied cell, after the change
  });

  it("scales the part's velocity by the cell's, then adds the accent", () => {
    const played = play(
      cells([note(0, { velocity: 0.5 }), note(1, { velocity: 0.5, accent: true }), note(2)]),
    );
    const velocities = [0, 6, 12].map((t) => played.find((c) => c.tick === t)?.velocity);
    expect(velocities[0]).toBeCloseTo(0.4);
    expect(velocities[1]).toBeCloseTo(0.6);
    expect(velocities[2]).toBeCloseTo(0.8);
  });

  it('plays nothing at velocity 0, and the skip draws after it are unchanged', () => {
    const line = [note(0), note(1), note(2), note(3)];
    const onsets = (played: Played[]): string[] =>
      played.filter((c) => c.kind === 'noteOn').map((c) => `${c.tick}:${c.note}`);
    const full = onsets(play(cells(line, { skipChance: 0.5 })));
    const muted = onsets(
      play(cells([note(0, { velocity: 0 }), ...line.slice(1)], { skipChance: 0.5 })),
    );
    const cellZero = (onset: string): boolean => Number(onset.split(':')[0]) % 24 === 0;
    expect(full.length).toBeLessThan(32);
    expect(muted.some(cellZero)).toBe(false);
    expect(muted).toEqual(full.filter((onset) => !cellZero(onset)));
  });

  it('slides legato as a Grid slide does, and rolls a ratchet of 3 at a third of the cell', () => {
    const slid = play(cells([note(0), note(2, { slide: true })]), 1).filter((c) => c.tick === 6);
    expect(slid.map((c) => [c.kind, c.note, c.extras?.slide])).toEqual([
      ['noteOn', 55, true],
      ['noteOffByNote', 48, undefined],
    ]);
    const rolled = play(cells([note(0, { ratchet: 3 })], { gate: 1 }), 1).filter(
      (c) => c.kind !== 'noteOffByNote' && c.tick < 6,
    );
    expect(rolled.map((c) => [c.kind, c.tick])).toEqual([
      ['trigger', 0],
      ['trigger', 2],
      ['noteOn', 4],
    ]);
  });

  it('drops a note above MIDI 127 or below 0 rather than clamping it', () => {
    // Two cells a sixteenth each: the first on tick 0 of every 12, the second on tick 6.
    const ons = (played: Played[]): Set<string> =>
      new Set(played.filter((c) => c.kind === 'noteOn').map((c) => `${c.tick % 12}:${c.note}`));
    // G9 is 127; the C above it would clamp to 127 and sound on tick 6.
    expect(ons(play(cells([note(2), note(3)], { register: { octave: 9 } }), 1))).toEqual(
      new Set(['0:127']),
    );
    // The G below C-1 is -5, which would clamp to 0 and sound on tick 0.
    expect(ons(play(cells([note(-1), note(0)], { register: { octave: -1 } }), 1))).toEqual(
      new Set(['6:0']),
    );
  });
});

describe('the other kinds beside the Figure (windsor#485)', () => {
  it('emit exactly what they emitted before it: Euclid, Grid and Chord, then Arp and Bass', () => {
    const songs = [
      FULL_ARRANGEMENT,
      withPart(
        withPart(FULL_ARRANGEMENT, 'kick', { sequencer: { kind: 'bass', ...DEFAULT_BASS_CONFIG } }),
        'hat',
        {
          sequencer: { kind: 'arp', ...DEFAULT_ARP_CONFIG },
        },
      ),
    ];
    const calls = songs.map((song) => {
      const r = rig(song);
      r.run(4);
      return Object.values(r.parts).map((part) => part.calls);
    });
    const digest = createHash('sha256').update(JSON.stringify(calls)).digest('hex');
    // Read on origin/main before the Figure performer landed.
    expect(digest).toBe('55135277b56e70471828d27f4a51c0bee0be88bf9b3a882efe94ce41e16f3a9a');
  });
});
