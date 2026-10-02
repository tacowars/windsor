/**
 * A held Chord Player hit that follows the harmony (windsor#333): the shared
 * tones stay, the voices that must move step to the nearest new chord tone on
 * the tick the chord changes, offs before ons; with `follow` off a hit keeps
 * its notes to its end (#705).
 */
import { describe, expect, it } from 'vitest';

import type { Harmony, HarmonyEvent } from '../harmony/harmonyTimeline';
import {
  ChordSequencer,
  DEFAULT_CHORD_CONFIG,
  hitStep,
  type ChordSequencerConfig,
} from './chordSequencer';
import type { NoteEvent } from './noteEvent';
import { RegionGate } from './regionGate';
import { ScaleSampler } from './scaleSampler';
import { DIVISORS, TickTransport } from './scheduler';

const BAR = DIVISORS.whole;
const SONG_TICKS = 4 * BAR;
const C_MAJOR: Omit<Harmony, 'events'> = { root: 0, scale: 'major' };

/** A chord on `degree` from `start` (a triad unless `size` says otherwise). */
const at = (start: number, degree: number, over: Partial<HarmonyEvent> = {}): HarmonyEvent => ({
  start,
  duration: 0,
  degree,
  size: 3,
  ...over,
});

/** Contiguous durations, so the timeline reads as written. */
function timeline(...events: HarmonyEvent[]): HarmonyEvent[] {
  return events.map((event, i) => ({
    ...event,
    duration: (events[i + 1]?.start ?? SONG_TICKS) - event.start,
  }));
}

/** I for two bars, V for two. */
const I_V = timeline(at(0, 0), at(2 * BAR, 4));

interface Rig {
  seq: ChordSequencer;
  gate: RegionGate;
  out: NoteEvent[];
  /** Advance to (and including) local tick `to`. */
  until(to: number): void;
  /** What was emitted on `tick`, as `off 60` / `on 59`. */
  on(tick: number): string[];
}

/** One four-bar hit in C major at C4, following unless `follow: false` is passed. */
function rig(events: readonly HarmonyEvent[], extra: Partial<ChordSequencerConfig> = {}): Rig {
  const seq = new ChordSequencer(new ScaleSampler(C_MAJOR), {
    ...DEFAULT_CHORD_CONFIG,
    divisor: BAR,
    register: { octave: 4 },
    steps: [hitStep({ duration: 4 })],
    follow: true,
    ...extra,
  });
  const transport = new TickTransport(120);
  const gate = new RegionGate(transport, {
    regions: [{ start: 0, duration: SONG_TICKS }],
    songTicks: SONG_TICKS,
    harmony: { ...C_MAJOR, events },
  });
  const out: NoteEvent[] = [];
  seq.onNote = (e) => out.push(e);
  seq.attach(gate);
  let next = 0;
  return {
    seq,
    gate,
    out,
    until(to) {
      for (; next <= to; next++) transport.advance(0);
    },
    on: (tick) =>
      out
        .filter((e) => e.tick === tick)
        .map((e) => `${e.kind === 'noteOn' ? 'on' : 'off'} ${e.note}`),
  };
}

describe('ChordSequencer follow (windsor#333)', () => {
  it('off: a hit over I → V emits nothing at the change and keeps C E G (#705)', () => {
    const r = rig(I_V, { follow: false });
    r.until(4 * BAR - 1);
    expect(r.on(2 * BAR)).toEqual([]);
    expect(r.seq.heldNotes).toEqual([60, 64, 67]);
  });

  it('on: C E G becomes B D G on the change tick — G untouched, offs before ons', () => {
    const r = rig(I_V);
    r.until(4 * BAR - 1);
    expect(r.on(0)).toEqual(['on 60', 'on 64', 'on 67']);
    expect(r.on(2 * BAR)).toEqual(['off 60', 'off 64', 'on 59', 'on 62']);
    expect(r.out.filter((e) => e.tick > 0 && e.tick !== 2 * BAR)).toEqual([]);
    expect(r.seq.heldNotes).toEqual([59, 62, 67]);
    expect(r.out.at(-1)).toMatchObject({ kind: 'noteOn', degree: 4 });
    expect(r.out.some((e) => e.kind === 'noteOn' && (e.accent || e.slide))).toBe(false);
  });

  it('C → A minor holds C and E and moves G up to A; C → F moves E to F and G to A', () => {
    const toVi = rig(timeline(at(0, 0), at(BAR, 5)));
    toVi.until(2 * BAR);
    expect(toVi.on(BAR)).toEqual(['off 67', 'on 69']);
    const toIv = rig(timeline(at(0, 0), at(BAR, 3)));
    toIv.until(2 * BAR);
    expect(toIv.on(BAR)).toEqual(['off 64', 'off 67', 'on 65', 'on 69']);
    expect(toIv.seq.heldNotes).toEqual([60, 65, 69]);
  });

  it('a voice equidistant from two targets moves down', () => {
    // ii (D F A) → I: D is a tone from C and from E, and takes C.
    const r = rig(timeline(at(0, 1), at(BAR, 0)));
    r.until(BAR);
    expect(r.seq.heldNotes).toEqual([60, 64, 67]);
    expect(r.on(BAR)).toEqual(['off 62', 'off 65', 'off 69', 'on 60', 'on 64', 'on 67']);
  });

  it('the same chord restated, or a quality edit that keeps the stack, emits nothing', () => {
    const restated = rig(timeline(at(0, 0), at(BAR, 0), at(2 * BAR, 0, { quality: 'maj' })));
    restated.until(4 * BAR - 1);
    expect(restated.out.filter((e) => e.tick > 0)).toEqual([]);
  });

  it('a seventh under three voices leaves a tone out; a triad under four doubles one', () => {
    const seventh = rig(timeline(at(0, 0), at(BAR, 6, { size: 4 })));
    seventh.until(BAR);
    // vii7 is B D F A: all three voices move, D goes unsounded.
    expect(seventh.seq.heldNotes).toEqual([59, 65, 69]);
    const triad = rig(timeline(at(0, 0, { size: 4 }), at(BAR, 4)));
    triad.until(BAR);
    // Cmaj7 → G: C goes down to B, an octave under the held B.
    expect(triad.seq.heldNotes).toEqual([59, 62, 67, 71]);
  });

  it('gate 0.5: the voices move, and the gate end releases the moved notes', () => {
    const r = rig(timeline(at(0, 0), at(BAR, 4)), { gate: 0.5 });
    r.until(2 * BAR);
    expect(r.on(BAR)).toEqual(['off 60', 'off 64', 'on 59', 'on 62']);
    expect(r.on(2 * BAR)).toEqual(['off 59', 'off 62', 'off 67']);
    expect(r.seq.heldNotes).toEqual([]);
  });

  it('release() lets go of the moved notes, not the originals', () => {
    const r = rig(I_V);
    r.until(2 * BAR);
    expect(r.seq.release(2 * BAR + 1, 0).map((e) => e.note)).toEqual([59, 62, 67]);
    expect(r.seq.heldNotes).toEqual([]);
  });

  it('a key change moves the voices on the tick it arrives; with follow off it waits', () => {
    for (const follow of [true, false]) {
      const r = rig(timeline(at(0, 0)), { follow });
      r.until(BAR);
      // D major, as the player sends it: the gate's harmony and the sampler together.
      const d = { root: 2, scale: 'major' } as const;
      r.gate.reconfigure({
        regions: [{ start: 0, duration: SONG_TICKS }],
        songTicks: SONG_TICKS,
        harmony: { ...d, events: timeline(at(0, 0)) },
      });
      r.seq.reconfigure(r.seq.config, new ScaleSampler(d));
      r.until(BAR + 1);
      expect(r.on(BAR + 1)).toEqual(
        follow ? ['off 60', 'off 64', 'off 67', 'on 62', 'on 66', 'on 69'] : [],
      );
    }
  });

  it('a scale change alone is a chord change: C major → C minor moves E to E♭', () => {
    const r = rig(timeline(at(0, 0)));
    r.until(BAR);
    const minor = { root: 0, scale: 'naturalMinor' } as const;
    r.gate.reconfigure({
      regions: [{ start: 0, duration: SONG_TICKS }],
      songTicks: SONG_TICKS,
      harmony: { ...minor, events: timeline(at(0, 0)) },
    });
    r.seq.reconfigure(r.seq.config, new ScaleSampler(minor));
    r.until(BAR + 1);
    expect(r.on(BAR + 1)).toEqual(['off 64', 'on 63']);
  });

  it('no chord leaves the notes held; an empty pattern releases as today', () => {
    const r = rig(I_V);
    r.until(BAR);
    r.gate.reconfigure({
      regions: [{ start: 0, duration: SONG_TICKS }],
      songTicks: SONG_TICKS,
      harmony: { ...C_MAJOR, events: [] },
    });
    r.until(3 * BAR);
    expect(r.out.filter((e) => e.tick > 0)).toEqual([]);
    expect(r.seq.heldNotes).toEqual([60, 64, 67]);
    r.seq.reconfigure({ ...r.seq.config, steps: [] });
    r.until(3 * BAR + 1);
    expect(r.on(3 * BAR + 1)).toEqual(['off 60', 'off 64', 'off 67']);
  });

  it('turning follow on or off mid-hold emits nothing; on takes effect at the next change', () => {
    // I; V at bar 1 while follow is off; IV at bar 2 with it on; ii at bar 3 with it off again.
    const r = rig(timeline(at(0, 0), at(BAR, 4), at(2 * BAR, 3), at(3 * BAR, 1)), {
      follow: false,
    });
    r.until(1.5 * BAR);
    r.seq.reconfigure({ ...r.seq.config, follow: true });
    r.until(2 * BAR - 1);
    expect(r.out.filter((e) => e.tick > 0)).toEqual([]);
    // The C E G still held from I, under IV: C held, E → F, G → A.
    r.until(2 * BAR);
    expect(r.on(2 * BAR)).toEqual(['off 64', 'off 67', 'on 65', 'on 69']);
    r.until(2.5 * BAR);
    r.seq.reconfigure({ ...r.seq.config, follow: false });
    r.until(4 * BAR - 1);
    expect(r.out.filter((e) => e.tick > 2 * BAR)).toEqual([]);
    expect(r.seq.heldNotes).toEqual([60, 65, 69]);
  });

  it('an onset is unchanged: the next hit is voiced afresh, offs before ons', () => {
    const r = rig(I_V, { steps: [hitStep({ duration: 2 })] });
    r.until(2 * BAR);
    expect(r.on(2 * BAR)).toEqual(['off 60', 'off 64', 'off 67', 'on 67', 'on 71', 'on 74']);
  });
});
