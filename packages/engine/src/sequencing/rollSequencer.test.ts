/**
 * The Roll's defaults and check (windsor#599): an empty loop of one bar of
 * the song's meter, and the check refusing each field out of its range. The
 * performer (windsor#600), tick by tick: onsets at the loop position,
 * releases at the note's length or the loop's end, releases before onsets,
 * live edits, and nothing allocated on an empty tick.
 */
import { describe, expect, it } from 'vitest';

import { ROLL_NOTES_MAX } from '../audioConstants';
import type { NoteEvent } from './noteEvent';
import type { PartTickEvent } from './regionGate';
import {
  DEFAULT_ROLL_CONFIG,
  ROLL_LOOP_TICKS_MAX,
  RollSequencer,
  assertRollConfig,
  defaultRollConfig,
  type RollNote,
  type RollSequencerConfig,
} from './rollSequencer';

const NOTE: RollNote = { tick: 0, ticks: 24, pitch: 60 };

/** A local tick as the region gate hands it over; the Roll reads only `tick` and `time`. */
const at = (tick: number): PartTickEvent => ({
  tick,
  step: tick,
  bar: 0,
  tickInBar: tick,
  seconds: tick,
  secondsPerTick: 1,
  time: tick,
  chord: null,
  regionIndex: 0,
});

/** Play local ticks `from` to `to` − 1: each event as `tick:on|off:pitch`, velocity after a `@`. */
function play(roll: RollSequencer, to: number, from = 0): string[] {
  const out: string[] = [];
  for (let t = from; t < to; t++) out.push(...roll.handleTick(at(t)).map(label));
  return out;
}

const label = (e: NoteEvent): string =>
  e.kind === 'noteOn'
    ? `${e.tick}:on:${e.note}${e.velocity === undefined ? '' : `@${e.velocity}`}`
    : `${e.tick}:off:${e.note}`;

const roll = (notes: RollNote[], loopTicks = 96): RollSequencer =>
  new RollSequencer({ loopTicks, notes });

describe('the Roll config (windsor#599)', () => {
  it("defaults to no notes over one bar of the song's meter", () => {
    expect(DEFAULT_ROLL_CONFIG).toEqual({ loopTicks: 96, notes: [] });
    expect(defaultRollConfig('7/8').loopTicks).toBe(84);
    expect(defaultRollConfig('12/8').loopTicks).toBe(144);
    expect(() => assertRollConfig(DEFAULT_ROLL_CONFIG)).not.toThrow();
  });

  it('accepts every field at its bounds, a note past the loop included', () => {
    const notes: RollNote[] = [
      { tick: ROLL_LOOP_TICKS_MAX - 1, ticks: ROLL_LOOP_TICKS_MAX, pitch: 127, velocity: 0 },
      { tick: 200, ticks: 1, pitch: 0, velocity: 1 },
    ];
    expect(() => assertRollConfig({ loopTicks: 96, notes })).not.toThrow();
    const full = Array.from({ length: ROLL_NOTES_MAX }, () => NOTE);
    expect(() => assertRollConfig({ loopTicks: ROLL_LOOP_TICKS_MAX, notes: full })).not.toThrow();
  });

  it('refuses each field out of its range', () => {
    const bad: [string, object][] = [
      ['loopTicks', { loopTicks: 0, notes: [] }],
      ['loopTicks', { loopTicks: ROLL_LOOP_TICKS_MAX + 1, notes: [] }],
      ['notes', { loopTicks: 96, notes: Array.from({ length: ROLL_NOTES_MAX + 1 }, () => NOTE) }],
      ['tick', { loopTicks: 96, notes: [{ ...NOTE, tick: 1.5 }] }],
      ['ticks', { loopTicks: 96, notes: [{ ...NOTE, ticks: 0 }] }],
      ['pitch', { loopTicks: 96, notes: [{ ...NOTE, pitch: 128 }] }],
      ['velocity', { loopTicks: 96, notes: [{ ...NOTE, velocity: 1.4 }] }],
    ];
    for (const [field, config] of bad) {
      expect(() => assertRollConfig(config as never), field).toThrow(field);
    }
  });
});

describe('the Roll performer (windsor#600)', () => {
  it('starts a chord on one tick and releases it at its length, every pass', () => {
    const chord = [60, 64, 67].map((pitch) => ({ tick: 0, ticks: 24, pitch }));
    expect(play(roll(chord), 2 * 96)).toEqual([
      '0:on:60',
      '0:on:64',
      '0:on:67',
      '24:off:60',
      '24:off:64',
      '24:off:67',
      '96:on:60',
      '96:on:64',
      '96:on:67',
      '120:off:60',
      '120:off:64',
      '120:off:67',
    ]);
  });

  it("cuts a note at the loop's end, and never sounds one at or past the loop", () => {
    const notes = [
      { tick: 90, ticks: 48, pitch: 60 },
      { tick: 96, ticks: 6, pitch: 62 },
      { tick: 100, ticks: 6, pitch: 64 },
    ];
    expect(play(roll(notes), 2 * 96)).toEqual(['90:on:60', '96:off:60', '186:on:60']);
  });

  it('releases before it starts: the same pitch back to back is retriggered', () => {
    const notes = [
      { tick: 0, ticks: 12, pitch: 60 },
      { tick: 12, ticks: 12, pitch: 60 },
    ];
    expect(play(roll(notes), 24)).toEqual(['0:on:60', '12:off:60', '12:on:60']);
    // A whole-loop note meets its own next pass the same way.
    expect(play(roll([{ tick: 0, ticks: 96, pitch: 48 }]), 97)).toEqual([
      '0:on:48',
      '96:off:48',
      '96:on:48',
    ]);
  });

  it('rides the note velocity on the note-on, sends none at 1, and plays nothing at 0', () => {
    const notes = [
      { tick: 0, ticks: 6, pitch: 60, velocity: 0.5 },
      { tick: 0, ticks: 6, pitch: 62, velocity: 1 },
      { tick: 0, ticks: 6, pitch: 64, velocity: 0 },
    ];
    expect(play(roll(notes), 7)).toEqual(['0:on:60@0.5', '0:on:62', '6:off:60', '6:off:62']);
  });

  it('chases nothing: an entry mid-note waits for the next pass', () => {
    const r = roll([{ tick: 0, ticks: 48, pitch: 60 }]);
    expect(play(r, 97, 24)).toEqual(['96:on:60']);
  });

  it('plays the notes in onset order whatever order they are written in', () => {
    const notes = [
      { tick: 12, ticks: 6, pitch: 50 },
      { tick: 0, ticks: 6, pitch: 67 },
      { tick: 0, ticks: 6, pitch: 55 },
    ];
    expect(play(roll(notes), 13).filter((e) => e.includes(':on:'))).toEqual([
      '0:on:55',
      '0:on:67',
      '12:on:50',
    ]);
  });

  it('releases a held pitch before it strikes it again', () => {
    const r = roll([{ tick: 0, ticks: 90, pitch: 60 }]);
    play(r, 5);
    // Not a shape the normaliser writes; the performer still holds one voice per pitch.
    r.reconfigure({ loopTicks: 96, notes: [...r.config.notes, { tick: 10, ticks: 4, pitch: 60 }] });
    expect(play(r, 15, 5)).toEqual(['10:off:60', '10:on:60', '14:off:60']);
  });

  it('releases on the next tick a held note a live edit removes, moves or re-pitches', () => {
    const held: RollNote = { tick: 0, ticks: 48, pitch: 60 };
    const edits: RollNote[][] = [[], [{ ...held, tick: 1 }], [{ ...held, pitch: 61 }]];
    for (const notes of edits) {
      const r = roll([held]);
      play(r, 10);
      r.reconfigure({ loopTicks: 96, notes });
      expect(play(r, 11, 10), JSON.stringify(notes)).toEqual(['10:off:60']);
    }
  });

  it('keeps the scheduled release of a held note the edit keeps, whatever its new length', () => {
    const r = roll([{ tick: 0, ticks: 48, pitch: 60 }]);
    play(r, 10);
    r.reconfigure({ loopTicks: 96, notes: [{ tick: 0, ticks: 12, pitch: 60, velocity: 0.3 }] });
    expect(play(r, 49, 10)).toEqual(['48:off:60']);
  });

  it('reads a live loop length from the clock at the next tick, without a restart', () => {
    const r = roll([{ tick: 0, ticks: 6, pitch: 60 }]);
    expect(play(r, 100)).toEqual(['0:on:60', '6:off:60', '96:on:60']);
    r.reconfigure({ loopTicks: 48, notes: r.config.notes });
    // Tick 144 is position 0 of a 48-tick loop: the next onset, nothing re-entered.
    expect(play(r, 145, 100)).toEqual(['102:off:60', '144:on:60']);
    expect(r.stepAt(150)).toBe(6);
  });

  it('releases everything it holds on a region end, and only once', () => {
    const r = roll([
      { tick: 0, ticks: 96, pitch: 40 },
      { tick: 0, ticks: 96, pitch: 70 },
    ]);
    play(r, 30);
    expect(r.release(30, 30).map(label)).toEqual(['30:off:40', '30:off:70']);
    expect(r.release(31, 31)).toEqual([]);
  });

  it('reads the playhead as the loop tick', () => {
    const r = roll([], 84);
    expect([0, 83, 84, 200].map((t) => r.stepAt(t))).toEqual([0, 83, 0, 32]);
  });

  it('with no notes, plays nothing and hands back one shared empty list every tick', () => {
    const empty = new RollSequencer(DEFAULT_ROLL_CONFIG as RollSequencerConfig);
    const first = empty.handleTick(at(0));
    expect(first).toEqual([]);
    for (let t = 1; t < 4 * 96; t++) expect(empty.handleTick(at(t))).toBe(first);
    // A written roll's quiet ticks hand back the same list.
    const quiet = roll([{ tick: 0, ticks: 6, pitch: 60 }]);
    play(quiet, 7);
    expect(quiet.handleTick(at(7))).toBe(first);
  });
});
