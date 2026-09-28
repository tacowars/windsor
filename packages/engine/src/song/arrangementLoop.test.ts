/**
 * The song loop through the player and the scheduler (windsor#15, record
 * `2026-09-28-song-loop-in-the-transport`): play starts at the loop's
 * start, the clock wraps its end to its start with no gap or doubled note,
 * held notes release on the wrap, ■ rewinds to the start, a loop over the
 * whole song is today's wrap, and a live Bars edit clamps the loop or turns
 * it off.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, slotMap } from '../__fixtures__/fullArrangement';
import { fourParts } from '../__fixtures__/playerRig';
import type { RecordingPart } from '../__fixtures__/recordingPart';
import { PRESETS } from '../patch/presets';
import { hitStep } from '../sequencing/chordSequencer';
import { Scheduler, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import type { Arrangement, SongLoop, Swing } from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';

const BAR = TICKS_PER_BAR;
const BARS = 12;
/** Bars 5–9: the clock plays bars 5, 6, 7 and 8, then bar 5 again. */
const LOOP: SongLoop = { start: 4 * BAR, end: 8 * BAR, on: true };
const SPAN = LOOP.end - LOOP.start;
const BPM = 120;

/**
 * Twelve bars over one chord. The drone holds a six-bar hit from bar 5 (its
 * region's entry), so the hit is still sounding at the loop's end; the arp is
 * the whole-song (∞) line. Kick and hat are silent.
 */
function looped(loop?: SongLoop, swing?: Swing): Arrangement {
  const [kick, hat, arp, drone] = FULL_ARRANGEMENT.parts as [
    (typeof FULL_ARRANGEMENT.parts)[number],
    (typeof FULL_ARRANGEMENT.parts)[number],
    (typeof FULL_ARRANGEMENT.parts)[number],
    (typeof FULL_ARRANGEMENT.parts)[number],
  ];
  return {
    transport: {
      bpm: BPM,
      bars: BARS,
      ...(swing && { swing }),
      ...(loop && { loop }),
    },
    harmony: {
      ...FULL_ARRANGEMENT.harmony,
      events: [{ start: 0, duration: BARS * BAR, degree: 0, size: 3 }],
    },
    parts: [
      { ...kick, regions: [] },
      { ...hat, regions: [] },
      { ...arp, regions: [{ start: 0, duration: BARS * BAR }] },
      {
        ...drone,
        regions: [{ start: 4 * BAR, duration: 8 * BAR }],
        sequencer: { ...FULL_PARTS.drone.sequencer, steps: [hitStep({ duration: 6 })] },
      },
    ],
  };
}

interface Run {
  scheduler: Scheduler;
  player: ArrangementPlayer;
  parts: Record<'kick' | 'hat' | 'arp' | 'drone', RecordingPart>;
  ticks: Array<{ tick: number; time: number }>;
  /** Queue `bars` bars of ticks from where the transport is. */
  play(bars: number): void;
}

function run(arrangement: Arrangement): Run {
  const clock = { currentTime: 0 };
  const scheduler = new Scheduler(clock, { bpm: BPM, lookAhead: 0 });
  const parts = fourParts();
  const player = new ArrangementPlayer(scheduler, slotMap(parts), arrangement, PRESETS);
  const ticks: Run['ticks'] = [];
  scheduler.subscribe(1, (e) => ticks.push({ tick: e.tick, time: e.time }));
  const play = (bars: number): void => {
    if (!scheduler.isRunning) scheduler.start(scheduler.transport.currentTick);
    const until = ticks.length + bars * BAR;
    while (ticks.length < until) {
      clock.currentTime += scheduler.transport.secondsPerTick;
      scheduler.update();
    }
    ticks.length = Math.min(ticks.length, until);
  };
  return { scheduler, player, parts, ticks, play };
}

/** Every note-on and note-off as `on 62 @n`, n ticks after `origin`, in call order. */
const calls = (part: RecordingPart, seconds: number, origin = 0): string[] =>
  part.calls
    .filter((c) => c.kind === 'noteOn' || c.kind === 'noteOffByNote')
    .map((c) => {
      const at = Math.round(((c.time ?? 0) - origin) / seconds);
      return `${c.kind === 'noteOn' ? 'on' : 'off'} ${c.note} @${at}`;
    });

/** Fails on a note-on for a note already held: a doubled note. */
function assertNoDoubles(part: RecordingPart): void {
  const held = new Set<number>();
  for (const c of part.calls) {
    if (c.kind === 'noteOn') {
      expect(held.has(c.note!), `note ${c.note} doubled at ${c.time}`).toBe(false);
      held.add(c.note!);
    } else if (c.kind === 'noteOffByNote') {
      held.delete(c.note!);
    }
  }
}

describe('a loop on bars 5–9', () => {
  it('starts play at bar 5 and wraps 9 → 5 with no gap', () => {
    const r = run(looped(LOOP));
    expect(r.scheduler.transport.currentTick).toBe(LOOP.start);
    r.play(10);
    const expected = Array.from({ length: 10 * BAR }, (_, i) => LOOP.start + (i % SPAN));
    expect(r.ticks.map((t) => t.tick)).toEqual(expected);
    const step = r.scheduler.transport.secondsPerTick;
    for (let i = 1; i < r.ticks.length; i++) {
      expect(r.ticks[i]!.time - r.ticks[i - 1]!.time).toBeCloseTo(step, 9);
    }
  });

  it('releases the note held past the end on the wrap, then re-enters, never doubling', () => {
    const r = run(looped(LOOP));
    r.play(10);
    const step = r.scheduler.transport.secondsPerTick;
    const drone = calls(r.parts.drone, step, r.ticks[0]!.time);
    const first = drone.filter((c) => c.endsWith('@0'));
    const wrap = drone.filter((c) => c.endsWith(`@${SPAN}`));
    // Three chord tones on at bar 5; at the wrap the same three off, then on again.
    expect(first).toHaveLength(3);
    expect(wrap).toEqual([
      ...first.map((c) => c.replace('on', 'off').replace('@0', `@${SPAN}`)),
      ...first.map((c) => c.replace('@0', `@${SPAN}`)),
    ]);
    assertNoDoubles(r.parts.drone);
    assertNoDoubles(r.parts.arp);
  });

  it('replays every pass alike, the ∞ line included', () => {
    const r = run(looped(LOOP));
    r.play(12);
    const step = r.scheduler.transport.secondsPerTick;
    const pass = (part: RecordingPart, n: number): string[] =>
      calls(part, step, r.ticks[0]!.time)
        .map((c) => /^(\w+ \d+) @(\d+)$/.exec(c)!)
        .filter((m) => Math.floor(Number(m[2]) / SPAN) === n)
        .map((m) => `${m[1]} @${Number(m[2]) - n * SPAN}`);
    expect(pass(r.parts.arp, 1).length).toBeGreaterThan(0);
    expect(pass(r.parts.arp, 2)).toEqual(pass(r.parts.arp, 1));
    expect(pass(r.parts.drone, 2)).toEqual(pass(r.parts.drone, 1));
  });

  it('keeps swing pairs on the grid across the wrap', () => {
    const r = run(looped(LOOP, { amount: 66, grid: 8 }));
    r.play(8);
    // A whole number of beats, so a pass lasts exactly its straight length.
    const passSeconds = SPAN * r.scheduler.transport.secondsPerTick;
    expect(r.ticks[SPAN]!.tick).toBe(LOOP.start);
    expect(r.ticks[SPAN]!.time - r.ticks[0]!.time).toBeCloseTo(passSeconds, 9);
    expect(r.ticks[SPAN + 1]!.time - r.ticks[SPAN]!.time).toBeCloseTo(
      r.ticks[1]!.time - r.ticks[0]!.time,
      12,
    );
  });

  it('rewinds ■ to the loop start, and the playhead reads it', () => {
    const r = run(looped(LOOP));
    r.play(6);
    r.scheduler.stop();
    r.player.releaseAll();
    r.scheduler.reset();
    r.player.reset();
    expect(r.scheduler.transport.currentTick).toBe(LOOP.start);
    expect(r.scheduler.audibleTick(0)).toBe(LOOP.start);
  });

  it('moves the rest position with a live loop edit, and leaves a paused one alone', () => {
    const r = run(looped({ ...LOOP, on: false }));
    expect(r.scheduler.transport.currentTick).toBe(0);
    r.player.apply({ transport: { loop: { on: true } } });
    expect(r.scheduler.transport.currentTick).toBe(LOOP.start);
    r.play(1);
    r.scheduler.stop();
    r.player.apply({ transport: { loop: { on: false } } });
    expect(r.scheduler.transport.currentTick).toBe(LOOP.start + BAR);
    expect(r.scheduler.loop).toBeNull();
  });
});

describe('loop off, absent, or over the whole song', () => {
  const trace = (arrangement: Arrangement): string[] => {
    const transport = new TickTransport(BPM);
    const parts = fourParts();
    const player = new ArrangementPlayer(transport, slotMap(parts), arrangement, PRESETS);
    for (let i = 0; i < 2 * BARS * BAR; i++) transport.advance(transport.transportSeconds);
    player.dispose();
    const step = transport.secondsPerTick;
    return [...calls(parts.arp, step), ...calls(parts.drone, step)];
  };

  it('plays exactly as a song without one', () => {
    const plain = trace(looped());
    expect(plain.length).toBeGreaterThan(0);
    expect(trace(looped({ ...LOOP, on: false }))).toEqual(plain);
    expect(trace(looped({ start: 0, end: BARS * BAR, on: true }))).toEqual(plain);
  });
});

describe('a live Bars edit', () => {
  it('clamps the loop to the song, and turns it off when nothing is left', () => {
    const r = run(looped(LOOP));
    r.player.apply({ transport: { bars: 6 } });
    expect(r.player.arrangement.transport.loop).toEqual({ start: 4 * BAR, end: 6 * BAR, on: true });
    expect(r.scheduler.loop).toEqual({ start: 4 * BAR, end: 6 * BAR, songTicks: 6 * BAR });
    r.player.apply({ transport: { bars: 4 } });
    expect(r.player.arrangement.transport.loop).toEqual({ start: 0, end: 4 * BAR, on: false });
    expect(r.scheduler.loop).toBeNull();
    expect(r.scheduler.transport.currentTick).toBe(0);
  });
});
