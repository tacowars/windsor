/**
 * `ArrangementPlayer.regionStepAt` (windsor#97): where one region's pattern
 * is at a transport tick, whether the playhead is in that region or not.
 * Inside it the answer is `stepAt`'s, and the step the performer sounds;
 * outside it the pattern runs on from the region's last start, so the grid
 * card's ghost playhead steps in time and lands on the first step as the
 * song enters the region. Across a loop's jump the query and the performer
 * still agree, because both fold the transport tick through the same rule.
 *
 * The song: four bars, the arp slot a grid ladder (one semitone per degree,
 * so a sounded note names the step that wrote it) in two adjacent regions —
 * bars 1–2 playing the part's eight-step line, bar 3 its own three-step
 * line — and bar 4 empty.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT, onlyParts, slotMap } from '../__fixtures__/fullArrangement';
import { fourParts } from '../__fixtures__/playerRig';
import type { RecordingPart } from '../__fixtures__/recordingPart';
import { PRESETS } from '../patch/presets';
import { gridNote } from '../sequencing/gridSequencer';
import { DIVISORS, Scheduler, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { Arrangement, GridSpec, MusicPart, SongLoop } from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const { arp } = FULL_SLOT;
const EIGHTH = DIVISORS.eighth;
/** C3: pitch class 0 at register octave 3, so the note minus this is the degree. */
const LADDER_ROOT = 48;

const ladder = (degrees: number[]): Omit<GridSpec, 'seed'> => ({
  kind: 'grid',
  divisor: EIGHTH,
  steps: degrees.map((degree) => gridNote(degree)),
  length: degrees.length,
  skipChance: 0,
  accentVelocity: 0.2,
  accentMod: 1,
  register: { octave: 3 },
  lanes: [],
});

const LONG = ladder([0, 1, 2, 3, 4, 5, 6, 7]);
/** Region 1's own line: degrees 8–10, so its notes never collide with region 0's. */
const SHORT = ladder([8, 9, 10]);
const A = { start: 0, duration: 2 * BAR };
const B = { start: 2 * BAR, duration: BAR };

function song(loop?: SongLoop): Arrangement {
  const base = onlyParts(FULL_ARRANGEMENT, 'arp');
  const part = base.parts[0] as MusicPart;
  return {
    ...base,
    transport: { ...base.transport, bars: 4, ...(loop && { loop }) },
    harmony: { ...base.harmony, root: 0, scale: Array.from({ length: 12 }, (_, i) => i) },
    parts: [
      {
        ...part,
        sequencer: { ...LONG, seed: 0 },
        regions: [A, { ...B, pattern: SHORT }],
      },
    ],
  };
}

/** A player on a real scheduler, and the transport ticks the clock issued, in order. */
function run(arrangement: Arrangement): {
  player: ArrangementPlayer;
  part: RecordingPart;
  ticks: Array<{ tick: number; time: number }>;
  play(bars: number): void;
} {
  const clock = { currentTime: 0 };
  const scheduler = new Scheduler(clock, { bpm: arrangement.transport.bpm, lookAhead: 0 });
  const parts = fourParts();
  const player = new ArrangementPlayer(scheduler, slotMap(parts), arrangement, PRESETS);
  const ticks: Array<{ tick: number; time: number }> = [];
  scheduler.subscribe(1, (e) => ticks.push({ tick: e.tick, time: e.time }));
  const play = (bars: number): void => {
    scheduler.start(scheduler.transport.currentTick);
    const until = ticks.length + bars * BAR;
    while (ticks.length < until) {
      clock.currentTime += scheduler.transport.secondsPerTick;
      scheduler.update();
    }
  };
  return { player, part: parts.arp, ticks, play };
}

describe('ArrangementPlayer.regionStepAt (windsor#97)', () => {
  it('inside its region: live, and exactly stepAt’s step, over two song iterations', () => {
    const { player } = run(song());
    for (let tick = 0; tick < 2 * SONG; tick++) {
      const songTick = tick % SONG;
      for (const [index, region] of [A, B].entries()) {
        const inside = songTick >= region.start && songTick < region.start + region.duration;
        if (!inside) continue;
        expect(player.regionStepAt(arp, index, tick), `tick ${tick}`).toEqual({
          step: player.stepAt(arp, tick),
          live: true,
        });
      }
    }
  });

  it('outside its region: not live, running on from the region’s last start', () => {
    const { player } = run(song());
    // Region 0 has ended: its eight eighths carry on from bar 1.
    expect(player.regionStepAt(arp, 0, 2 * BAR)).toEqual({ step: 0, live: false });
    expect(player.regionStepAt(arp, 0, 2 * BAR + EIGHTH)).toEqual({ step: 1, live: false });
    expect(player.regionStepAt(arp, 0, SONG - 1)).toEqual({ step: 7, live: false });
    // The song wraps into it: bright, on the first step.
    expect(player.regionStepAt(arp, 0, SONG)).toEqual({ step: 0, live: true });
    // Region 1 before it starts: its three-step line from its last start, bar 3 of the pass before.
    const phase = (tick: number): number => Math.floor((tick - B.start + SONG) / EIGHTH) % 3;
    expect(player.regionStepAt(arp, 1, 0)).toEqual({ step: phase(0), live: false });
    expect(player.regionStepAt(arp, 1, B.start - 1)).toEqual({
      step: phase(B.start - 1),
      live: false,
    });
    // Entered: the first step, bright, whatever the ghost was on.
    expect(player.regionStepAt(arp, 1, B.start)).toEqual({ step: 0, live: true });
    // In the empty bar 4 both are ghosts, still stepping.
    expect(player.regionStepAt(arp, 1, 3 * BAR + EIGHTH)).toEqual({ step: 0, live: false });
    expect(player.regionStepAt(arp, 1, 3 * BAR + 2 * EIGHTH)).toEqual({ step: 1, live: false });
  });

  it('answers the step the performer sounds, across a loop’s jump', () => {
    // Bars 2–3: the clock plays bar 2 (region 0), bar 3 (region 1), then bar 2 again.
    const loop: SongLoop = { start: BAR, end: 3 * BAR, on: true };
    const r = run(song(loop));
    r.play(6);
    const tickAt = new Map(r.ticks.map((t) => [t.time, t.tick]));
    expect(r.ticks.map((t) => t.tick).some((tick, i, all) => i > 0 && tick < all[i - 1]!)).toBe(
      true,
    );
    const notes = r.part.calls.filter((call) => call.kind === 'noteOn');
    expect(notes.length).toBe((6 * BAR) / EIGHTH);
    for (const call of notes) {
      const tick = tickAt.get(call.time ?? -1) as number;
      const index = tick % SONG < B.start ? 0 : 1;
      const lines = [LONG, SHORT] as const;
      const step = lines[index].steps.findIndex(
        (s) => s.kind === 'note' && s.degree === (call.note ?? 0) - LADDER_ROOT,
      );
      expect(r.player.regionStepAt(arp, index, tick), `tick ${tick}`).toEqual({ step, live: true });
    }
    // The ghost of the region the loop is not in keeps stepping through the jump.
    const ghost = r.ticks
      .filter((t) => t.tick % EIGHTH === 0 && t.tick < B.start)
      .map((t) => r.player.regionStepAt(arp, 1, t.tick));
    expect(ghost.every((g) => g?.live === false)).toBe(true);
    expect(new Set(ghost.map((g) => g?.step)).size).toBe(3);
  });

  it('is null for an index naming no region, an absent slot, or a none part', () => {
    const { player } = run(song());
    expect(player.regionStepAt(arp, 2, 0)).toBeNull();
    expect(player.regionStepAt(arp + 1, 0, 0)).toBeNull();
    const silent = run({
      ...song(),
      parts: [{ ...(song().parts[0] as MusicPart), sequencer: { kind: 'none' } }],
    });
    expect(silent.player.regionStepAt(arp, 0, 0)).toBeNull();
  });
});
