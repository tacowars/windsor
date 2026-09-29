/**
 * A song whose regions carry no pattern plays exactly as it did before
 * windsor#74 (epic windsor#70, record
 * `2026-09-29-each-region-plays-its-own-pattern`): every region without a
 * pattern shares the one generator `part.sequencer` builds, which is the one
 * generator a part had. The trace below was read on `main` before the
 * change (c0b2776) and is pinned by its digest: every call every part
 * receives, tick for tick, through region entries and ends, a song wrap
 * and live edits of the regions, the patterns, a divisor and a seed.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS } from '../__fixtures__/fullArrangement';
import { recordingPart, type RecordingPart } from '../__fixtures__/recordingPart';
import { patternOf } from '../__fixtures__/regionPatternSongs';
import type {
  Arrangement,
  ArrangementPartial,
  MusicPart,
  Region,
  RegionPattern,
} from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';
import { PRESETS } from '../patch/presets';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DIVISORS, PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
/** Two regions back to back, a gap, and a third: entries, ends and a boundary. */
const SPLIT: Region[] = [
  { start: 0, duration: BAR },
  { start: BAR, duration: BAR },
  { start: 3 * BAR, duration: BAR },
];
const HALVES: Region[] = [
  { start: 0, duration: 2 * BAR },
  { start: 2 * BAR, duration: 2 * BAR },
];

/** Five parts, one of each kind, every one in several regions. */
const SONG: Arrangement = {
  ...FULL_ARRANGEMENT,
  parts: [
    { ...FULL_PARTS.kick, regions: SPLIT },
    {
      ...FULL_PARTS.hat,
      regions: HALVES,
      sequencer: {
        kind: 'bass',
        ...DEFAULT_BASS_CONFIG,
        divisor: DIVISORS.eighth,
        density: 0.6,
        seed: 5,
      },
    },
    { ...FULL_PARTS.arp, regions: SPLIT },
    { ...FULL_PARTS.drone, regions: HALVES },
    {
      ...FULL_PARTS.arp,
      slot: 4,
      name: 'arp 2',
      regions: [{ start: BAR / 2, duration: 3 * BAR }],
      sequencer: {
        kind: 'arp',
        ...DEFAULT_ARP_CONFIG,
        style: 'random',
        divisor: DIVISORS.eighth,
        octaves: 2,
        seed: 3,
      },
    },
  ],
};

interface Played {
  player: ArrangementPlayer;
  parts: Map<number, RecordingPart>;
  run(bars: number): void;
}

function play(arrangement: Arrangement): Played {
  const transport = new TickTransport(120);
  const parts = new Map(arrangement.parts.map((part) => [part.slot, recordingPart()]));
  const player = new ArrangementPlayer(transport, parts, arrangement, PRESETS);
  const run = (bars: number): void => {
    for (let i = 0; i < bars * BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { player, parts, run };
}

const tickOf = (time: number): number =>
  Math.round((time * FULL_ARRANGEMENT.transport.bpm * PPQ) / SECONDS_PER_MINUTE);

/** Every call of every part, in slot order, with the tick it lands on. */
function trace(played: Played): string {
  return [...played.parts]
    .flatMap(([slot, part]) =>
      part.calls.map((call) => {
        const { time, ...rest } = call;
        return `${slot} @${time === undefined ? '' : tickOf(time)} ${JSON.stringify(rest)}`;
      }),
    )
    .join('\n');
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

const regionsEdit = (slot: number, regions: Region[]): ArrangementPartial => ({
  parts: { [slot]: { regions } },
});
const sequencerEdit = (slot: number, sequencer: Record<string, unknown>): ArrangementPartial => ({
  parts: { [slot]: { sequencer } },
});

/** The scripted performance: play, edit live, play on. */
function perform(arrangement: Arrangement): Played {
  const played = play(arrangement);
  const apply = (partial: ArrangementPartial): void => {
    expect(played.player.apply(partial).ok).toBe(true);
  };
  played.run(3);
  // A region split under the playhead, and one moved.
  apply(regionsEdit(3, [...SPLIT]));
  apply(
    regionsEdit(0, [
      { start: 0, duration: 2 * BAR },
      { start: 3 * BAR, duration: BAR },
    ]),
  );
  played.run(2);
  // Pattern edits that reconfigure live.
  apply(sequencerEdit(2, { steps: FULL_PARTS.arp.sequencer.steps.slice().reverse() }));
  apply(sequencerEdit(3, { gate: 0.5 }));
  apply(sequencerEdit(0, { rotate: 3 }));
  apply(sequencerEdit(4, { style: 'upDown' }));
  played.run(3);
  // A divisor and a seed: rebuilds.
  apply(sequencerEdit(2, { divisor: DIVISORS.sixteenth }));
  apply(sequencerEdit(1, { seed: 9 }));
  played.run(4);
  return played;
}

describe('a song without region patterns (windsor#74)', () => {
  it('plays tick for tick what it played on main before region patterns', () => {
    const played = perform(SONG);
    const text = trace(played);
    expect(text.split('\n').length).toBe(PINNED_CALLS);
    expect(digest(text)).toBe(PINNED_DIGEST);
  });

  it('plays the same as the song whose every region holds a copy of its part’s sequencer', () => {
    const copied: Arrangement = {
      ...SONG,
      parts: SONG.parts.map((part): MusicPart => ({
        ...part,
        regions: part.regions.map((region) => ({
          ...region,
          pattern: patternOf(part.sequencer) as RegionPattern,
        })),
      })),
    };
    const plain = play(SONG);
    const own = play(copied);
    plain.run(12);
    own.run(12);
    expect(trace(own)).toBe(trace(plain));
  });
});

/** Read on main at c0b2776, before windsor#74. */
const PINNED_CALLS = 478;
const PINNED_DIGEST = '2bc8041ea1ca2609425d64823ed828a946e0b1dae079357a8d288bb868b9c1d8';
