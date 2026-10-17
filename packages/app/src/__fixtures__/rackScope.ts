/**
 * The rack tests' shared scope (windsor#868): over the full fixture a test
 * file hands in (the app's fence keeps a fixture from importing the engine's
 * own), the kick's chain and low cut set, a library over the built-ins, and
 * the helpers that build a rack from the kick and load one into a part
 * through the document model, so each test file reads as its own concern.
 */
import type { ArrangementDocument, DocumentPartial, RackFile } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { AutoCopies } from '../autoCopies';
import { DocumentModel } from '../documentModel';
import type { LibraryModel } from '../libraryModel';
import { pageLibrary } from '../libraryModel';
import type { RackRef, RackSaveOptions } from '../rackActions';
import { loadRackChange, rackFromPart } from '../rackActions';

/** The full fixture's four parts by name. */
export interface RackSlots {
  readonly kick: number;
  readonly hat: number;
  readonly arp: number;
  readonly drone: number;
}

export const META = {
  name: 'Kick Rack',
  category: 'Drums',
  tags: ['kick'],
  description: 'A test rack.',
};
export const ALL: RackSaveOptions = { ...META, lowCut: true, sequencer: true };
export const BARE: RackSaveOptions = { ...META, lowCut: false, sequencer: false };

/** A hand-written partial: the merge renormalises it, so its shape is the document's, not the type's. */
export const raw = (value: unknown): DocumentPartial => value as DocumentPartial;

/** One slot's fields in a partial. */
export const partFields = (partial: DocumentPartial, slot: number): Record<string, unknown> =>
  (partial.parts as Record<number, Record<string, unknown>>)[slot]!;

/** The helpers over `document`, the full fixture, and its `slots`. */
export function rackTestScope(document: ArrangementDocument, slots: RackSlots) {
  const { kick, hat } = slots;
  /** The kick's chain as the song would hold it: a drive, a compressor keyed from the hat, an echo with a compressor in its slot. */
  const KICK_CHAIN = [
    { kind: 'drive', id: 'd1' },
    { kind: 'compressor', id: 'c1', sidechain: { track: hat } },
    { kind: 'echo', id: 'e1', slot: { kind: 'compressor', id: 'c2' } },
  ];

  /** The full fixture with the kick's chain and low cut set, normalised. */
  function song(): DocumentModel {
    const model = new DocumentModel(document);
    model.merge(raw({ parts: { [kick]: { strip: { inserts: KICK_CHAIN, lowCut: 80 } } } }));
    return model;
  }

  /** A library over the built-ins, and a rack built from the kick and loaded into a part through `model`. */
  function scope(model: DocumentModel) {
    const library: LibraryModel = pageLibrary();
    const ids = new Set(Object.keys(library.entries));
    const auto = new AutoCopies();
    const rack = (options = ALL): RackRef => ({
      id: 'kick-rack',
      file: rackFromPart(model.doc, kick, options, ids) as RackFile,
    });
    const load = (slot: number, ref: RackRef): DocumentPartial => {
      const partial = loadRackChange(model.doc, slot, ref, library, auto);
      if (!partial) throw new Error(`no part on slot ${slot}`);
      model.merge(partial);
      return partial;
    };
    return { library, ids, auto, rack, load };
  }

  /** A raw chain as the song normalises it: every insert at its kind's defaults, its id kept. */
  function chain(inserts: unknown[]): RackFile['inserts'] {
    const model = new DocumentModel(document);
    model.merge(raw({ parts: { [kick]: { strip: { inserts } } } }));
    return [...partAt(model.doc, kick)!.strip.inserts];
  }

  return { ...slots, song, scope, chain };
}
