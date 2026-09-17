/**
 * The reference JSON document is the #69b TypeScript arrangement, exactly
 * (issue #75): structural equality of the normalised document, and
 * offline-render equality of the first 4 bars through the full stack on the
 * graph stand-in. The maintainer approved this exact arrangement by ear on PR
 * #81, so any difference here is a defect, not a tuning choice. It was the
 * shipped `arrangements/bed-01.json` until #613, when tacowars made bed-01 tacowars's own
 * song and the twin moved to `__fixtures__/arrangementDocuments/reference-bed.json`
 * (record `2026-09-17-613-bed-01-is-the-owners-song-the-reference-twin-is-a-fixture`):
 * what this proves is the JSON codec against the TypeScript fixture, which no
 * song a musician edits should have to keep satisfying.
 *
 * What the render here proves is the *arrangement*: which part fires on which
 * tick, through which strip and send, at which level. It cannot see a patch —
 * every part's source is a `noteToneFeed`, not the FM processor. The #562
 * proof that the embedded patches sounded like the library's was a separate
 * test through the real worklet, retired by #583 once the embedding had
 * merged: a song's snapshot diverging from the library is the designed state.
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
import {
  FULL_ARRANGEMENT,
  FULL_DOCUMENT,
  FULL_PART_IDS,
  FULL_PARTS,
  FULL_SLOT,
  type FullPartId,
} from './__fixtures__/fullArrangement';
import { noteToneFeed } from './__fixtures__/noteFeeds';
import type { ArrangementDocument } from './arrangementDocument';
import { makeArrangement } from './arrangementDocument';
import raw from './__fixtures__/arrangementDocuments/reference-bed.json';
import { AudioSystem } from './audioSystem';
import { musicPartName } from './documentParts';
import { FmEngine } from './fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

/** One tone per part, as in musicRender.test.ts, so both renders speak the same voice. */
const HZ: Record<FullPartId, number> = { kick: 233, hat: 977, arp: 1447, drone: 421 };

const BARS = 4;
const BAR_SECONDS = (60 / FULL_ARRANGEMENT.bpm) * 4;

interface Render {
  capture: Capture;
  counters: Record<string, number>;
}

async function renderBed(arrangement: ArrangementDocument): Promise<Render> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(arrangement);
  for (const id of FULL_PART_IDS) {
    const part = engine.getPart(musicPartName(FULL_SLOT[id]));
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

describe('the reference document equals the #69b TypeScript arrangement', () => {
  it('normalises to exactly the fixture, with nothing corrected', () => {
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.dangling).toEqual([]);
    // No fill was offered and none was needed: the reference document already
    // carries every patch it plays (#562).
    expect(result.filled).toEqual([]);
    const { patches, ...arrangement } = result.document;
    const { patches: fixturePatches, ...fixture } = FULL_DOCUMENT;
    expect(arrangement).toEqual(fixture);
    expect(Object.keys(patches ?? {}).sort()).toEqual(Object.keys(fixturePatches).sort());
    expect(FULL_DOCUMENT.parts.map(({ strip: _s, ...part }) => part)).toEqual(
      FULL_ARRANGEMENT.parts,
    );
    expect(FULL_PART_IDS.map((id) => FULL_PARTS[id].preset).sort()).toEqual(
      Object.keys(fixturePatches).sort(),
    );
  });

  it(`renders the first ${BARS} bars sample-identically through the full stack`, async () => {
    // `fromTs` carries the library's patches, `fromJson` the document's
    // snapshots; what this compares is the arrangement they play, not their
    // timbre, which this stand-in cannot see.
    const fromJson = await renderBed(makeArrangement(raw).document);
    const fromTs = await renderBed(FULL_DOCUMENT);
    for (const id of FULL_PART_IDS) expect(fromTs.counters[FULL_SLOT[id]], id).toBeGreaterThan(0);
    expect(fromJson.counters).toEqual(fromTs.counters);
    expect(maxAbsDiff(fromJson.capture.left, fromTs.capture.left)).toBe(0);
    expect(maxAbsDiff(fromJson.capture.right, fromTs.capture.right)).toBe(0);
  });
});
