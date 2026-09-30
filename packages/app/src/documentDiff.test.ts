/**
 * The document difference (windsor#124): for every kind of edit the console
 * makes, `normalise(mergeDocument(a, documentDiff(a, b)))` is `b` again, in
 * both directions (the undo and the redo). The pairs are made the way the
 * console makes them, by merging an edit's partial into a fixture and
 * normalising, so `b` is always a document the model could hold.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { ArrangementDocument, DocumentPartial, PartStrip } from '@windsor/engine';
import {
  DEFAULT_DRIVE,
  RETURNS,
  TICKS_PER_BAR,
  clonePatch,
  makeArrangement,
  musicPartName,
  partAt,
  removePartChange,
} from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import type { FakeGain, FakeNode } from '@windsor/engine/__fixtures__/fakeAudioNodes';
import { installSidechainWorklet, sidechainRig } from '@windsor/engine/__fixtures__/sidechainRig';
import { PRESETS } from '@windsor/engine/patch/presets';
import { partChange } from './context';
import { deepEqual, documentDiff, documentDiffLive } from './documentDiff';
import { mergeDocument } from './documentModel';
import { appendEvent } from './harmonyLaneModel';
import { addPartChange, sequencerKindChange } from './partEdits';
import { followSongLength } from './regionModel';
import { newSong } from './songParts';
import { barsChange, loopToggle, swingChange } from './transportModel';

const restoreWorklet = installSidechainWorklet();
afterAll(restoreWorklet);

const normalise = (raw: unknown): ArrangementDocument => makeArrangement(raw).document;
const merged = (doc: ArrangementDocument, partial: unknown): ArrangementDocument =>
  normalise(mergeDocument(doc, partial));

const FULL = normalise(FULL_DOCUMENT);
const FRESH = normalise(newSong());
const HAT = FULL_SLOT.hat;
const ARP = FULL_SLOT.arp;
const DRONE = FULL_SLOT.drone;

/** Both directions of one pair: the undo (b back to a) and the redo (a on to b). */
function expectRoundTrip(a: ArrangementDocument, b: ArrangementDocument): void {
  expect(b).not.toStrictEqual(a);
  expect(merged(a, documentDiff(a, b))).toStrictEqual(b);
  expect(merged(b, documentDiff(b, a))).toStrictEqual(a);
}

/** The document `edit` makes of `doc`, as `DocumentModel.merge` makes it. */
const after = (doc: ArrangementDocument, edit: DocumentPartial): ArrangementDocument =>
  merged(doc, edit);

const addedPart = (doc: ArrangementDocument): ArrangementDocument => {
  const change = addPartChange(doc, normalise);
  if (!change) throw new Error('the fixture has a free slot');
  return after(doc, change.partial);
};

const removedPart = (doc: ArrangementDocument, slot: number): ArrangementDocument => {
  const change = removePartChange(doc, slot);
  if (!change) throw new Error(`the fixture holds slot ${slot} and another part`);
  return after(doc, change);
};

const kindChanged = (doc: ArrangementDocument, slot: number): ArrangementDocument => {
  const change = sequencerKindChange(doc, slot, 'bass', normalise);
  if (!change) throw new Error('the kind changes');
  return after(doc, change);
};

/** The grid line's steps, back to front: a lane array edit. */
const arpSequencer = partAt(FULL, ARP)?.sequencer;
const reversedSteps = arpSequencer?.kind === 'grid' ? [...arpSequencer.steps].reverse() : [];

const PAIRS: ReadonlyArray<readonly [string, ArrangementDocument, ArrangementDocument]> = [
  ['a strip knob', FULL, after(FULL, partChange(HAT, { strip: { level: 0.33 } }))],
  ['a patch knob', FULL, after(FULL, { patches: { kick: { volume: 0.21 } } })],
  ['a patch filter knob', FULL, after(FULL, { patches: { hat: { filter: { resonance: 0.7 } } } })],
  ['a transport knob', FULL, after(FULL, { transport: { bpm: 133 } })],
  ['a part added', FULL, addedPart(FULL)],
  ['a part added to a new song', FRESH, addedPart(FRESH)],
  ['the last part removed', FULL, removedPart(FULL, DRONE)],
  [
    'a patch replaced',
    FULL,
    after(FULL, {
      parts: { [HAT]: { preset: 'kick' } },
      patches: { hat: null },
    }),
  ],
  [
    'a patch swapped for one the song did not carry',
    FULL,
    after(FULL, {
      parts: { [ARP]: { preset: 'lead-bell' } },
      patches: { 'saw-arp': null, 'lead-bell': clonePatch(PRESETS['lead-bell']!) },
    }),
  ],
  [
    'an unplayed patch removed',
    after(FULL, { patches: { 'lead-bell': clonePatch(PRESETS['lead-bell']!) } }),
    FULL,
  ],
  [
    'a return added to a song without returns',
    FULL,
    after(FULL, { returns: { a: { level: 0.4 } } }),
  ],
  ['both returns added', FULL, after(FULL, { returns: { a: { level: 0.4 }, b: { inserts: [] } } })],
  [
    'a return knob',
    after(FULL, { returns: { a: { level: 0.4 } } }),
    after(FULL, { returns: { a: { level: 0.7 } } }),
  ],
  [
    'a send bus chain emptied and filled again (windsor#172)',
    after(FULL, { returns: { a: { inserts: [] } } }),
    after(FULL, { returns: { a: { inserts: [DEFAULT_DRIVE, DEFAULT_DRIVE] } } }),
  ],
  [
    'a strip insert added',
    FULL,
    after(FULL, partChange(HAT, { strip: { inserts: [DEFAULT_DRIVE] } })),
  ],
  ['a master added with an insert', FULL, after(FULL, { master: { inserts: [DEFAULT_DRIVE] } })],
  [
    'an output stage added',
    after(FULL, { master: { level: 0.8 } }),
    after(FULL, { master: { level: 0.8, output: {} } }),
  ],
  [
    'a sidechain output set',
    FULL,
    after(FULL, partChange(HAT, { strip: { output: 'sidechain' } })),
  ],
  ['a mute set', FULL, after(FULL, partChange(HAT, { strip: { mute: true } }))],
  ['a solo set', FULL, after(FULL, partChange(HAT, { strip: { solo: true } }))],
  [
    'a harmony edit',
    FULL,
    after(FULL, { harmony: { events: appendEvent(FULL.harmony.events, 4 * TICKS_PER_BAR) } }),
  ],
  ['a key and a scale', FULL, after(FULL, { harmony: { root: 7, scale: [0, 3, 7] } })],
  [
    'a lane array edit',
    FULL,
    after(FULL, partChange(ARP, { sequencer: { steps: reversedSteps } })),
  ],
  [
    'a region edit',
    FULL,
    after(FULL, partChange(HAT, { regions: [{ start: 0, duration: TICKS_PER_BAR }] })),
  ],
  ['a sequencer kind change', FULL, kindChanged(FULL, HAT)],
  ['a Bars refit', FULL, after(FULL, followSongLength(FULL, barsChange(9)).partial)],
  ['swing added', FULL, after(FULL, swingChange({ amount: 50, grid: 16 }, { amount: 62 }))],
  ['a loop added', FULL, after(FULL, loopToggle(FULL.transport))],
];

describe('documentDiff round trips every kind of edit', () => {
  it.each(PAIRS)('%s', (_name, a, b) => expectRoundTrip(a, b));

  it('diffs two equal documents to an empty partial', () => {
    expect(documentDiff(FULL, normalise(FULL_DOCUMENT))).toEqual({});
    expect(documentDiff(FRESH, FRESH)).toEqual({});
  });

  it('keeps the partial to what changed', () => {
    const b = after(FULL, partChange(HAT, { strip: { level: 0.33 } }));
    expect(documentDiff(FULL, b)).toEqual({ parts: { [HAT]: { strip: { level: 0.33 } } } });
  });

  it('reads a removed slot and patch as null, and sends a restored part whole', () => {
    const b = removedPart(FULL, DRONE);
    const removal = documentDiff(FULL, b);
    expect(removal.parts?.[DRONE]).toBeNull();
    expect(removal.patches?.['drone-sqr']).toBeNull();
    const restore = documentDiff(b, FULL);
    expect(restore.parts?.[DRONE]).toEqual(partAt(FULL, DRONE));
    expect(restore.patches?.['drone-sqr']).toEqual(FULL.patches?.['drone-sqr']);
  });

  it('sends a sequencer whose kind changed whole', () => {
    const b = kindChanged(FULL, HAT);
    const partial = documentDiff(b, FULL) as { parts: Record<number, { sequencer: unknown }> };
    expect(partial.parts[HAT]?.sequencer).toEqual(partAt(FULL, HAT)?.sequencer);
  });
});

describe('documentDiffLive spells out a removed section for the engine', () => {
  it('sends the difference itself when nothing optional is removed', () => {
    const b = after(FULL, partChange(HAT, { strip: { level: 0.33 } }));
    expect(documentDiffLive(b, FULL, normalise)).toStrictEqual({
      live: documentDiff(b, FULL),
      rebuild: false,
    });
  });

  it("sends each removed section as the normaliser's defaults", () => {
    const b = after(FULL, {
      returns: { a: { level: 0.4 } },
      master: { level: 0.5, inserts: [DEFAULT_DRIVE], output: {} },
      transport: { swing: { amount: 62, grid: 16 } },
      parts: { [HAT]: { strip: { output: 'sidechain' } } },
    });
    const { live, rebuild } = documentDiffLive(b, FULL, normalise);
    const partial = documentDiff(b, FULL);
    expect(merged(b, partial)).toStrictEqual(FULL);
    expect(rebuild).toBe(false);
    const defaults = after(FULL, {
      returns: { a: {} },
      master: { output: {} },
      transport: { swing: {} },
    });
    expect(live).toStrictEqual({
      returns: defaults.returns,
      master: defaults.master,
      transport: { swing: defaults.transport.swing },
      parts: { [HAT]: { strip: { output: 'master' } } },
    });
    expect(deepEqual(live, partial)).toBe(false);
  });

  it('sends an undone mute and solo as an explicit false, which the live strip lands (windsor#154)', async () => {
    const b = after(FULL, partChange(HAT, { strip: { mute: true, solo: true } }));
    const { live, rebuild } = documentDiffLive(b, FULL, normalise);
    expect(rebuild).toBe(false);
    expect(live).toStrictEqual({ parts: { [HAT]: { strip: { mute: false, solo: false } } } });
    // The live system the undo reaches: muted and soloed, then back.
    const { system } = await sidechainRig(b);
    const hat = system.strip(musicPartName(HAT))!;
    const kick = system.strip(musicPartName(FULL_SLOT.kick))!;
    // The audible gain after a strip's head, which mute and solo close.
    const gate = (strip: PartStrip): number =>
      ((strip.head as unknown as FakeNode).outbound[0]!.to as FakeGain).gain.value;
    expect([hat.mute, kick.soloedOut, gate(hat), gate(kick)]).toEqual([true, true, 0, 0]);
    expect(system.apply(live)).toEqual({ ok: true, ignored: [] });
    expect([hat.mute, hat.solo, kick.soloedOut]).toEqual([false, false, false]);
    expect([gate(hat), gate(kick)]).toEqual([1, 1]);
    system.dispose();
  });

  it('sends a removed loop as the whole song, off', () => {
    const b = after(FULL, loopToggle(FULL.transport));
    const { live } = documentDiffLive(b, FULL, normalise);
    expect(live).toStrictEqual({
      transport: { loop: { start: 0, end: FULL.transport.bars * TICKS_PER_BAR, on: false } },
    });
  });

  it('sends one return removed beside another as the defaults a system built without it plays', () => {
    const a = after(FULL, { returns: { a: { level: 0.4 } } });
    const b = after(a, { returns: { b: { level: 0.3 } } });
    expect(documentDiffLive(b, a, normalise)).toStrictEqual({
      live: { returns: { b: RETURNS.b } },
      rebuild: false,
    });
  });
});

describe('documentDiffLive asks for a rebuild where the slot merge would reorder the parts', () => {
  const partOrder = (doc: ArrangementDocument): number[] => doc.parts.map((part) => part.slot);

  it('rebuilds to restore a removed middle part, which the merge would append', () => {
    const b = removedPart(FULL, HAT);
    expect(partOrder(FULL).indexOf(HAT)).toBeLessThan(FULL.parts.length - 1);
    expect(documentDiffLive(b, FULL, normalise).rebuild).toBe(true);
    // Removing it again is an ordinary live partial.
    expect(documentDiffLive(FULL, b, normalise).rebuild).toBe(false);
  });

  it('restores the last part removed live, where appending it is its place', () => {
    const b = removedPart(FULL, DRONE);
    expect(partOrder(FULL).at(-1)).toBe(DRONE);
    expect(documentDiffLive(b, FULL, normalise).rebuild).toBe(false);
    expect(documentDiffLive(FULL, addedPart(FULL), normalise).rebuild).toBe(false);
  });
});

describe('deepEqual', () => {
  it('compares JSON values structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
