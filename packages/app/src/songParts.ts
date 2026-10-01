/**
 * The console's part-list edits (#598), pure: a new song, adding a part,
 * choosing a part's sequencer kind. Each takes a normalised document and
 * returns a raw one for `DocumentModel` to renormalise — the normaliser fills
 * a new part's strip, velocity and sequencer fields, so nothing here restates
 * a default the engine owns. Removing a part is the engine's `removePart`
 * (`documentParts.ts`), which prunes a patch only no other part plays.
 */
import type { ArrangementDocument, DocumentPart, SequencerKind } from '@windsor/engine';
import { ARRANGEMENT_VERSION, MUSIC_PARTS_MAX, SEEDED_KINDS, TICKS_PER_BAR } from '@windsor/engine';
import { initPresetId } from './libraryConstants';
import { initPatchDefaults } from './patchActions';
import { NEW_SONG_BARS, NEW_SONG_BPM, NEW_SONG_HARMONY, partLabelFor } from './songConstants';

type RawDocument = Record<string, unknown>;

/** The one region a new part is live in (#705, epic #703 decision 17): the whole song. */
export function wholeSongRegion(bars: number): { start: number; duration: number } {
  return { start: 0, duration: bars * TICKS_PER_BAR };
}

/** One part on `slot`: labelled, playing its own fresh Init patch, live for the whole song, no sequencer yet. */
function initPart(slot: number, bars: number): RawDocument {
  return {
    slot,
    name: partLabelFor(slot),
    preset: initPresetId(String(slot)),
    regions: [wholeSongRegion(bars)],
    sequencer: { kind: 'none' },
  };
}

/** The song the console opens on: one part on slot 0, the Init patch, no sequencer. */
export function newSong(): RawDocument {
  return {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: NEW_SONG_BPM, bars: NEW_SONG_BARS },
    harmony: NEW_SONG_HARMONY,
    parts: [initPart(0, NEW_SONG_BARS)],
    patches: { [initPresetId('0')]: initPatchDefaults() },
  };
}

/** The lowest slot no part holds, or null when every slot up to `MUSIC_SLOT_MAX` is used. */
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
  const part = initPart(slot, doc.transport.bars);
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
 * The sequencer a kind change writes: the kind, and — for a kind that draws
 * from a stream — an explicit seed, because the normaliser *reports* a
 * missing one (#705, decision 16) and a chosen kind is not a damaged song.
 * Every other field is the normaliser's default.
 */
export function freshSequencer(kind: SequencerKind): RawDocument {
  return SEEDED_KINDS.includes(kind) ? { kind, seed: 0 } : { kind };
}

/**
 * The song with the part on `slot` driven by a sequencer of `kind`, at that
 * kind's defaults — preset, name, velocity, strip and regions stay; a
 * captured pattern goes with the old sequencer, and so does every region's
 * own pattern (windsor#75 decision 6). Unchanged when the kind already
 * matches.
 */
export function setSequencerKind(
  doc: ArrangementDocument,
  slot: number,
  kind: SequencerKind,
): ArrangementDocument | RawDocument {
  const parts = doc.parts.map((part): DocumentPart | RawDocument =>
    part.slot === slot && part.sequencer.kind !== kind
      ? {
          ...part,
          regions: part.regions.map(({ start, duration }) => ({ start, duration })),
          sequencer: freshSequencer(kind),
        }
      : part,
  );
  return parts.every((part, i) => part === doc.parts[i]) ? doc : { ...doc, parts };
}

/** Replace a `restructure` draft's contents with `next`, keys it no longer has included. */
export function replaceDraft(draft: Record<string, unknown>, next: object): void {
  for (const key of Object.keys(draft)) delete draft[key];
  Object.assign(draft, JSON.parse(JSON.stringify(next)) as object);
}
