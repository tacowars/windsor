/**
 * The console's part-list edits (#598), pure: a new song, adding a part,
 * choosing a part's sequencer kind. Each takes a normalised document and
 * returns a raw one for `DocumentModel` to renormalise — the normaliser fills
 * a new part's strip, velocity and sequencer fields, so nothing here restates
 * a default the engine owns. Removing a part is the engine's `removePart`
 * (`documentParts.ts`), which prunes a patch only no other part plays.
 */
import type {
  ArrangementDocument,
  DocumentPart,
  SequencerKind,
} from '../../../packages/client/src/audio/index-for-editor';
import { MUSIC_PARTS_MAX } from '../../../packages/client/src/audio/index-for-editor';
import { initPresetId } from './libraryConstants';
import { initPatchDefaults } from './patchActions';
import { NEW_SONG_BPM, NEW_SONG_KEY, partLabelFor } from './songConstants';

type RawDocument = Record<string, unknown>;

/** One part on `slot`: labelled, playing its own fresh Init patch, no sequencer yet. */
function initPart(slot: number): RawDocument {
  return {
    slot,
    name: partLabelFor(slot),
    preset: initPresetId(String(slot)),
    sequencer: { kind: 'none' },
  };
}

/** The song the console opens on: one part on slot 0, the Init patch, no sequencer. */
export function newSong(): RawDocument {
  return {
    version: 2,
    seed: 0,
    bpm: NEW_SONG_BPM,
    key: NEW_SONG_KEY,
    parts: [initPart(0)],
    patches: { [initPresetId('0')]: initPatchDefaults() },
  };
}

/** The lowest slot no part holds, or null when the song has all eight. */
export function nextFreeSlot(doc: Pick<ArrangementDocument, 'parts'>): number | null {
  if (doc.parts.length >= MUSIC_PARTS_MAX) return null;
  const used = new Set(doc.parts.map((part) => part.slot));
  for (let slot = 0; slot < MUSIC_PARTS_MAX; slot++) if (!used.has(slot)) return slot;
  return null;
}

/** The song with a new Init part on the lowest free slot, appended; null when full. */
export function addPart(doc: ArrangementDocument): { doc: RawDocument; slot: number } | null {
  const slot = nextFreeSlot(doc);
  if (slot === null) return null;
  const part = initPart(slot);
  return {
    slot,
    doc: {
      ...doc,
      parts: [...doc.parts, part],
      patches: { ...doc.patches, [String(part.preset)]: initPatchDefaults() },
    },
  };
}

/**
 * The song with the part on `slot` driven by a sequencer of `kind`, at that
 * kind's defaults — preset, name, velocity and strip stay; a captured pattern
 * goes with the old sequencer. Unchanged when the kind already matches.
 */
export function setSequencerKind(
  doc: ArrangementDocument,
  slot: number,
  kind: SequencerKind,
): ArrangementDocument | RawDocument {
  const parts = doc.parts.map((part): DocumentPart | RawDocument =>
    part.slot === slot && part.sequencer.kind !== kind ? { ...part, sequencer: { kind } } : part,
  );
  return parts.every((part, i) => part === doc.parts[i]) ? doc : { ...doc, parts };
}

/** Replace a `restructure` draft's contents with `next`, keys it no longer has included. */
export function replaceDraft(draft: Record<string, unknown>, next: object): void {
  for (const key of Object.keys(draft)) delete draft[key];
  Object.assign(draft, JSON.parse(JSON.stringify(next)) as object);
}
