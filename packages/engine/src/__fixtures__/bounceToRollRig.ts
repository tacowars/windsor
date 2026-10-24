/**
 * Bounce to Roll's test rig (windsor#741): the render rig's one-part song
 * as a normalised document, the Acid Saw line of the record's worked
 * example, and a bounce's partial applied as the app applies one, merged
 * by slot and normalised.
 */
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { mergeParts, type SequencerSpec } from '../song/arrangement';
import {
  makeArrangement,
  type ArrangementDocument,
  type MakeArrangementResult,
} from '../song/arrangementDocument';
import type { BounceResult } from '../song/bounceToRollTypes';
import { PRESETS } from '../patch/presets';
import type { GridStep } from '../sequencing/gridSequencer';
import { bounceSong, gridNote, REST, TIE, type BounceSong } from './bounceRig';

/**
 * The Acid Saw line of
 * `docs/research/2026-10-04-acid-ladder-filter/audition/acid-audition.song.json`:
 * 16 steps at 1/16 in A natural minor at register octave 1, nothing varied.
 */
export const ACID_SAW: readonly GridStep[] = [
  gridNote(0, { accent: true }),
  gridNote(0),
  gridNote(0, { octave: 1, slide: true }),
  TIE,
  gridNote(2),
  REST,
  gridNote(0, { accent: true }),
  gridNote(6, { slide: true }),
  gridNote(0),
  gridNote(0, { octave: 1, accent: true }),
  gridNote(3, { slide: true }),
  TIE,
  REST,
  gridNote(4, { accent: true }),
  gridNote(0, { slide: true }),
  gridNote(0, { octave: 1 }),
];

/** The rig's song as the app holds it: normalised, its patches embedded. */
export function bounceDocument(
  sequencer: SequencerSpec,
  over: BounceSong = {},
): ArrangementDocument {
  const raw = { version: ARRANGEMENT_VERSION, ...bounceSong(sequencer, over) };
  return makeArrangement(raw, { libraryFill: PRESETS }).document;
}

export interface Applied {
  /** The document with the partial merged by slot, before any normalising. */
  readonly merged: ArrangementDocument;
  /** That document normalised, as the app's model adopts it. */
  readonly normalised: MakeArrangementResult;
}

/** A successful bounce's partial applied to `doc`: merged by slot, then normalised. */
export function applyBounce(doc: ArrangementDocument, result: BounceResult): Applied {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  const ignored: string[] = [];
  const merged = { ...doc, parts: mergeParts(doc.parts, result.partial.parts, ignored) };
  if (ignored.length > 0) throw new Error(`ignored: ${ignored.join(', ')}`);
  return { merged, normalised: makeArrangement(JSON.parse(JSON.stringify(merged))) };
}
