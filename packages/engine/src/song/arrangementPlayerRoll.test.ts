/**
 * The Roll through the player (windsor#600, record `2026-10-04-roll-sequencer`):
 * the fixture's drone part (slot 3, Vel 0.8) played as a Roll in a 4-bar song.
 * A loop repeats across its region and is cut by the region's end, a note's
 * velocity scales the part's, a seek chases nothing, live edits play on
 * without a restart, and the playhead is the loop tick. An overlap slides
 * (windsor#739): the player's calls, replayed on an `AudioPart` into a mono
 * processor, keep one voice, retargeted, through the slid-from note's off.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT, onlyParts, withPart } from '../__fixtures__/fullArrangement';
import { rig, type Rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import {
  loadProcessor,
  render,
  type ProcessorLike,
  type ScheduledEvent,
} from '../__fixtures__/workletHarness';
import { makeEnvelope, makePatch } from '../patch/patch';
import type { RollNote } from '../sequencing/rollSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { AudioPart } from '../synth/audioPart';
import type { ArrangementPartial, PartRegion } from './arrangement';

const BAR = TICKS_PER_BAR;
const { drone } = FULL_SLOT;

/** The drone part alone, as a Roll over `regions` (the whole 4-bar song by default). */
function rollRig(
  notes: RollNote[],
  loopTicks = BAR,
  regions: PartRegion[] = [{ start: 0, duration: 4 * BAR }],
): Rig {
  const song = withPart(FULL_ARRANGEMENT, 'drone', {
    regions,
    sequencer: { kind: 'roll', loopTicks, notes },
  });
  return rig(onlyParts(song, 'drone'));
}

const tick = (r: Rig): void => r.transport.advance(r.transport.transportSeconds);
const ticks = (r: Rig, n: number): void => {
  for (let i = 0; i < n; i++) tick(r);
};

/** The drone's note calls as `tick:on|off:pitch`, from call `from` on. */
function played(r: Rig, from = 0): string[] {
  const perTick = r.transport.secondsPerTick;
  return r.parts.drone.calls
    .slice(from)
    .filter((c: Call) => c.kind === 'noteOn' || c.kind === 'noteOffByNote')
    .map(
      (c) =>
        `${Math.round((c.time ?? 0) / perTick)}:${c.kind === 'noteOn' ? 'on' : 'off'}:${c.note}`,
    );
}

const BLOCK = 128;

/** One sine carrier sustaining at full level, mono: the patch a slide acts on. */
const MONO = makePatch({
  mono: true,
  glide: 0,
  ops: [
    {
      level: 1,
      env: makeEnvelope({ attackTime: 0.005, decayTime: 0.005, peakLevel: 1, sustainLevel: 1 }),
    },
    { level: 0 },
    { level: 0 },
    { level: 0 },
  ],
});

/** The part's calls replayed on an `AudioPart`: the worklet messages they post, in order. */
function posted(calls: readonly Call[]): ScheduledEvent[] {
  const sent: ScheduledEvent[] = [];
  const node = {
    context: { currentTime: 0, sampleRate: 48000 },
    port: { postMessage: (m: ScheduledEvent) => void sent.push(m) },
    parameters: { get: () => ({ value: 0 }) },
  } as unknown as AudioWorkletNode;
  const part = new AudioPart('drone', node, MONO);
  for (const c of calls) {
    if (c.kind === 'noteOn') part.noteOn(c.note ?? 0, c.velocity, c.time, c.extras);
    if (c.kind === 'noteOffByNote') part.noteOffByNote(c.note ?? 0, c.time);
  }
  return sent;
}

interface Voice {
  active: boolean;
  gate: boolean;
  voiceId: number;
  note: number;
}

const gated = (processor: ProcessorLike): Voice[] =>
  (processor.voices as unknown as Voice[]).filter((v) => v.active && v.gate);

describe('a Roll through the player (windsor#600)', () => {
  it("plays a chord on one tick at the note's velocity times the part's", () => {
    const r = rollRig([
      { tick: 0, ticks: 24, pitch: 50, velocity: 0.5 },
      { tick: 0, ticks: 24, pitch: 53 },
      { tick: 0, ticks: 24, pitch: 57, velocity: 0.25 },
    ]);
    ticks(r, 25);
    expect(played(r)).toEqual([
      '0:on:50',
      '0:on:53',
      '0:on:57',
      '24:off:50',
      '24:off:53',
      '24:off:57',
    ]);
    const velocities = r.parts.drone.calls
      .filter((c) => c.kind === 'noteOn')
      .map((c) => c.velocity);
    expect(velocities[0]).toBeCloseTo(0.4);
    expect(velocities[1]).toBeCloseTo(0.8);
    expect(velocities[2]).toBeCloseTo(0.2);
  });

  it('repeats a 1-bar loop four times across a 4-bar region', () => {
    const r = rollRig([{ tick: 12, ticks: 6, pitch: 62 }]);
    ticks(r, 4 * BAR);
    const ons = played(r).filter((e) => e.includes(':on:'));
    expect(ons).toEqual([12, 108, 204, 300].map((t) => `${t}:on:62`));
  });

  it("plays a 4-bar loop's first two bars in a 2-bar region, whose end releases what is held", () => {
    const notes = [
      { tick: 0, ticks: 24, pitch: 50 },
      { tick: 150, ticks: 96, pitch: 55 },
      { tick: 200, ticks: 12, pitch: 60 },
    ];
    const r = rollRig(notes, 4 * BAR, [{ start: 0, duration: 2 * BAR }]);
    ticks(r, 4 * BAR);
    expect(played(r)).toEqual(['0:on:50', '24:off:50', '150:on:55', '192:off:55']);
  });

  it('chases nothing on a seek into a held note, and plays it on the next pass', () => {
    const r = rollRig([{ tick: 0, ticks: 48, pitch: 50 }]);
    r.player.releaseAll();
    r.player.reset();
    r.transport.reset(BAR + 24);
    ticks(r, BAR);
    expect(played(r)).toEqual(['192:on:50']);
  });

  it('releases on the next tick a held note a live edit removes', () => {
    const r = rollRig([{ tick: 0, ticks: 48, pitch: 50 }]);
    ticks(r, 10);
    const mark = r.parts.drone.calls.length;
    const edit = { parts: { [drone]: { sequencer: { notes: [] } } } } as ArrangementPartial;
    expect(r.player.apply(edit).ok).toBe(true);
    ticks(r, 2);
    expect(played(r, mark)).toEqual(['10:off:50']);
  });

  it('takes a live loop length without a restart: the held note plays on', () => {
    const r = rollRig([{ tick: 0, ticks: 30, pitch: 50 }]);
    ticks(r, 10);
    const mark = r.parts.drone.calls.length;
    const edit = { parts: { [drone]: { sequencer: { loopTicks: 48 } } } } as ArrangementPartial;
    expect(r.player.apply(edit).ok).toBe(true);
    ticks(r, 90);
    expect(r.parts.drone.calls.slice(mark).some((c) => c.kind === 'allNotesOff')).toBe(false);
    expect(played(r, mark)).toEqual(['30:off:50', '48:on:50', '78:off:50', '96:on:50']);
  });

  it('reads the playhead as the loop tick in a region, and -1 outside one', () => {
    const r = rollRig([], 84, [{ start: BAR, duration: 2 * BAR }]);
    expect([0, BAR, BAR + 83, BAR + 84, 3 * BAR].map((t) => r.player.stepAt(drone, t))).toEqual([
      -1, 0, 83, 0, -1,
    ]);
  });

  it("slides a mono voice into an overlap, and the slid-from note's off leaves it sounding", () => {
    const r = rollRig([
      { tick: 0, ticks: 24, pitch: 50 },
      { tick: 12, ticks: 24, pitch: 55 },
    ]);
    ticks(r, 37);
    expect(played(r)).toEqual(['0:on:50', '12:on:55', '24:off:50', '36:off:55']);
    const ons = r.parts.drone.calls.filter((c) => c.kind === 'noteOn');
    expect(ons.map((c) => c.extras?.slide === true)).toEqual([false, true]);

    // The calls' messages into a mono processor, rendered up to each tick asked for.
    const events = posted(r.parts.drone.calls);
    const loaded = loadProcessor();
    const processor = loaded.create(MONO, 4);
    let done = 0;
    const renderTo = (t: number): void => {
      const blocks = Math.ceil((t * r.transport.secondsPerTick * 48000) / BLOCK) - done;
      const from = done * BLOCK;
      const due = events.filter((e) => e.frame >= from && e.frame < from + blocks * BLOCK);
      render(
        loaded,
        processor,
        blocks,
        due.map((e) => ({ ...e, frame: e.frame - from })),
      );
      done += blocks;
    };
    renderTo(6);
    const [voice] = gated(processor);
    expect([voice?.voiceId, voice?.note]).toEqual([1, 50]);
    // Past the slid-from note's off on 24: the same voice, retargeted to the slid-to handle.
    renderTo(30);
    expect(gated(processor)).toEqual([voice]);
    expect([voice?.voiceId, voice?.note]).toEqual([2, 55]);
    // The slid-to note's own off on 36 releases it.
    renderTo(40);
    expect(gated(processor)).toEqual([]);
  });
});
