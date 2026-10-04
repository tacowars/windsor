/**
 * The console's part-list edits (#598) through the real document model: the
 * new song it opens on, adding parts up to `MUSIC_PARTS_MAX`, removing one (and the patch
 * only it played), choosing a sequencer kind, renaming, and a mixed-kind song
 * surviving export → import.
 */
import { describe, expect, it } from 'vitest';

import type { Meter, PlayablePart } from '@windsor/engine';
import {
  ARRANGEMENT_VERSION,
  ArrangementPlayer,
  DEFAULT_EUCLIDEAN_CONFIG,
  MUSIC_PARTS_MAX,
  TICKS_PER_BAR,
  TickTransport,
  isShippable,
  makeArrangement,
  partAt,
  removePart,
  ticksPerBar,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { INIT_PATCH_NAME, initPresetId } from './libraryConstants';
import { addPart, newSong, nextFreeSlot, replaceDraft, setSequencerKind } from './songParts';

/** Apply a pure edit the way `ctx.restructure` does: over a draft, renormalised. */
const restructure = (model: DocumentModel, next: object): void =>
  model.mutate((draft) => replaceDraft(draft, next));

describe('newSong', () => {
  it('is one part on slot 0 playing its own Init patch, with no sequencer', () => {
    const result = makeArrangement(newSong());
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.dangling).toEqual([]);
    const { document } = result;
    expect(document.version).toBe(ARRANGEMENT_VERSION);
    expect(document.parts).toHaveLength(1);
    const [part] = document.parts;
    expect(part).toMatchObject({ slot: 0, name: 'Part 1', preset: initPresetId('0') });
    expect(part?.sequencer).toEqual({ kind: 'none' });
    expect(document.patches?.[initPresetId('0')]?.name).toBe(INIT_PATCH_NAME);
    // Silent until a sequencer is chosen, so not a song the game could ship.
    expect(isShippable(result)).toBe(false);
  });

  it('is a fresh object each time: editing one new song never reaches the next', () => {
    const a = newSong() as { parts: Array<{ name: string }> };
    a.parts[0]!.name = 'changed';
    expect((newSong() as { parts: Array<{ name: string }> }).parts[0]?.name).toBe('Part 1');
  });
});

describe('adding parts', () => {
  it('takes the lowest free slot', () => {
    const doc = makeArrangement({
      ...newSong(),
      parts: [
        { slot: 0, preset: initPresetId('0') },
        { slot: 2, preset: initPresetId('0') },
      ],
    }).document;
    expect(nextFreeSlot(doc)).toBe(1);
  });

  it('adds up to MUSIC_PARTS_MAX parts, each with its own Init patch, then stops', () => {
    const model = new DocumentModel(newSong());
    const slots = Array.from({ length: MUSIC_PARTS_MAX }, (_, slot) => slot);
    for (let i = 1; i < MUSIC_PARTS_MAX; i++) {
      const added = addPart(model.doc);
      expect(added?.slot).toBe(i);
      restructure(model, added!.doc);
    }
    expect(model.corrections).toEqual([]);
    expect(model.doc.parts.map((p) => p.slot)).toEqual(slots);
    expect(model.doc.parts.map((p) => p.name)).toEqual(slots.map((slot) => `Part ${slot + 1}`));
    const presets = new Set(model.doc.parts.map((p) => p.preset));
    expect(presets.size).toBe(MUSIC_PARTS_MAX);
    for (const preset of presets) expect(model.doc.patches?.[preset]).toBeDefined();
    expect(nextFreeSlot(model.doc)).toBeNull();
    expect(addPart(model.doc)).toBeNull();
  });
});

describe("in the song's meter (windsor#430)", () => {
  it('adds a part live for the whole 12/8 song: 576 ticks, not 384', () => {
    const model = new DocumentModel(newSong('12/8'));
    const added = addPart(model.doc)!;
    const part = (added.doc.parts as Array<{ regions: unknown }>).at(-1);
    expect(part?.regions).toEqual([{ start: 0, duration: 4 * ticksPerBar('12/8') }]);
    expect(4 * ticksPerBar('12/8')).toBe(576);
  });

  it('starts a new Grid part one bar long: 14 sixteenths in 7/8, 16 in 4/4', () => {
    const steps = (meter?: Meter): number => {
      const model = new DocumentModel(newSong(meter));
      restructure(model, setSequencerKind(model.doc, 0, 'grid'));
      const sequencer = partAt(model.doc, 0)!.sequencer;
      return sequencer.kind === 'grid' ? sequencer.steps.length : 0;
    };
    expect(steps('7/8')).toBe(14);
    expect(steps()).toBe(16);
  });
});

describe('removing parts', () => {
  it('keeps a patch another part still plays, and drops it with its last user', () => {
    const model = new DocumentModel(newSong());
    restructure(model, addPart(model.doc)!.doc);
    // Both parts on one patch.
    model.merge({ parts: { 1: { preset: initPresetId('0') } } });
    restructure(model, removePart(model.doc, 0));
    expect(model.doc.parts.map((p) => p.slot)).toEqual([1]);
    expect(model.doc.patches?.[initPresetId('0')]).toBeDefined();
    // The last part is never removed.
    expect(removePart(model.doc, 1)).toBe(model.doc);
  });

  it('drops the removed part’s own Init patch', () => {
    const model = new DocumentModel(newSong());
    restructure(model, addPart(model.doc)!.doc);
    restructure(model, removePart(model.doc, 1));
    expect(Object.keys(model.doc.patches ?? {})).toEqual([initPresetId('0')]);
  });
});

describe('sequencer kind', () => {
  it('replaces the sequencer with the kind’s defaults, keeping preset, name, velocity and strip', () => {
    const model = new DocumentModel(newSong());
    model.merge({ parts: { 0: { name: 'Lead', velocity: 0.5, strip: { pan: 0.25 } } } });
    const before = partAt(model.doc, 0)!;
    restructure(model, setSequencerKind(model.doc, 0, 'grid'));
    const after = partAt(model.doc, 0)!;
    expect(model.corrections).toEqual([]);
    expect(after.sequencer.kind).toBe('grid');
    expect(after.sequencer.kind === 'grid' && after.sequencer.steps.length).toBeGreaterThan(0);
    expect({ ...after, sequencer: null }).toEqual({ ...before, sequencer: null });
  });

  it('discards a captured pattern when the kind changes', () => {
    const model = new DocumentModel(newSong());
    restructure(model, setSequencerKind(model.doc, 0, 'euclidean'));
    const steps = DEFAULT_EUCLIDEAN_CONFIG.steps;
    model.merge({ parts: { 0: { sequencer: { pattern: new Array<boolean>(steps).fill(true) } } } });
    restructure(model, setSequencerKind(model.doc, 0, 'grid'));
    restructure(model, setSequencerKind(model.doc, 0, 'euclidean'));
    const sequencer = partAt(model.doc, 0)!.sequencer;
    expect(sequencer.kind === 'euclidean' && sequencer.pattern).toBeNull();
  });

  it("clears every region's own pattern, reporting nothing (windsor#75 decision 6)", () => {
    const model = new DocumentModel(newSong());
    restructure(model, setSequencerKind(model.doc, 0, 'chord'));
    const whole = partAt(model.doc, 0)!.regions[0]!;
    const pattern = { ...partAt(model.doc, 0)!.sequencer, gate: 0.5 };
    model.merge({ parts: { 0: { regions: [{ ...whole, pattern }] } } });
    expect(partAt(model.doc, 0)!.regions[0]?.pattern).toMatchObject({ gate: 0.5 });
    restructure(model, setSequencerKind(model.doc, 0, 'arp'));
    expect(model.corrections).toEqual([]);
    expect(partAt(model.doc, 0)!.regions).toEqual([
      { start: whole.start, duration: whole.duration },
    ]);
  });

  it('leaves a Roll part set from one ∞ region with none, and keeps drawn windows (windsor#601)', () => {
    const model = new DocumentModel(newSong());
    restructure(model, setSequencerKind(model.doc, 0, 'roll'));
    expect(model.corrections).toEqual([]);
    expect(partAt(model.doc, 0)!.regions).toEqual([]);
    const windows = [
      { start: 0, duration: TICKS_PER_BAR },
      { start: 2 * TICKS_PER_BAR, duration: TICKS_PER_BAR },
    ];
    restructure(model, setSequencerKind(model.doc, 0, 'chord'));
    model.merge({ parts: { 0: { regions: windows } } });
    restructure(model, setSequencerKind(model.doc, 0, 'roll'));
    expect(partAt(model.doc, 0)!.regions).toEqual(windows);
    restructure(model, setSequencerKind(model.doc, 0, 'grid'));
    expect(partAt(model.doc, 0)!.regions).toEqual(windows);
  });

  it('is a no-op for the kind the part already has', () => {
    const model = new DocumentModel(newSong());
    expect(setSequencerKind(model.doc, 0, 'none')).toBe(model.doc);
  });

  it('plays: a grid on Part 1 sounds notes after the rebuild, four grids and 3 Euclidean + 1 chord both build', () => {
    const silent = (count: { n: number }): PlayablePart => ({
      noteOn: () => ++count.n,
      noteOffByNote: () => {},
      trigger: () => ++count.n,
      setPatch: () => {},
      allNotesOff: () => {},
    });
    const play = (doc: DocumentModel['doc']): number => {
      const count = { n: 0 };
      const transport = new TickTransport(120);
      const parts = new Map(doc.parts.map((p) => [p.slot, silent(count)]));
      const player = new ArrangementPlayer(transport, parts, doc, doc.patches ?? {});
      for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
      player.dispose();
      return count.n;
    };
    const model = new DocumentModel(newSong());
    expect(play(model.doc)).toBe(0);
    restructure(model, setSequencerKind(model.doc, 0, 'grid'));
    expect(play(model.doc)).toBeGreaterThan(0);

    const arps = new DocumentModel(newSong());
    const mixed = new DocumentModel(newSong());
    for (let i = 1; i < 4; i++) {
      restructure(arps, addPart(arps.doc)!.doc);
      restructure(mixed, addPart(mixed.doc)!.doc);
    }
    for (const slot of [0, 1, 2, 3]) {
      restructure(arps, setSequencerKind(arps.doc, slot, 'grid'));
      restructure(mixed, setSequencerKind(mixed.doc, slot, slot === 3 ? 'chord' : 'euclidean'));
    }
    expect(arps.doc.parts.every((p) => p.sequencer.kind === 'grid')).toBe(true);
    expect(mixed.doc.parts.map((p) => p.sequencer.kind)).toEqual([
      'euclidean',
      'euclidean',
      'euclidean',
      'chord',
    ]);
    expect(play(arps.doc)).toBeGreaterThan(0);
    expect(play(mixed.doc)).toBeGreaterThan(0);
  });
});

describe('renaming', () => {
  it('changes only the name: strip, preset, sequencer and note stream stay', () => {
    const model = new DocumentModel(newSong());
    restructure(model, setSequencerKind(model.doc, 0, 'euclidean'));
    const before = partAt(model.doc, 0)!;
    model.merge({ parts: { 0: { name: 'Rim' } } });
    expect(partAt(model.doc, 0)).toEqual({ ...before, name: 'Rim' });
  });
});

describe('the song round trip', () => {
  it('exports and imports a 7-part mixed-kind song equal to the model', () => {
    const model = new DocumentModel(newSong());
    for (let i = 1; i < 7; i++) restructure(model, addPart(model.doc)!.doc);
    const kinds = ['grid', 'euclidean', 'chord', 'none', 'euclidean', 'grid', 'chord'] as const;
    kinds.forEach((kind, slot) => restructure(model, setSequencerKind(model.doc, slot, kind)));
    model.merge({ parts: { 4: { name: 'Hat', strip: { level: 0.5, sends: { b: 0.3 } } } } });
    restructure(model, removePart(model.doc, 2));
    expect(model.doc.parts).toHaveLength(6);
    restructure(model, addPart(model.doc)!.doc);
    expect(model.doc.parts.map((p) => p.slot)).toEqual([0, 1, 3, 4, 5, 6, 2]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
    expect(reopened.filled).toEqual([]);
  });
});

describe('changed since opened (the New song guard)', () => {
  it('is false on open and on a re-open, true after an edit', () => {
    const model = new DocumentModel(newSong());
    expect(model.changed).toBe(false);
    model.merge({ transport: { bpm: 90 } });
    expect(model.changed).toBe(true);
    model.open(newSong());
    expect(model.changed).toBe(false);
    restructure(model, addPart(model.doc)!.doc);
    expect(model.changed).toBe(true);
  });
});
