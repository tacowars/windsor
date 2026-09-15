/**
 * The console's document state, on the one path only the editor takes (#562):
 * opening a song written before songs carried their patches. The library
 * fills what the document omits, the model says which ids it filled, and the
 * export is self-contained from then on.
 */
import { describe, expect, it } from 'vitest';

import { PRESETS, makeArrangement } from '../../../packages/client/src/audio/index-for-editor';
import { DocumentModel, deepMerge } from './documentModel';

/** A pre-#562 song: four parts naming library ids, no `patches` section. */
const OLD_SONG = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  kick: { part: 'kick', preset: 'kick', note: 36, velocity: 1, hold: 0.2 },
  arp: { part: 'arp', preset: 'saw-arp', velocity: 0.7 },
};

describe('opening a document written before #562', () => {
  it('fills the parts from the library and lists what it filled', () => {
    const model = new DocumentModel(OLD_SONG);
    expect(model.usable).toBe(true);
    expect(model.dangling).toEqual([]);
    expect(model.filled).toEqual(['kick', 'saw-arp']);
    expect(model.doc.patches?.kick).toEqual(PRESETS.kick);
    expect(model.doc.patches?.['saw-arp']).toEqual(PRESETS['saw-arp']);
  });

  it('exports a document carrying every patch its parts play', () => {
    const model = new DocumentModel(OLD_SONG);
    const exported = JSON.parse(model.toJson()) as { patches?: Record<string, unknown> };
    expect(Object.keys(exported.patches ?? {}).sort()).toEqual(['kick', 'saw-arp']);
    // The game rule: re-read with no fill, it resolves and nothing is filled.
    const reread = makeArrangement(exported);
    expect(reread.usable).toBe(true);
    expect(reread.dangling).toEqual([]);
    expect(reread.filled).toEqual([]);
    expect(reread.corrections).toEqual([]);
  });

  it('stops reporting a fill once the document carries the patch', () => {
    const model = new DocumentModel(JSON.parse(new DocumentModel(OLD_SONG).toJson()));
    expect(model.filled).toEqual([]);
  });

  it('keeps a forked patch over the library and fills only the rest', () => {
    const model = new DocumentModel({ ...OLD_SONG, patches: { kick: { volume: 0.05 } } });
    expect(model.filled).toEqual(['saw-arp']);
    expect(model.doc.patches?.kick?.volume).toBe(0.05);
    expect(PRESETS.kick?.volume).not.toBe(0.05);
  });

  it('keeps the fill across a knob edit, which renormalises the whole document', () => {
    const model = new DocumentModel(OLD_SONG);
    model.merge({ bpm: 100 });
    expect(model.doc.bpm).toBe(100);
    // Already embedded by the open, so the merge fills nothing new.
    expect(model.filled).toEqual([]);
    expect(Object.keys(model.doc.patches ?? {}).sort()).toEqual(['kick', 'saw-arp']);
  });
});

describe('deepMerge', () => {
  it('creates keys the current document lacks and replaces arrays wholesale', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
    expect(deepMerge({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
  });
});
