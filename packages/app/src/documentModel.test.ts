/**
 * The console's document state, on the one path only the editor takes (#562):
 * opening a song that names library patches without carrying them. The library
 * fills what the document omits, the model says which ids it filled, and the
 * export is self-contained from then on.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { makeArrangement, partAt } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { DocumentModel, deepMerge, mergeDocument } from './documentModel';
import { loadBuiltIns } from './builtInLibrary';

// The built-in library loads on demand in the page; these tests read it.
beforeAll(() => loadBuiltIns());

/** Live for the whole four-bar song: what every fixture part carries (#705). */
const WHOLE = [{ start: 0, duration: 4 * 96 }];

/** A song naming library ids with no `patches` section. */
const OLD_SONG = {
  version: 3,
  transport: { bpm: 96, bars: 4 },
  harmony: { root: 2, scale: 'dorian' },
  parts: [
    {
      slot: 0,
      name: 'kick',
      preset: 'kick',
      velocity: 1,
      regions: WHOLE,
      sequencer: { kind: 'euclidean', seed: 0, note: 36, hold: 0.2 },
    },
    {
      slot: 2,
      name: 'arp',
      preset: 'saw-arp',
      velocity: 0.7,
      regions: WHOLE,
      sequencer: { kind: 'grid', seed: 0 },
    },
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
    model.merge({ transport: { bpm: 100 } });
    expect(model.doc.transport.bpm).toBe(100);
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

  it('leaves a fragment for a slot the song does not hold alone', () => {
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
          regions: WHOLE,
          sequencer: { kind: 'chord' },
        },
        { slot: 4, name: 'blank', preset: 'kick', regions: WHOLE, sequencer: { kind: 'none' } },
      ],
    });
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
  });
});

describe('adding and removing live (#629)', () => {
  it('appends a whole part on a free slot — the normaliser’s own fill, so no correction', () => {
    const model = new DocumentModel(OLD_SONG);
    const raw = {
      ...model.doc,
      parts: [
        ...model.doc.parts,
        { slot: 5, name: 'new', preset: 'kick', regions: WHOLE, sequencer: { kind: 'none' } },
      ],
    };
    const part = partAt(model.preview(raw), 5);
    if (!part) throw new Error('preview fills the new part');
    expect(part.strip).toBeDefined();
    model.merge({ parts: { 5: part } });
    expect(model.doc.parts.map((p) => p.slot)).toEqual([0, 2, 5]);
    expect(model.doc.parts[2]).toEqual(part);
    expect(model.corrections).toEqual([]);
    // Preview adopted nothing.
    expect(new DocumentModel(OLD_SONG).doc.parts).toHaveLength(2);
  });

  it('removes the part at a null slot and the patch at a null id', () => {
    const model = new DocumentModel(OLD_SONG);
    expect(model.doc.patches?.['saw-arp']).toBeDefined();
    model.merge({ parts: { 2: null }, patches: { 'saw-arp': null } });
    expect(model.doc.parts.map((p) => p.slot)).toEqual([0]);
    expect(model.doc.patches?.['saw-arp']).toBeUndefined();
    expect(model.doc.patches?.['kick']).toBeDefined();
    expect(model.corrections).toEqual([]);
    expect(model.dangling).toEqual([]);
  });

  it('a null at an absent slot or id is a no-op, and a fragment never appends', () => {
    const merged = mergeDocument(OLD_SONG, {
      parts: { 7: null, 5: { velocity: 1 } },
      patches: { nope: null },
    }) as typeof OLD_SONG & { patches?: unknown };
    expect(merged.parts).toEqual(OLD_SONG.parts);
    expect(merged.patches).toBeUndefined();
  });

  it('round-trips an added part through export and import', () => {
    const model = new DocumentModel(OLD_SONG);
    const raw = {
      ...model.doc,
      parts: [
        ...model.doc.parts,
        {
          slot: 1,
          name: 'hat',
          preset: 'hat',
          regions: WHOLE,
          sequencer: { kind: 'euclidean', seed: 0 },
        },
      ],
    };
    model.merge({ parts: { 1: partAt(model.preview(raw), 1) }, patches: { hat: PRESETS['hat'] } });
    const reopened = new DocumentModel(JSON.parse(model.toJson()) as unknown);
    expect(reopened.toJson()).toBe(model.toJson());
    expect(reopened.filled).toEqual([]);
  });
});

describe('grid parts (#603)', () => {
  it('round-trips a 32-step and a 7-step grid part through export and import', () => {
    const note = (degree: number, over: Record<string, unknown> = {}) => ({
      kind: 'note',
      degree,
      octave: 0,
      accent: false,
      slide: false,
      ...over,
    });
    const long = Array.from({ length: 32 }, (_, i) =>
      i % 4 === 3 ? { kind: 'tie' } : note(i % 7, { accent: i % 8 === 0, slide: i % 5 === 0 }),
    );
    const short = [
      note(0),
      { kind: 'rest' },
      note(4, { octave: 1 }),
      { kind: 'tie' },
      note(2),
      note(6),
      note(9),
    ];
    const model = new DocumentModel({
      ...OLD_SONG,
      parts: [
        ...OLD_SONG.parts,
        {
          slot: 5,
          name: 'acid',
          preset: 'saw-arp',
          regions: WHOLE,
          sequencer: {
            kind: 'grid',
            seed: 7,
            steps: long,
            length: 24,
            skipChance: 0.1,
            accentMod: 0.8,
          },
        },
        {
          slot: 6,
          name: 'seven',
          preset: 'saw-arp',
          regions: WHOLE,
          sequencer: { kind: 'grid', seed: 0, divisor: 12, steps: short, register: { octave: 1 } },
        },
      ],
    });
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
    const acid = reopened.doc.parts.find((p) => p.slot === 5)?.sequencer;
    expect(acid?.kind === 'grid' && acid.length).toBe(24);
    expect(acid?.kind === 'grid' && acid.steps).toHaveLength(32);
    const seven = reopened.doc.parts.find((p) => p.slot === 6)?.sequencer;
    expect(seven?.kind === 'grid' && seven.length).toBe(7);
  });
});

describe('chord parts (#607)', () => {
  it('export → import of a 32-step and a 1-step chord part equals the model’s document', () => {
    const hit = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      kind: 'hit',
      inversion: 0,
      octave: 0,
      duration: 1,
      repeat: 1,
      ...over,
    });
    const long = Array.from({ length: 32 }, (_, i) =>
      i % 5 === 4
        ? { kind: 'rest', duration: 0.5, repeat: 1 }
        : hit({
            inversion: i % 4,
            octave: (i % 3) - 1,
            duration: [0.25, 0.5, 1, 2, 4][i % 5],
            repeat: (i % 8) + 1,
          }),
    );
    const model = new DocumentModel({
      ...OLD_SONG,
      parts: [
        ...OLD_SONG.parts,
        {
          slot: 5,
          name: 'pad',
          preset: 'saw-arp',
          regions: WHOLE,
          sequencer: { kind: 'chord', steps: long, voicing: 'drop2', gate: 0.5, divisor: 48 },
        },
        {
          slot: 6,
          name: 'one',
          preset: 'saw-arp',
          regions: [
            { start: 96, duration: 96 },
            { start: 288, duration: 96 },
          ],
          sequencer: { kind: 'chord', steps: [hit({ inversion: 2 })], register: { octave: 1 } },
        },
        { slot: 7, name: 'blank', preset: 'saw-arp', regions: WHOLE, sequencer: { kind: 'chord' } },
      ],
    });
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
    const pad = reopened.doc.parts.find((p) => p.slot === 5)?.sequencer;
    expect(pad?.kind === 'chord' && pad.steps).toHaveLength(32);
    expect(pad?.kind === 'chord' && pad.voicing).toBe('drop2');
    const blank = reopened.doc.parts.find((p) => p.slot === 7)?.sequencer;
    expect(blank?.kind === 'chord' && blank.steps).toEqual([]);
  });
});

describe('Euclidean parts (#610)', () => {
  it('round-trips a captured 12-step Euclidean part through export and import', () => {
    const pattern = [true, false, false, true, false, true, false, false, true, false, true, false];
    const model = new DocumentModel({
      ...OLD_SONG,
      parts: [
        ...OLD_SONG.parts,
        {
          slot: 4,
          name: 'shaker',
          preset: 'kick',
          regions: WHOLE,
          sequencer: {
            kind: 'euclidean',
            seed: 3,
            steps: 12,
            pulses: { min: 2, max: 6, start: 5 },
            rotate: -3,
            density: { kind: 'walk', stepChance: 0.4 },
            pattern,
          },
        },
      ],
    });
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
    const shaker = reopened.doc.parts.find((p) => p.slot === 4)?.sequencer;
    expect(shaker?.kind === 'euclidean' && shaker.pattern).toEqual(pattern);
    expect(shaker?.kind === 'euclidean' && shaker.rotate).toBe(-3);
  });
});

describe('deepMerge', () => {
  it('creates keys the current document lacks and replaces arrays wholesale', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
    expect(deepMerge({ a: [1, 2, 3] }, { a: [4] })).toEqual({ a: [4] });
  });
});

describe('change listeners (the song autosave)', () => {
  it('hears every open, merge and mutate, until unsubscribed', () => {
    const model = new DocumentModel({ version: 3, parts: [] });
    let heard = 0;
    const stop = model.onChange(() => heard++);
    model.merge({ transport: { bpm: 100 } });
    model.mutate((draft) => {
      draft.transport = { bpm: 110 };
    });
    model.open({ version: 3, parts: [] });
    expect(heard).toBe(3);
    stop();
    model.merge({ transport: { bpm: 120 } });
    expect(heard).toBe(3);
  });
});
