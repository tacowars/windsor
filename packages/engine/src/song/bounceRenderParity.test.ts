/**
 * Bounce to Roll's render against the player, kind by kind (windsor#740):
 * each of the six kinds renders a region that `ArrangementPlayer` plays
 * the same from the region's start, note for note. Each song is chosen so
 * decision 4 changes nothing (straight, a poly patch, no slide, no
 * ratchet, no hold past the next hit), so every note the part was asked to
 * play is a written note, at its pitch, onset, release and velocity. The
 * region rendered is the second of two, so its stream is the one the gate
 * mints for region 1, and its draws (skips, densities, random styles,
 * pitch choices) must land where the player's did.
 */
import { describe, expect, it } from 'vitest';

import { bounceSong, gridNote, gridSpec, playRegion, render } from '../__fixtures__/bounceRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, SequencerSpec } from './arrangement';
import type { Harmony } from '../harmony/harmonyTimeline';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { DEFAULT_CHORD_CONFIG, hitStep } from '../sequencing/chordSequencer';
import { DEFAULT_EUCLIDEAN_CONFIG } from '../sequencing/euclideanSequencer';
import { DEFAULT_FIGURE_CONFIG } from '../sequencing/figureSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const SPT = 60 / 120 / 24;
/** Two regions; the second, bars 4–5, is the one rendered. */
const REGIONS = [
  { start: 0, duration: 2 * BAR },
  { start: 3 * BAR, duration: 2 * BAR },
];
/** i, iv, v, i over the eight bars, so a chord changes inside the rendered region. */
const HARMONY: Harmony = {
  root: 2,
  scale: 'dorian',
  events: [0, 3, 4, 0].map((degree, i) => ({
    start: 2 * i * BAR,
    duration: 2 * BAR,
    degree,
    size: 3,
  })),
};

/** A note as `[tick, end, pitch, velocity]`. */
type Row = [number, number, number, number];

/** What the player's calls play in region 1, as rows in local ticks: each note-on to its release. */
function playedRows(calls: readonly Call[], start: number, duration: number): Row[] {
  const rows: Row[] = [];
  const held = new Map<number, Row[]>();
  for (const call of calls) {
    const tick = Math.round(call.time! / SPT) - start;
    const pitch = call.note!;
    if (call.kind === 'noteOffByNote') {
      for (const row of held.get(pitch) ?? []) row[1] = tick;
      held.delete(pitch);
      continue;
    }
    const end =
      call.kind === 'trigger' ? Math.round((call.time! + call.duration!) / SPT) - start : NaN;
    const row: Row = [tick, end, pitch, call.velocity!];
    rows.push(row);
    if (call.kind === 'noteOn') held.set(pitch, [...(held.get(pitch) ?? []), row]);
  }
  for (const row of rows) if (Number.isNaN(row[1])) row[1] = duration;
  return rows.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}

function expectParity(song: Arrangement): void {
  const { notes } = render(song, 1);
  const rows = playedRows(playRegion(song, 1).calls, REGIONS[1]!.start, REGIONS[1]!.duration);
  expect(rows.length).toBeGreaterThan(0);
  expect(
    notes.map((note): Row => [note.tick, note.tick + note.ticks, note.pitch, note.velocity]),
  ).toEqual(rows);
}

const songOf = (sequencer: SequencerSpec, preset = 'saw-arp'): Arrangement =>
  bounceSong(sequencer, { regions: REGIONS, harmony: HARMONY, preset });

describe('each kind renders what the player plays from the region’s start', () => {
  it('Euclid: a generative figure whose density breathes on the region’s stream', () => {
    const hold = 2 * SPT;
    expectParity(
      songOf({ kind: 'euclidean', ...DEFAULT_EUCLIDEAN_CONFIG, seed: 7, note: 36, hold }, 'kick'),
    );
  });

  it('Grid: a written line with skips drawn from the region’s stream', () => {
    const steps = [0, 2, 4, 2, 5, 4, 2, 1].map((degree) =>
      gridNote(degree, { accent: degree === 4 }),
    );
    expectParity(songOf(gridSpec(steps, { divisor: 12, skipChance: 0.3, seed: 3 })));
  });

  it('Chord: the harmony’s chord voiced on every hit, its notes on one tick', () => {
    const chord: SequencerSpec = {
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      divisor: 48,
      gate: 0.75,
      register: { octave: 3 },
      steps: [hitStep(), hitStep(), hitStep()],
    };
    expectParity(songOf(chord, 'drone-sqr'));
  });

  it('Arp: a random walk with skips, at its gate', () => {
    expectParity(
      songOf({ kind: 'arp', ...DEFAULT_ARP_CONFIG, style: 'random', skipChance: 0.2, seed: 5 }),
    );
  });

  it('Basslead: follow chord with a root bias and its density', () => {
    expectParity(
      songOf({
        kind: 'bass',
        ...DEFAULT_BASS_CONFIG,
        pitchMode: 'followChord',
        rootBias: 0.5,
        seed: 9,
      }),
    );
  });

  it('Figure: the default broken chord with skips', () => {
    expectParity(songOf({ kind: 'figure', ...DEFAULT_FIGURE_CONFIG, skipChance: 0.25, seed: 11 }));
  });
});
