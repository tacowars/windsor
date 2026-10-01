/**
 * The live engine takes a part's automation lanes and ignores them
 * (windsor#342 decision 7): a song with lanes builds, and a partial carrying
 * `automation` is neither refused nor reported unknown, whether the part had
 * lanes when it was built or not. Nothing plays a lane until windsor#344.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { AUTOMATION_LANES } from '../__fixtures__/automationSong';
import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';
import { withoutAutomation } from './automationPartial';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(document: ArrangementDocument): Promise<AudioSystem> {
  const context = new FakeContext();
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  return sys;
}

const { hat, kick, drone } = FULL_SLOT;

/**
 * The fixture's strip and voice lanes on the hat: the fake context has no
 * Tape worklet to build its inserts with, and an insert lane is the
 * normaliser's to check, not the engine's.
 */
const STRIP_AND_VOICE = AUTOMATION_LANES.filter((lane) => !lane.target.startsWith('insert.'));
const WITH_LANES = withDocumentPart(FULL_DOCUMENT, 'hat', { automation: STRIP_AND_VOICE });

describe('automation in the live engine', () => {
  it('builds a song with lanes', async () => {
    const sys = await system(WITH_LANES);
    expect(sys.strip(musicPartName(hat))?.part.gain.value).toBe(FULL_STRIPS.hat.level);
  });

  it('accepts lanes on a part built without any, unreported', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ parts: { [kick]: { automation: AUTOMATION_LANES } } })).toEqual({
      ok: true,
      ignored: [],
    });
  });

  it('accepts lanes beside other edits, which still land', async () => {
    const sys = await system(WITH_LANES);
    const partial = { parts: { [hat]: { automation: [], strip: { level: 0.3 }, velocity: 0.4 } } };
    expect(sys.apply(partial)).toEqual({ ok: true, ignored: [] });
    expect(sys.strip(musicPartName(hat))?.part.gain.value).toBe(0.3);
  });

  it('accepts a whole part added with lanes', async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      parts: FULL_DOCUMENT.parts.filter((part) => part.slot !== drone),
    });
    const added = { ...FULL_PARTS.drone, strip: FULL_STRIPS.drone, automation: AUTOMATION_LANES };
    expect(sys.apply({ parts: { [drone]: added } })).toEqual({ ok: true, ignored: [] });
    expect(sys.strip(musicPartName(drone))).toBeDefined();
  });
});

describe('withoutAutomation', () => {
  it("takes out each slot's lanes and leaves removals, junk and absence as they came", () => {
    expect(withoutAutomation(undefined)).toBeUndefined();
    expect(withoutAutomation({ 1: { automation: [], velocity: 0.5 }, 2: null })).toEqual({
      1: { velocity: 0.5 },
      2: null,
    });
    expect(withoutAutomation('junk' as never)).toBe('junk');
  });
});
