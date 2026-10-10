/**
 * Each part owns its patch (windsor#669 decision 5): a song where parts share
 * a `patches` id is split as it opens. The lowest slot keeps the id, every
 * other part gets an identical copy under a fresh id with its `patchSource`
 * set, names stay, and nothing is deleted. A song with nothing shared opens
 * untouched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ArrangementDocument } from '@windsor/engine';
import { ARRANGEMENT_VERSION, makePatch, partAt } from '@windsor/engine';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { DocumentModel } from './documentModel';
import { initPresetId } from './libraryConstants';
import { library, loadPageLibrary } from './libraryModel';
import { initPatchDefaults } from './patchActions';
import { isolatePartPatches } from './partPatchIsolation';

beforeAll(() => loadPageLibrary(library));

const ICE = makePatch({ name: 'Ice Needle', volume: 0.3 });
const SCORE = makePatch({ name: 'Score Ice Needle', volume: 0.6 });

const part = (slot: number, preset: string, extra: Record<string, unknown> = {}) => ({
  slot,
  name: `Lead ${slot}`,
  preset,
  sequencer: { kind: 'none' },
  regions: [],
  ...extra,
});

/** A raw song: `parts`, over the two patches tacowars's song carried. */
const song = (parts: unknown[], patches: Record<string, unknown> = {}) => ({
  version: ARRANGEMENT_VERSION,
  patches: { 'ice-needle-copy': ICE, 'score-ice-needle': SCORE, ...patches },
  parts,
});

const doc = (raw: unknown): ArrangementDocument => new DocumentModel(raw).doc;
const NO_LIBRARY = new Set<string>();

describe('isolatePartPatches (windsor#669)', () => {
  it('gives the higher slot a copy and leaves an unplayed patch alone', () => {
    const shared = doc(song([part(0, 'ice-needle-copy'), part(1, 'ice-needle-copy')]));
    expect(isolatePartPatches(shared, NO_LIBRARY)).toEqual({
      parts: { 1: { preset: 'ice-needle-copy-2' } },
      patches: { 'ice-needle-copy-2': shared.patches?.['ice-needle-copy'] },
    });
  });

  it('takes an id free in the library and the song, and one per copy', () => {
    const shared = doc(
      song([part(0, 'bell'), part(2, 'bell'), part(1, 'bell')], { bell: ICE, 'bell-2': SCORE }),
    );
    const edit = isolatePartPatches(shared, new Set(['bell', 'bell-3']));
    expect(edit?.parts).toEqual({
      1: { preset: 'bell-4', patchSource: 'bell' },
      2: { preset: 'bell-5', patchSource: 'bell' },
    });
    expect(Object.keys(edit?.patches ?? {})).toEqual(['bell-4', 'bell-5']);
  });

  it("keeps a copied part's own patchSource over the shared id", () => {
    const shared = doc(
      song([part(0, 'ice-needle-copy'), part(1, 'ice-needle-copy', { patchSource: 'ice' })]),
    );
    const edit = isolatePartPatches(shared, new Set(['ice-needle-copy']));
    expect(edit?.parts).toEqual({ 1: { preset: 'ice-needle-copy-2', patchSource: 'ice' } });
  });

  it('is null when no id is shared, Init parts included', () => {
    const own = doc(song([part(0, 'ice-needle-copy'), part(1, 'score-ice-needle')]));
    expect(isolatePartPatches(own, NO_LIBRARY)).toBeNull();
    const inits = doc({
      ...song([part(0, initPresetId('0')), part(1, initPresetId('1'))]),
      patches: {
        [initPresetId('0')]: initPatchDefaults(),
        [initPresetId('1')]: initPatchDefaults(),
      },
    });
    expect(isolatePartPatches(inits, NO_LIBRARY)).toBeNull();
    expect(isolatePartPatches({ parts: [] }, NO_LIBRARY)).toBeNull();
  });
});

describe('opening a song splits shared patches (windsor#669)', () => {
  it("splits tacowars's song: slot 0 keeps the id, slot 1 plays an identical copy", async () => {
    const ctx = openGestureConsole();
    await ctx.importDoc(song([part(0, 'ice-needle-copy'), part(1, 'ice-needle-copy')]));
    const opened = ctx.model.doc;
    expect(partAt(opened, 0)?.preset).toBe('ice-needle-copy');
    expect(partAt(opened, 1)?.preset).toBe('ice-needle-copy-2');
    expect(opened.patches?.['ice-needle-copy-2']).toEqual(opened.patches?.['ice-needle-copy']);
    expect(opened.patches?.['score-ice-needle']).toEqual(SCORE);
    expect(opened.parts.map((each) => each.name)).toEqual(['Lead 0', 'Lead 1']);
    // A knob edit on one part leaves the other's patch as it was.
    ctx.change({ patches: { 'ice-needle-copy-2': { volume: 0.9 } } });
    expect(ctx.model.doc.patches?.['ice-needle-copy']?.volume).toBe(0.3);
  });

  it('opens a song with nothing shared as it came', async () => {
    const ctx = openGestureConsole();
    const raw = song([part(0, 'ice-needle-copy'), part(1, 'score-ice-needle')]);
    await ctx.importDoc(raw);
    expect(ctx.model.doc).toEqual(doc(raw));
  });
});
