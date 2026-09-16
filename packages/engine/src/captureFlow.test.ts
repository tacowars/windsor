/**
 * Capture-to-fixed, player and document halves (issue #70, record §6):
 * capture reads what actually sounded, apply freezes it, release returns the
 * part to generative, and a captured pattern survives the export → import
 * round trip through `makeArrangement`. Capture works per sequencer kind on
 * any slot (#597). Generator-level playback is in `capturedPattern.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  onlyParts,
} from './__fixtures__/fullArrangement';
import type { Arrangement, MusicPart, SequencerSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { PRESETS } from './presets';

const { kick, arp, drone } = FULL_SLOT;

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
  counts: Map<number, number>;
  run(bars: number): void;
}

function rig(arrangement: Arrangement): Rig {
  const transport = new TickTransport(120);
  const counts = new Map<number, number>();
  const bump = (slot: number): number => {
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
    return counts.get(slot) ?? 0;
  };
  const parts = new Map(
    arrangement.parts.map(({ slot }): [number, PlayablePart] => [
      slot,
      { ...silent(), trigger: () => bump(slot), noteOn: () => bump(slot) },
    ]),
  );
  const player = new ArrangementPlayer(transport, parts, arrangement, PRESETS);
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, player, counts, run };
}

/** Note-ons per bar over `bars` bars, one entry per bar. */
function perBar(r: Rig, slot: number, bars: number): number[] {
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const before = r.counts.get(slot) ?? 0;
    r.run(1);
    out.push((r.counts.get(slot) ?? 0) - before);
  }
  return out;
}

const patternOf = (r: Rig, slot: number): unknown =>
  (r.player.arrangement.parts.find((p) => p.slot === slot)?.sequencer as { pattern?: unknown })
    .pattern;

/** A pattern partial for the part on `slot`, carrying its kind so the union merges. */
const freeze = (kind: SequencerSpec['kind'], pattern: unknown) =>
  ({ sequencer: { kind, pattern } }) as unknown as Partial<MusicPart>;

describe('player capture and release', () => {
  it('freezes the sounding kick figure; the pulse stops breathing', () => {
    const captured = rig(FULL_ARRANGEMENT);
    const control = rig(FULL_ARRANGEMENT);
    captured.run(2);
    control.run(2);
    const pattern = captured.player.capturePattern(kick);
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern).toHaveLength(FULL_PARTS.kick.sequencer.steps);
    const hits = ((pattern ?? []) as unknown[]).filter(Boolean).length;
    expect(captured.player.apply({ parts: { [kick]: freeze('euclidean', pattern) } }).ok).toBe(true);

    expect(perBar(captured, kick, 6)).toEqual(new Array(6).fill(hits));
    // The generative control still breathes over the same bars (density LFO).
    expect(new Set(perBar(control, kick, 6)).size).toBeGreaterThan(1);
  });

  it('captures the arp bar that sounded and repeats it exactly after apply', () => {
    const r = rig(FULL_ARRANGEMENT);
    r.run(4);
    const pattern = r.player.capturePattern(arp);
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern).toHaveLength(TICKS_PER_BAR / FULL_PARTS.arp.sequencer.divisor);
    expect(r.player.apply({ parts: { [arp]: freeze('arp', pattern) } }).ok).toBe(true);
    expect(patternOf(r, arp)).toEqual(pattern);

    // Fixed now: every bar plays exactly the captured bar's non-rests.
    const notes = ((pattern ?? []) as unknown[]).filter((n) => n !== null).length;
    expect(notes).toBeGreaterThan(0);
    expect(perBar(r, arp, 4)).toEqual(new Array(4).fill(notes));
  });

  it('captures a tied step part as its held note and release returns it to generative', () => {
    const tied: Arrangement = { ...FULL_ARRANGEMENT, key: { root: 48, scale: [0], weights: [1] } };
    const r = rig(tied);
    r.run(4);
    const pattern = r.player.capturePattern(drone);
    expect(pattern).toEqual([36]);
    expect(r.player.apply({ parts: { [drone]: freeze('step', pattern) } }).ok).toBe(true);
    expect(patternOf(r, drone)).toEqual([36]);

    expect(r.player.apply({ parts: { [drone]: freeze('step', null) } }).ok).toBe(true);
    expect(patternOf(r, drone)).toBeNull();
    const before = r.player.readout().counters[drone] ?? 0;
    r.run(2);
    expect(r.player.readout().counters[drone]).toBeGreaterThanOrEqual(before);
  });

  it('captures an arpeggiator on a slot that used to be the kick’s (#597)', () => {
    const arpOnKick: Arrangement = {
      ...FULL_ARRANGEMENT,
      parts: [{ ...FULL_PARTS.arp, slot: kick }],
    };
    const r = rig(arpOnKick);
    r.run(4);
    const pattern = r.player.capturePattern(kick);
    expect(pattern).toHaveLength(TICKS_PER_BAR / FULL_PARTS.arp.sequencer.divisor);
    expect(r.player.apply({ parts: { [kick]: freeze('arp', pattern) } }).ok).toBe(true);
    expect(patternOf(r, kick)).toEqual(pattern);
  });

  it('returns null where there is nothing to capture', () => {
    const r = rig({
      ...onlyParts(FULL_ARRANGEMENT, 'kick'),
      parts: [FULL_PARTS.kick, { ...FULL_PARTS.drone, sequencer: { kind: 'none' } }],
    });
    expect(r.player.capturePattern(arp)).toBeNull();
    expect(r.player.capturePattern(drone)).toBeNull();
    expect(r.player.capturePattern(7)).toBeNull();
  });
});

/** The library ids these documents name, embedded as silent `{}` fills (#562). */
const PATCHES = { kick: {}, 'saw-arp': {}, 'drone-sqr': {} };

const doc = (...parts: unknown[]): Record<string, unknown> => ({ version: 2, patches: PATCHES, parts });

const sequencerOf = (result: ReturnType<typeof makeArrangement>, i: number): Record<string, unknown> =>
  result.document.parts[i]?.sequencer as unknown as Record<string, unknown>;

describe('captured patterns in the document (export → import)', () => {
  it('normalises literal patterns, 0/1 accepted, junk corrected to rests', () => {
    const result = makeArrangement(
      doc(
        { slot: 0, preset: 'kick', sequencer: { kind: 'euclidean', steps: 4, pattern: [1, 0, true, 'x'] } },
        { slot: 2, preset: 'saw-arp', sequencer: { kind: 'arp', pattern: [60.4, 'x', null, 200] } },
      ),
    );
    expect(sequencerOf(result, 0).pattern).toEqual([true, false, true, false]);
    expect(sequencerOf(result, 1).pattern).toEqual([60, null, null, 127]);
    expect(result.corrections.join('\n')).toMatch(/parts\[0\]\.sequencer\.pattern\[3\]/);
    expect(result.corrections.join('\n')).toMatch(/parts\[1\]\.sequencer\.pattern\[1\]/);
  });

  it('resizes a Euclidean pattern to the figure and reports it', () => {
    const result = makeArrangement(
      doc({ slot: 0, preset: 'kick', sequencer: { kind: 'euclidean', steps: 4, pattern: [true] } }),
    );
    expect(sequencerOf(result, 0).pattern).toEqual([true, false, false, false]);
    expect(result.corrections.join('\n')).toMatch(/1 steps for a 4-step figure — resized/);
  });

  it('defaults an absent pattern to null, silently', () => {
    const result = makeArrangement(
      doc({ slot: 0, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean' } }),
    );
    expect(result.corrections).toEqual([]);
    expect(sequencerOf(result, 0).pattern).toBeNull();
  });

  it('survives the export → import round trip equal and correction-free', () => {
    const authored = {
      ...doc(
        {
          slot: 0,
          name: 'kick',
          preset: 'kick',
          sequencer: { kind: 'euclidean', steps: 8, pattern: [1, 0, 0, 1, 0, 0, 1, 0] },
        },
        { slot: 2, name: 'arp', preset: 'saw-arp', sequencer: { kind: 'arp', pattern: [62, null, 65, 69] } },
        { slot: 3, name: 'drone', preset: 'drone-sqr', sequencer: { kind: 'step', pattern: [38] } },
      ),
      seed: 7,
      bpm: 100,
      key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
    };
    const first = makeArrangement(authored);
    expect(first.usable).toBe(true);
    expect(first.dangling).toEqual([]);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.document).toEqual(first.document);
    expect(second.corrections).toEqual([]);
    expect(second.dangling).toEqual([]);
    expect(sequencerOf(second, 0).pattern).toEqual([true, false, false, true, false, false, true, false]);
  });
});
