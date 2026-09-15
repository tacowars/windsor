/**
 * The committed JSON is the #69b TypeScript arrangement, exactly (issue #75):
 * structural equality of the normalised document, and offline-render equality
 * of the first 4 bars through the full stack on the graph stand-in. The
 * maintainer approved this exact arrangement by ear on PR #81, so any
 * difference here is a defect, not a tuning choice.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { maxAbsDiff } from './__fixtures__/audioAnalysis';
import type { Capture } from './__fixtures__/fakeAudioContext';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { FULL_ARRANGEMENT, FULL_DOCUMENT } from './__fixtures__/fullArrangement';
import { noteToneFeed } from './__fixtures__/noteFeeds';
import type { ArrangementDocument } from './arrangementDocument';
import { makeArrangement } from './arrangementDocument';
import { MUSIC_PART_IDS, type MusicPartId } from './arrangementPlayer';
import raw from './arrangements/bed-01.json';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

/** One tone per part, as in musicRender.test.ts, so both renders speak the same voice. */
const HZ: Record<MusicPartId, number> = { kick: 233, hat: 977, arp: 1447, drone: 421 };

const BARS = 4;
const BAR_SECONDS = (60 / FULL_ARRANGEMENT.bpm) * 4;

interface Render {
  capture: Capture;
  counters: Record<MusicPartId, number>;
}

async function renderBed(arrangement: ArrangementDocument): Promise<Render> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(arrangement);
  for (const id of MUSIC_PART_IDS) {
    const section = arrangement[id];
    if (!section) throw new Error(`arrangement has no ${id}`);
    const part = engine.getPart(section.part);
    if (!part) throw new Error(`no part "${id}"`);
    const node = sourceOf(part);
    node.feed = noteToneFeed(node, HZ[id]);
  }
  system.startMusic();
  const [master] = renderGraph(
    context,
    BARS * BAR_SECONDS,
    [engine.master as unknown as FakeNode],
    () => system.update(0),
  );
  if (!master) throw new Error('render produced no capture');
  return { capture: master, counters: system.readout().counters };
}

describe('bed-01.json equals the #69b TypeScript arrangement', () => {
  it('normalises to exactly the fixture, with nothing corrected', () => {
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.dangling).toEqual([]);
    // No fill was offered and none was needed: the committed song already
    // carries every patch it plays (#562).
    expect(result.filled).toEqual([]);
    const { patches, ...arrangement } = result.document;
    expect(arrangement).toEqual(FULL_ARRANGEMENT);
    expect(Object.keys(patches ?? {}).sort()).toEqual(
      [...MUSIC_PART_IDS.map((id) => FULL_ARRANGEMENT[id].preset)].sort(),
    );
  });

  it(`renders the first ${BARS} bars sample-identically through the full stack`, async () => {
    // The #562 proof that embedding changed no sound: `fromTs` resolves the
    // four patches from the library, the way the game did before this ticket,
    // and `fromJson` plays the snapshots the document now carries.
    const fromJson = await renderBed(makeArrangement(raw).document);
    const fromTs = await renderBed(FULL_DOCUMENT);
    for (const id of MUSIC_PART_IDS) expect(fromTs.counters[id], id).toBeGreaterThan(0);
    expect(fromJson.counters).toEqual(fromTs.counters);
    expect(maxAbsDiff(fromJson.capture.left, fromTs.capture.left)).toBe(0);
    expect(maxAbsDiff(fromJson.capture.right, fromTs.capture.right)).toBe(0);
  });
});
