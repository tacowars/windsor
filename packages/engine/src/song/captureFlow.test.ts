/**
 * The Euclidean click-to-toggle capture, player and document halves (issue
 * #70, record §6): capture reads the figure that is sounding, apply freezes
 * it, release returns the part to generative, and a captured figure survives
 * the export → import round trip through `makeArrangement`. Pitched capture
 * went with the arpeggiator and step sequencer (#704, epic #703 decision 12);
 * generator-level playback of a fixed figure is in `euclideanSequencer.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_REGION,
  FULL_SLOT,
  onlyParts,
} from '../__fixtures__/fullArrangement';
import type { Arrangement, MusicPart, SequencerSpec } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { PRESETS } from '../patch/presets';
import { ARRANGEMENT_VERSION } from '../audioConstants';

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

/** The library ids these documents name, embedded as silent `{}` fills (#562). */
const PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };

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
    expect(captured.player.apply({ parts: { [kick]: freeze('euclidean', pattern) } }).ok).toBe(
      true,
    );

    expect(perBar(captured, kick, 6)).toEqual(new Array(6).fill(hits));
    // The generative control still breathes over the same bars (density LFO).
    expect(new Set(perBar(control, kick, 6)).size).toBeGreaterThan(1);
  });

  it('releases a frozen figure back to generative: the pulse breathes again', () => {
    const r = rig(FULL_ARRANGEMENT);
    r.run(2);
    const pattern = r.player.capturePattern(kick);
    expect(r.player.apply({ parts: { [kick]: freeze('euclidean', pattern) } }).ok).toBe(true);
    expect(r.player.apply({ parts: { [kick]: freeze('euclidean', null) } }).ok).toBe(true);
    expect(patternOf(r, kick)).toBeNull();
    expect(new Set(perBar(r, kick, 8)).size).toBeGreaterThan(1);
  });

  it('round-trips a captured figure: capture → apply → export → import (#704 keeps this half)', () => {
    const r = rig(FULL_ARRANGEMENT);
    r.run(2);
    const pattern = r.player.capturePattern(kick);
    expect(r.player.apply({ parts: { [kick]: freeze('euclidean', pattern) } }).ok).toBe(true);
    const exported = JSON.parse(
      JSON.stringify({ version: ARRANGEMENT_VERSION, patches: PATCHES, ...r.player.arrangement }),
    ) as unknown;
    const imported = makeArrangement(exported);
    expect(imported.corrections).toEqual([]);
    const importedKick = imported.document.parts.find((p) => p.slot === kick);
    expect((importedKick?.sequencer as { pattern?: unknown }).pattern).toEqual(pattern);
  });

  it('returns null for every part that is not Euclidean, and for an absent slot', () => {
    const r = rig(FULL_ARRANGEMENT);
    r.run(2);
    // A grid line and a chord progression are written, not captured.
    expect(r.player.capturePattern(arp)).toBeNull();
    expect(r.player.capturePattern(drone)).toBeNull();
    const inert = rig({
      ...onlyParts(FULL_ARRANGEMENT, 'kick'),
      parts: [FULL_PARTS.kick, { ...FULL_PARTS.drone, sequencer: { kind: 'none' } }],
    });
    expect(inert.player.capturePattern(drone)).toBeNull();
    expect(inert.player.capturePattern(7)).toBeNull();
  });
});

/** A current-version document of the given parts, each live for the whole default-length song. */
const doc = (...parts: Array<Record<string, unknown>>): Record<string, unknown> => ({
  version: ARRANGEMENT_VERSION,
  transport: { bpm: FULL_ARRANGEMENT.transport.bpm, bars: FULL_ARRANGEMENT.transport.bars },
  patches: PATCHES,
  parts: parts.map((part) => ({ regions: [FULL_REGION], ...part })),
});

const sequencerOf = (
  result: ReturnType<typeof makeArrangement>,
  i: number,
): Record<string, unknown> =>
  result.document.parts[i]?.sequencer as unknown as Record<string, unknown>;

describe('captured patterns in the document (export → import)', () => {
  it('normalises a literal figure, 0/1 accepted, junk corrected to rests', () => {
    const result = makeArrangement(
      doc({
        slot: 0,
        preset: 'kick',
        sequencer: { kind: 'euclidean', seed: 0, steps: 4, pattern: [1, 0, true, 'x'] },
      }),
    );
    expect(sequencerOf(result, 0).pattern).toEqual([true, false, true, false]);
    expect(result.corrections.join('\n')).toMatch(/parts\[0\]\.sequencer\.pattern\[3\]/);
  });

  it('drops a pattern on a grid part as an unknown key (#704: no pitched capture)', () => {
    const result = makeArrangement(
      doc({
        slot: 2,
        preset: 'saw-arp',
        sequencer: { kind: 'grid', seed: 0, pattern: [60, null] },
      }),
    );
    expect(sequencerOf(result, 0).pattern).toBeUndefined();
    expect(result.corrections).toContain('parts[0].sequencer.pattern: unknown key dropped');
  });

  it('resizes a Euclidean pattern to the figure and reports it', () => {
    const result = makeArrangement(
      doc({
        slot: 0,
        preset: 'kick',
        sequencer: { kind: 'euclidean', seed: 0, steps: 4, pattern: [true] },
      }),
    );
    expect(sequencerOf(result, 0).pattern).toEqual([true, false, false, false]);
    expect(result.corrections.join('\n')).toMatch(/1 steps for a 4-step figure — resized/);
  });

  it('defaults an absent pattern to null, silently', () => {
    const result = makeArrangement(
      doc({ slot: 0, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean', seed: 0 } }),
    );
    expect(result.corrections).toEqual([]);
    expect(sequencerOf(result, 0).pattern).toBeNull();
  });

  it('survives the export → import round trip equal and correction-free', () => {
    const authored = {
      ...doc({
        slot: 0,
        name: 'kick',
        preset: 'kick',
        sequencer: { kind: 'euclidean', seed: 7, steps: 8, pattern: [1, 0, 0, 1, 0, 0, 1, 0] },
      }),
      transport: { bpm: 100, bars: FULL_ARRANGEMENT.transport.bars },
      harmony: { root: 2, scale: 'dorian' },
    };
    const first = makeArrangement(authored);
    expect(first.usable).toBe(true);
    expect(first.corrections).toEqual([]);
    expect(first.dangling).toEqual([]);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.document).toEqual(first.document);
    expect(second.corrections).toEqual([]);
    expect(second.dangling).toEqual([]);
    expect(sequencerOf(second, 0).pattern).toEqual([
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
