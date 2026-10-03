/**
 * A song with no `ratchet` anywhere plays exactly what it played before Grid
 * and Arp ratchets (windsor#366, decision 7): every call a Grid part and an
 * Arp part make over eight bars of a swung, looping song with rests, ties,
 * slides, accents, skips, a lane and a region gap, digested. The digests
 * were read from `main` before the ratchet change, so any drift in what a
 * plain step plays fails here.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, ArpSpec, GridSpec } from './arrangement';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { arpNote } from '../sequencing/arpSteps';
import { gridNote, type GridStep } from '../sequencing/gridSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const REST = { kind: 'rest' } as const;
const TIE = { kind: 'tie' } as const;

const GRID_STEPS: GridStep[] = [
  gridNote(0, { accent: true }),
  TIE,
  gridNote(2, { slide: true }),
  REST,
  gridNote(4, { octave: 1 }),
  gridNote(4, { slide: true }),
  gridNote(1, { slide: true, accent: true }),
  TIE,
  gridNote(5),
  REST,
  gridNote(3, { octave: -1 }),
  gridNote(6),
];

const GRID: GridSpec = {
  ...FULL_PARTS.arp.sequencer,
  divisor: 6,
  steps: GRID_STEPS,
  length: 11,
  skipChance: 0.25,
  lanes: [{ param: 'filter.cutoff', values: GRID_STEPS.map((_, i) => (i % 3) / 3) }],
};

const ARP_CELLS = [
  arpNote({ accent: true }),
  arpNote(),
  TIE,
  arpNote({ slide: true }),
  REST,
  arpNote({ octave: 1 }),
  arpNote({ slide: true, accent: true }),
  arpNote(),
];

const ARP: ArpSpec = {
  kind: 'arp',
  ...DEFAULT_ARP_CONFIG,
  style: 'upDown',
  divisor: 6,
  gate: 0.5,
  octaves: 2,
  retrigger: true,
  skipChance: 0.2,
  seed: 7,
  steps: DEFAULT_ARP_CONFIG.steps.map((cell, i) => ARP_CELLS[i % ARP_CELLS.length] ?? cell),
};

/** Swung, looping over bars 2–4, the part out for half of bar 2. */
function song(sequencer: GridSpec | ArpSpec): Arrangement {
  const base: Arrangement = {
    ...FULL_ARRANGEMENT,
    transport: {
      ...FULL_ARRANGEMENT.transport,
      swing: { amount: 62, grid: 16 },
      loop: { start: BAR, end: 4 * BAR, on: true },
    },
  };
  return withPart(base, 'arp', {
    regions: [
      { start: 0, duration: BAR + BAR / 2 },
      { start: 2 * BAR, duration: 2 * BAR },
    ],
    sequencer,
  });
}

/** What the part's calls hash to, times to the nanosecond. */
function digest(calls: readonly Call[]): string {
  const rounded = calls.map((c) => ({ ...c, time: Math.round((c.time ?? 0) * 1e9) }));
  return createHash('sha256').update(JSON.stringify(rounded)).digest('hex').slice(0, 16);
}

function play(sequencer: GridSpec | ArpSpec): { count: number; digest: string } {
  const r = rig(song(sequencer));
  r.run(8);
  const calls = r.parts.arp.calls;
  return { count: calls.length, digest: digest(calls) };
}

describe('a song with no ratchet plays as before (windsor#366)', () => {
  it('a Grid part', () => {
    // Re-pinned for windsor#419: the cutoff lane's note-on step arrays moved
    // from the 24-slot step layout to the 30-target table (cutoff from slot 1
    // to code 0). Remapped onto the new codes, every call matched `main`'s.
    // Re-pinned for windsor#559: the table grew to 38 rows, so a note-on's
    // step array carries eight trailing zeros for the macro rows; every call
    // otherwise matched.
    expect(play(GRID)).toEqual({ count: 84, digest: 'd00c74d8db900434' });
  });

  it('an Arp part', () => {
    expect(play(ARP)).toEqual({ count: 146, digest: 'db9e2f35e3ffb29b' });
  });
});
