/**
 * Capture-to-fixed, player and document halves (issue #70, record §6):
 * capture reads what actually sounded, apply freezes it, release returns the
 * part to generative, and a captured pattern survives the export → import
 * round trip through `makeArrangement`. Generator-level playback is in
 * `capturedPattern.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import type { Arrangement } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type MusicPartId, type PlayablePart } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { PRESETS } from './presets';

const silent = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

interface Rig {
  transport: TickTransport;
  player: ArrangementPlayer;
  counts: Record<MusicPartId, number>;
  run(bars: number): void;
}

function rig(arrangement: Arrangement): Rig {
  const transport = new TickTransport(120);
  const counts: Record<MusicPartId, number> = { kick: 0, hat: 0, arp: 0, drone: 0 };
  const count = (id: MusicPartId): PlayablePart => ({
    ...silent(),
    trigger: () => ++counts[id],
    noteOn: () => ++counts[id],
  });
  const parts = {
    kick: count('kick'),
    hat: count('hat'),
    arp: count('arp'),
    drone: count('drone'),
  };
  const player = new ArrangementPlayer(transport, parts, arrangement, PRESETS);
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, player, counts, run };
}

/** Note-ons per bar over `bars` bars, one entry per bar. */
function perBar(r: Rig, id: MusicPartId, bars: number): number[] {
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const before = r.counts[id];
    r.run(1);
    out.push(r.counts[id] - before);
  }
  return out;
}

describe('player capture and release', () => {
  it('freezes the sounding kick figure; the pulse stops breathing', () => {
    const captured = rig(FULL_ARRANGEMENT);
    const control = rig(FULL_ARRANGEMENT);
    captured.run(2);
    control.run(2);
    const pattern = captured.player.capturePattern('kick');
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern).toHaveLength(FULL_ARRANGEMENT.kick.driver.steps);
    const hits = (pattern ?? []).filter(Boolean).length;
    expect(captured.player.apply({ kick: { driver: { pattern } } }).ok).toBe(true);

    expect(perBar(captured, 'kick', 6)).toEqual(new Array(6).fill(hits));
    // The generative control still breathes over the same bars (density LFO).
    expect(new Set(perBar(control, 'kick', 6)).size).toBeGreaterThan(1);
  });

  it('captures the arp bar that sounded and repeats it exactly after apply', () => {
    const r = rig(FULL_ARRANGEMENT);
    r.run(4);
    const pattern = r.player.capturePattern('arp');
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern).toHaveLength(TICKS_PER_BAR / FULL_ARRANGEMENT.arp.driver.divisor);
    expect(r.player.apply({ arp: { driver: { pattern } } }).ok).toBe(true);
    expect(r.player.arrangement.arp?.driver.pattern).toEqual(pattern);

    // Fixed now: every bar plays exactly the captured bar's non-rests.
    const notes = (pattern ?? []).filter((n) => n !== null).length;
    expect(notes).toBeGreaterThan(0);
    expect(perBar(r, 'arp', 4)).toEqual(new Array(4).fill(notes));
  });

  it('captures a tied drone as its held note and release returns it to generative', () => {
    const tied: Arrangement = {
      ...FULL_ARRANGEMENT,
      key: { root: 48, scale: [0], weights: [1] },
    };
    const { player, run } = rig(tied);
    run(4);
    const pattern = player.capturePattern('drone');
    expect(pattern).toEqual([36]);
    expect(player.apply({ drone: { driver: { pattern } } }).ok).toBe(true);
    expect(player.arrangement.drone?.driver.pattern).toEqual([36]);

    expect(player.apply({ drone: { driver: { pattern: null } } }).ok).toBe(true);
    expect(player.arrangement.drone?.driver.pattern).toBeNull();
    const before = player.readout().counters.drone;
    run(2);
    expect(player.readout().counters.drone).toBeGreaterThanOrEqual(before);
  });

  it('returns null where there is nothing to capture', () => {
    const kickOnly: Arrangement = {
      seed: 0,
      bpm: 120,
      key: FULL_ARRANGEMENT.key,
      kick: FULL_ARRANGEMENT.kick,
    };
    const { player } = rig(kickOnly);
    expect(player.capturePattern('arp')).toBeNull();
    expect(player.capturePattern('drone')).toBeNull();
    expect(player.capturePattern('hat')).toBeNull();
  });
});

/** The library ids these documents name, embedded as silent `{}` fills (#562). */
const PATCHES = { kick: {}, 'saw-arp': {}, 'drone-sqr': {} };

describe('captured patterns in the document (export → import)', () => {
  it('normalises literal patterns, 0/1 accepted, junk corrected to rests', () => {
    const result = makeArrangement({
      patches: PATCHES,
      kick: { preset: 'kick', driver: { steps: 4, pattern: [1, 0, true, 'x'] } },
      arp: { preset: 'saw-arp', driver: { pattern: [60.4, 'x', null, 200] } },
    });
    expect(result.document.kick?.driver.pattern).toEqual([true, false, true, false]);
    expect(result.document.arp?.driver.pattern).toEqual([60, null, null, 127]);
    expect(result.corrections.join('\n')).toMatch(/kick\.driver\.pattern\[3\]/);
    expect(result.corrections.join('\n')).toMatch(/arp\.driver\.pattern\[1\]/);
  });

  it('resizes a percussion pattern to the figure and reports it', () => {
    const result = makeArrangement({
      patches: PATCHES,
      kick: { preset: 'kick', driver: { steps: 4, pattern: [true] } },
    });
    expect(result.document.kick?.driver.pattern).toEqual([true, false, false, false]);
    expect(result.corrections.join('\n')).toMatch(/1 steps for a 4-step figure — resized/);
  });

  it('defaults an absent pattern to null, silently', () => {
    const result = makeArrangement({ patches: PATCHES, kick: { part: 'kick', preset: 'kick' } });
    expect(result.corrections).toEqual([]);
    expect(result.document.kick?.driver.pattern).toBeNull();
  });

  it('survives the export → import round trip equal and correction-free', () => {
    const authored = {
      patches: PATCHES,
      seed: 7,
      bpm: 100,
      key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
      kick: {
        part: 'kick',
        preset: 'kick',
        driver: { steps: 8, pattern: [1, 0, 0, 1, 0, 0, 1, 0] },
      },
      arp: { part: 'arp', preset: 'saw-arp', driver: { pattern: [62, null, 65, 69] } },
      drone: { part: 'drone', preset: 'drone-sqr', driver: { pattern: [38] } },
    };
    const first = makeArrangement(authored);
    expect(first.usable).toBe(true);
    expect(first.dangling).toEqual([]);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.document).toEqual(first.document);
    expect(second.corrections).toEqual([]);
    expect(second.dangling).toEqual([]);
    expect(second.document.kick?.driver.pattern).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});
