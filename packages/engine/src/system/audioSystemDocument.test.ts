/**
 * `AudioSystem` over the document model (issues #75, #597): `initMusic` builds
 * only the parts the document lists, each registered under its slot and
 * landing on its own strip; `apply` takes a deep partial of the same model —
 * arrangement fields through the player, a part's `strip` straight onto its
 * live strip — changing only the fields it names, never half-applying.
 *
 * Since #562 the game path resolves a part's `preset` in the document's own
 * `patches` and nowhere else: the embedded snapshot is what plays, and a name
 * the document does not carry is a load error rather than a quiet fall back
 * to the library.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
  type FullPartId,
} from '../__fixtures__/fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { AudioSystem } from './audioSystem';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { clonePatch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ } from '../audioConstants';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { MAX_INSERTS } from '../inserts/insertConstants';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(document: ArrangementDocument): Promise<AudioSystem> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  // The strips' insert fade runs at once, so a test sees the settled graph (#652).
  const sys = new AudioSystem(engine, { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  return sys;
}

const stripOf = (sys: AudioSystem, id: FullPartId) => sys.strip(musicPartName(FULL_SLOT[id]));

const { kick, hat, arp } = FULL_SLOT;

const KICK_ONLY: ArrangementDocument = {
  ...FULL_DOCUMENT,
  parts: FULL_DOCUMENT.parts.filter((part) => part.slot === kick),
};

describe('initMusic over a document', () => {
  it('builds only the parts the document lists, under their slots', async () => {
    const sys = await system(KICK_ONLY);
    expect(stripOf(sys, 'kick')).toBeDefined();
    expect(stripOf(sys, 'hat')).toBeUndefined();
    expect(stripOf(sys, 'arp')).toBeUndefined();
    expect(stripOf(sys, 'drone')).toBeUndefined();
    // Never under the label: a name keys nothing (#597).
    expect(sys.strip('kick')).toBeUndefined();
  });

  it('lands each part on its own strip', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { level: 0.25, pan: -0.5, lowCut: LOW_CUT_MIN_HZ, sends: { b: 0.1 }, inserts: [] },
    });
    const sys = await system(doc);
    expect(stripOf(sys, 'hat')?.part.gain.value).toBe(0.25);
    expect(stripOf(sys, 'hat')?.sends.get('b')?.gain.value).toBe(0.1);
    expect(stripOf(sys, 'kick')?.part.gain.value).toBe(FULL_STRIPS.kick.level);
  });

  it('builds a none part, playable from the keyboard, that nothing sequences', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'arp', { sequencer: { kind: 'none' } });
    const sys = await system(doc);
    const part = stripOf(sys, 'arp')?.part;
    expect(part).toBeDefined();
    expect(() => part?.noteOn(60, 0.8)).not.toThrow();
    expect(sys.readout().counters[arp]).toBe(0);
  });
});

describe('the document is the only patch table (#562)', () => {
  it('plays the embedded snapshot where the library patch of that id differs', async () => {
    const id = FULL_PARTS.kick.preset;
    const fromLibrary = PRESETS[id];
    expect(fromLibrary?.volume).toBeGreaterThan(0);
    // The snapshot this song carries is deliberately not the library's — half
    // its level, derived here rather than pinned, so re-tuning it stays free.
    const snapshot = fromLibrary!.volume / 2;
    const embedded = { ...clonePatch(fromLibrary!), volume: snapshot, name: 'Snapshot Kick' };
    const sys = await system({
      ...FULL_DOCUMENT,
      patches: { ...FULL_DOCUMENT.patches, [id]: embedded },
    });
    expect(stripOf(sys, 'kick')?.part.patch.volume).toBe(snapshot);
    expect(stripOf(sys, 'kick')?.part.patch.name).toBe('Snapshot Kick');
    expect(snapshot).not.toBe(fromLibrary?.volume);
    // A live edit to the part lands on the document's table, not the library's.
    expect(sys.apply({ patches: { [id]: { volume: snapshot / 2 } } }).ok).toBe(true);
    expect(PRESETS[id]?.volume).toBe(fromLibrary?.volume);
  });

  it('fails the load naming the part and the id when the document omits a patch', async () => {
    const { kick: kickPatch, ...patches } = FULL_DOCUMENT.patches;
    expect(kickPatch).toBeDefined();
    await expect(system({ ...FULL_DOCUMENT, patches })).rejects.toThrow(
      /^part 0: the song document defines no patch "kick"/,
    );
    // And it is not the library that would have supplied it: the id is there.
    expect(PRESETS.kick).toBeDefined();
  });

  it('fails the load when the document has no patches section at all', async () => {
    const { patches, ...arrangement } = FULL_DOCUMENT;
    expect(patches).toBeDefined();
    await expect(system(arrangement)).rejects.toThrow(/defines no patch "kick"/);
  });
});

describe('apply over the document model', () => {
  it('changes only the strip fields the partial names', async () => {
    const sys = await system(FULL_DOCUMENT);
    const strip = stripOf(sys, 'hat');
    const echoBefore = strip?.sends.get('b')?.gain.value;
    expect(sys.apply({ parts: { [hat]: { strip: { level: 0.3 } } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(strip?.part.gain.value).toBe(0.3);
    expect(strip?.sends.get('b')?.gain.value).toBe(echoBefore);
  });

  it('lands the document low cut on the strip, and moves it live, clamped (#640)', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, lowCut: 180 },
    });
    const sys = await system(doc);
    const cutOf = (): number | undefined => stripOf(sys, 'hat')?.lowCut.filter.frequency.value;
    expect(cutOf()).toBe(180);
    expect(stripOf(sys, 'kick')?.lowCut.filter.frequency.value).toBe(LOW_CUT_MIN_HZ);
    expect(sys.apply({ parts: { [hat]: { strip: { lowCut: 90 } } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(cutOf()).toBe(90);
    sys.apply({ parts: { [hat]: { strip: { lowCut: LOW_CUT_MAX_HZ * 4 } } } });
    expect(cutOf()).toBe(LOW_CUT_MAX_HZ);
    const junk = sys.apply({ parts: { [hat]: { strip: { lowCut: 'high' } } } } as never);
    expect(junk.ignored).toEqual([`parts.${hat}.strip.lowCut`]);
    expect(cutOf()).toBe(LOW_CUT_MAX_HZ);
  });

  it('builds the document inserts on the strip, after the low cut (#641)', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [{ ...DEFAULT_DRIVE, drive: 18 }] },
    });
    const sys = await system(doc);
    const strip = stripOf(sys, 'hat');
    expect(strip?.inserts.map((i) => i.kind)).toEqual(['drive']);
    expect(strip?.stages).toEqual([strip?.lowCut, strip?.inserts[0]]);
    expect(stripOf(sys, 'kick')?.inserts).toEqual([]);
  });

  it('turns an insert knob live as a param write, with nothing rebuilt (#641)', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [DEFAULT_DRIVE] },
    });
    const sys = await system(doc);
    const stage = stripOf(sys, 'hat')?.inserts[0];
    const partial = { inserts: [{ ...DEFAULT_DRIVE, drive: 30 }] };
    expect(sys.apply({ parts: { [hat]: { strip: partial } } })).toEqual({ ok: true, ignored: [] });
    expect(stripOf(sys, 'hat')?.inserts[0]).toBe(stage);
  });

  it('adds and removes an insert live on one strip, and nothing else moves (#641)', async () => {
    const sys = await system(FULL_DOCUMENT);
    const hatStrip = stripOf(sys, 'hat');
    const kickStrip = stripOf(sys, 'kick');
    const kickPart = sys.engine.getPart(musicPartName(kick));
    const counters = { ...sys.readout().counters };

    expect(sys.apply({ parts: { [hat]: { strip: { inserts: [DEFAULT_DRIVE] } } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(stripOf(sys, 'hat')).toBe(hatStrip);
    expect(hatStrip?.inserts.map((i) => i.kind)).toEqual(['drive']);
    expect(stripOf(sys, 'kick')).toBe(kickStrip);
    expect(kickStrip?.inserts).toEqual([]);
    expect(sys.engine.getPart(musicPartName(kick))).toBe(kickPart);
    expect(sys.readout().counters).toEqual(counters);

    sys.apply({ parts: { [hat]: { strip: { inserts: [] } } } });
    expect(hatStrip?.inserts).toEqual([]);
    expect(hatStrip?.tail).toBe(hatStrip?.lowCut.output);
  });

  it('reorders a strip’s inserts live, moving the stages and touching nothing else (#652)', async () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [DEFAULT_DRIVE, DEFAULT_CHORUS] },
    });
    const sys = await system(doc);
    const hatStrip = stripOf(sys, 'hat');
    const live = [...(hatStrip?.inserts ?? [])];
    const kickStrip = stripOf(sys, 'kick');
    const kickPart = sys.engine.getPart(musicPartName(kick));
    const counters = { ...sys.readout().counters };

    const reversed = { inserts: [DEFAULT_CHORUS, DEFAULT_DRIVE] };
    expect(sys.apply({ parts: { [hat]: { strip: reversed } } })).toEqual({ ok: true, ignored: [] });

    expect(hatStrip?.inserts.map((i) => i.kind)).toEqual(['chorus', 'drive']);
    // The same two stages, swapped: a chorus keeps its delay contents.
    expect(hatStrip?.inserts).toEqual([live[1], live[0]]);
    expect(hatStrip?.tail).toBe(live[0]?.output);
    expect(stripOf(sys, 'kick')).toBe(kickStrip);
    expect(sys.engine.getPart(musicPartName(kick))).toBe(kickPart);
    expect(sys.readout().counters).toEqual(counters);
  });

  it('reports a junk insert list, an unknown kind and a list past the limit by path (#641)', async () => {
    const sys = await system(FULL_DOCUMENT);
    const path = `parts.${hat}.strip.inserts`;
    expect(
      sys.apply({ parts: { [hat]: { strip: { inserts: 'drive' } } } } as never).ignored,
    ).toEqual([path]);
    const unknown = sys.apply({
      parts: { [hat]: { strip: { inserts: [{ kind: 'fuzz' }, DEFAULT_DRIVE] } } },
    } as never);
    expect(unknown.ignored).toEqual([`${path}[0]`]);
    expect(stripOf(sys, 'hat')?.inserts.map((i) => i.kind)).toEqual(['drive']);
    const many = Array.from({ length: MAX_INSERTS + 1 }, () => DEFAULT_DRIVE);
    const past = sys.apply({ parts: { [hat]: { strip: { inserts: many } } } });
    expect(past.ignored).toEqual([`${path}[${MAX_INSERTS}]`]);
    expect(stripOf(sys, 'hat')?.inserts).toHaveLength(MAX_INSERTS);
    // A clamp is silent, as it is for every live number.
    expect(
      sys.apply({ parts: { [hat]: { strip: { inserts: [{ ...DEFAULT_DRIVE, drive: 999 }] } } } })
        .ignored,
    ).toEqual([]);
  });

  it('sets sends live and clamps into range', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ parts: { [hat]: { strip: { sends: { b: 2 } } } } }).ok).toBe(true);
    expect(stripOf(sys, 'hat')?.sends.get('b')?.gain.value).toBe(1);
  });

  it('sets a send the part had no amount for yet: every strip reaches every return', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ parts: { [kick]: { strip: { sends: { a: 0.4 } } } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(stripOf(sys, 'kick')?.sends.get('a')?.gain.value).toBe(0.4);
  });

  it('reports unknown slots, returns and fields in ignored', async () => {
    const sys = await system(FULL_DOCUMENT);
    const result = sys.apply({
      parts: { 6: { strip: { level: 1 } }, [hat]: { strip: { wat: 3, sends: { cave: 0.5 } } } },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ignored.sort()).toEqual([
      'parts.1.strip.sends.cave',
      'parts.1.strip.wat',
      'parts.6',
    ]);
  });

  it('does not touch a strip when the arrangement half fails validation', async () => {
    const sys = await system(FULL_DOCUMENT);
    const before = stripOf(sys, 'hat')?.part.gain.value;
    const result = sys.apply({
      parts: { [arp]: { preset: 'nope' }, [hat]: { strip: { level: 0.1 } } },
    });
    expect(result.ok).toBe(false);
    expect(stripOf(sys, 'hat')?.part.gain.value).toBe(before);
  });

  it('applies arrangement fields and strip fields from one partial', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(
      sys.apply({
        transport: { bpm: 90 },
        parts: { [kick]: { velocity: 0.5, strip: { pan: 0.5 } } },
      }).ok,
    ).toBe(true);
    expect(sys.readout().bpm).toBe(90);
  });
});

describe('live add and removal (#629)', () => {
  const { drone } = FULL_SLOT;
  const THREE: ArrangementDocument = {
    ...FULL_DOCUMENT,
    parts: FULL_DOCUMENT.parts.filter((part) => part.slot !== drone),
  };
  const DRONE = FULL_DOCUMENT.parts.find((part) => part.slot === drone);
  if (!DRONE) throw new Error('the fixture has a drone');

  it('creates the engine part and its strip on a live add, the strip from the partial', async () => {
    const sys = await system(THREE);
    expect(sys.engine.getPart(musicPartName(drone))).toBeUndefined();
    const metered = sys.meteredProcessors;
    expect(sys.apply({ parts: { [drone]: DRONE } })).toEqual({ ok: true, ignored: [] });
    expect(sys.engine.getPart(musicPartName(drone))).toBeDefined();
    expect(stripOf(sys, 'drone')?.part.gain.value).toBe(FULL_STRIPS.drone.level);
    expect(stripOf(sys, 'drone')?.sends.get('a')?.gain.value).toBe(FULL_STRIPS.drone.sends.a);
    expect(sys.meteredProcessors).toBe(metered + 1);
    expect(sys.readout().counters).toHaveProperty(String(drone), 0);
  });

  it('disposes the part, its strip and its meter entry on a live removal, and frees the slot', async () => {
    const sys = await system(FULL_DOCUMENT);
    const metered = sys.meteredProcessors;
    expect(sys.apply({ parts: { [drone]: null } })).toEqual({ ok: true, ignored: [] });
    expect(sys.engine.getPart(musicPartName(drone))).toBeUndefined();
    expect(stripOf(sys, 'drone')).toBeUndefined();
    expect(stripOf(sys, 'kick')).toBeDefined();
    expect(sys.meteredProcessors).toBe(metered - 1);
    expect(sys.readout().counters).not.toHaveProperty(String(drone));
    // The slot is free again: the same part comes back under the same name.
    expect(sys.apply({ parts: { [drone]: DRONE } })).toEqual({ ok: true, ignored: [] });
    expect(sys.engine.getPart(musicPartName(drone))).toBeDefined();
  });

  it('a refused add creates nothing, and a refused removal disposes nothing', async () => {
    const sys = await system(THREE);
    const unknown = sys.apply({ parts: { [drone]: { ...DRONE, preset: 'nope' } } });
    expect(unknown.ok).toBe(false);
    expect(sys.engine.getPart(musicPartName(drone))).toBeUndefined();
    const half = sys.apply({ transport: { bpm: 0 }, parts: { [hat]: null } });
    expect(half.ok).toBe(false);
    expect(stripOf(sys, 'hat')).toBeDefined();
  });
});
