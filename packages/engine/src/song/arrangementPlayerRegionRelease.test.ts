/**
 * The sounding region removed or moved by a live edit (windsor#74, fix
 * round 1 on PR windsor#78): the edit drops its generator, but what that
 * generator holds is still released on the next tick, whether that tick is
 * the song's wrap or the loop's jump back, and nothing is left held.
 */
import { describe, expect, it } from 'vitest';

import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import { rig, type Rig } from '../__fixtures__/playerRig';
import { kinds, type Call } from '../__fixtures__/recordingPart';
import { CHORD_PATTERN_A } from '../__fixtures__/documentCases';
import { HALF, SONG, halves, tickOf, twoRegionSong } from '../__fixtures__/regionPatternSongs';
import type { Arrangement, PartRegion, RegionPattern } from './arrangement';

const CHORD = CHORD_PATTERN_A as unknown as RegionPattern;
const { drone } = FULL_SLOT;
const song = twoRegionSong('drone', CHORD, CHORD);
/** The same song looping bars 3–4: the tick after the last one jumps back to bar 3. */
const looping: Arrangement = {
  ...song,
  transport: { ...song.transport, loop: { start: HALF, end: SONG, on: true } },
};

/** The notes a part holds after `calls`: each note-on less the note-offs for it. */
function held(calls: readonly Call[]): number[] {
  const notes: number[] = [];
  for (const call of calls) {
    if (call.kind === 'allNotesOff') notes.length = 0;
    if (call.kind === 'noteOn') notes.push(call.note!);
    if (call.kind !== 'noteOffByNote') continue;
    const at = notes.indexOf(call.note!);
    if (at >= 0) notes.splice(at, 1);
  }
  return notes.sort((a, b) => a - b);
}

const tick = (r: Rig): void => r.transport.advance(r.transport.transportSeconds);

/**
 * Play to the last tick of the song with region 2's chord held, apply
 * `regions` to the chord part there, and play one more tick: what that
 * tick sent, and what the part held before it.
 */
function editOnLastTick(arrangement: Arrangement, regions: PartRegion[]) {
  const r = rig(arrangement);
  for (let i = 0; i < SONG; i++) tick(r);
  const before = held(r.parts.drone.calls);
  const mark = r.parts.drone.calls.length;
  expect(r.player.apply({ parts: { [drone]: { regions } } }).ok).toBe(true);
  tick(r);
  const sent = r.parts.drone.calls.slice(mark);
  const offs = sent.filter((c) => c.kind === 'noteOffByNote');
  return { r, before, sent, offs };
}

const onlyFirst = (): PartRegion[] => [halves(CHORD, CHORD)[0]!];
/** Region 2 moved an eighth later: a new start, so a new region and a new generator. */
const moved = (): PartRegion[] => {
  const [first, second] = halves(CHORD, CHORD);
  return [first!, { ...second!, start: HALF + 12, duration: HALF - 12 }];
};

describe('the sounding own-pattern region dropped by a live edit', () => {
  it.each([
    ['removed, the loop jumping back next', looping, onlyFirst],
    ['moved, the loop jumping back next', looping, moved],
  ])('%s: its chord is released on the jump and nothing is held', (_, arrangement, regions) => {
    const { r, before, sent, offs } = editOnLastTick(arrangement, regions());
    expect(before.length).toBeGreaterThan(0);
    expect(offs.map((c) => c.note).sort((a, b) => a! - b!)).toEqual(before);
    expect(offs.every((c) => tickOf(c.time) === SONG)).toBe(true);
    expect(kinds(r.parts.drone, 'allNotesOff')).toEqual([]);
    expect(sent.filter((c) => c.kind === 'noteOn')).toEqual([]);
    expect(held(r.parts.drone.calls)).toEqual([]);
  });

  it.each([
    ['removed', onlyFirst],
    ['moved', moved],
  ])('%s with no loop: released the same way on the song’s wrap', (_, regions) => {
    const { r, before, offs } = editOnLastTick(song, regions());
    expect(before.length).toBeGreaterThan(0);
    expect(offs.map((c) => c.note).sort((a, b) => a! - b!)).toEqual(before);
    expect(offs.every((c) => tickOf(c.time) === SONG)).toBe(true);
    expect(kinds(r.parts.drone, 'allNotesOff')).toEqual([]);
    // Region 1 comes in on the wrap: what is held now is its chord alone.
    const ons = r.parts.drone.calls.filter((c) => c.kind === 'noteOn' && tickOf(c.time) === SONG);
    expect(held(r.parts.drone.calls)).toEqual(ons.map((c) => c.note).sort((a, b) => a! - b!));
  });

  it('a stop after the edit releases it too', () => {
    const r = rig(looping);
    for (let i = 0; i < SONG; i++) tick(r);
    expect(r.player.apply({ parts: { [drone]: { regions: onlyFirst() } } }).ok).toBe(true);
    expect(held(r.parts.drone.calls).length).toBeGreaterThan(0);
    r.player.releaseAll();
    // Every note-on has its note-off, the all-notes-off aside.
    const notes = r.parts.drone.calls.filter((c) => c.kind !== 'allNotesOff');
    expect(held(notes)).toEqual([]);
  });
});
