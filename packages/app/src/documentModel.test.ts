/**
 * The console's document state, on the one path only the editor takes (#562):
 * opening a song that names library patches without carrying them. The library
 * fills what the document omits, the model says which ids it filled, and the
 * export is self-contained from then on.
 */
import { describe, expect, it } from 'vitest';

import { PRESETS, makeArrangement } from '../../../packages/client/src/audio/index-for-editor';
import { DocumentModel, deepMerge, mergeDocument } from './documentModel';

/** A song naming library ids with no `patches` section. */
const OLD_SONG = {
  version: 2,
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  parts: [
    {
      slot: 0,
      name: 'kick',
      preset: 'kick',
      velocity: 1,
      sequencer: { kind: 'euclidean', note: 36, hold: 0.2 },
    },
    { slot: 2, name: 'arp', preset: 'saw-arp', velocity: 0.7, sequencer: { kind: 'arp' } },
  ],
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
    // Half the library's level: derived, not pinned, so a re-tune stays free.
    expect(PRESETS.kick?.volume).toBeGreaterThan(0);
    const forked = PRESETS.kick!.volume / 2;
    const model = new DocumentModel({ ...OLD_SONG, patches: { kick: { volume: forked } } });
    expect(model.filled).toEqual(['saw-arp']);
    expect(model.doc.patches?.kick?.volume).toBe(forked);
    expect(forked).not.toBe(PRESETS.kick?.volume);
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

describe('a slot-addressed merge (#597)', () => {
  it('edits the part on the named slot wherever it sits in the list', () => {
    const model = new DocumentModel(OLD_SONG);
    model.merge({ parts: { 2: { velocity: 0.25, strip: { pan: -0.5 } } } });
    expect(model.doc.parts.map((p) => p.velocity)).toEqual([1, 0.25]);
    expect(model.doc.parts[1]?.strip.pan).toBe(-0.5);
  });

  it('never invents a part for a slot the song does not hold', () => {
    const merged = mergeDocument(OLD_SONG, { parts: { 5: { velocity: 0.1 } } }) as typeof OLD_SONG;
    expect(merged.parts).toEqual(OLD_SONG.parts);
  });

  it('renames a part without touching anything keyed to it', () => {
    const model = new DocumentModel(OLD_SONG);
    const before = model.doc.parts[0];
    model.merge({ parts: { 0: { name: 'boom' } } });
    expect(model.doc.parts[0]).toEqual({ ...before, name: 'boom' });
  });

  it('round-trips a mixed-kind song through export and import', () => {
    const model = new DocumentModel({
      ...OLD_SONG,
      parts: [
        ...OLD_SONG.parts,
        {
          slot: 7,
          name: 'drone',
          preset: 'drone-sqr',
          strip: { level: 0.5 },
          sequencer: { kind: 'step' },
        },
        { slot: 4, name: 'blank', preset: 'kick', sequencer: { kind: 'none' } },
      ],
    });
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
  });
});

describe('deepMerge', () => {
  it('creates keys the current document lacks and replaces arrays wholesale', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
    expect(deepMerge({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
  });
});
