/**
 * The Parts tab's working patch (#70, #435; #620 decision 3): a clone of the
 * selected part's patch, edited by the knobs and pushed to the document's
 * `patches` section under the part's preset name — which `ctx.change` turns
 * into a live `setPatch` on the real `AudioPart` and a merge into the
 * document, so the export carries the sound itself (since #561 the library is
 * `audio/patches/*.json`).
 *
 * The session is owned by the `AppContext` and handed to the files that need
 * it. Its document write, the document and the other tabs' invalidation are
 * constructor parameters, never module hooks reassigned by whichever tab
 * rendered last.
 *
 * It owns the selected slot too (windsor#470): the one part selection the
 * Parts tab and the Song view share (windsor#462). Nothing else writes it. A
 * user's pick (`pick`) and a song switch or a reshaped document (`resolve`)
 * take the one change path, which only ever selects a part that exists
 * (`resolveSlot`), and the Song view adopts a change it did not make
 * (`partSelectionSync.ts`).
 */
import type { ArrangementDocument, DocumentPart, Patch, PartsPartial } from '@windsor/engine';
import { clonePatch, makePatch, partAt } from '@windsor/engine';
import type { KnobAutomation } from './knobAutomation';
import { library, libraryPatch } from './libraryModel';
import { resolveSlot } from './partSelectionSync';

/**
 * The parts partial an edit of a patch makes on the parts playing it (a
 * macro's removal moves their lanes, windsor#561), from the document and the
 * selected part's preset at the commit.
 */
export type PatchPartsEdit = (
  doc: ArrangementDocument,
  preset: string,
) => PartsPartial<DocumentPart>;

/** What the session needs of the context: the document write, the document, and the other tabs' invalidation. */
export interface PartsSessionDeps {
  /** The patch, and `parts`' partial when given, as one change; true when it landed. */
  commit(patch: Patch, parts?: PatchPartsEdit): boolean;
  doc(): ArrangementDocument;
  invalidate(): void;
}

export class PartsSession {
  patch: Patch = makePatch();
  private slot = 0;
  private picked = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PartsSessionDeps) {}

  /** The selected part's slot (#597): always a part the document has, or 0 when it has none. */
  get selected(): number {
    return this.slot;
  }

  /**
   * How many picks have moved the selection (windsor#462): what the Song view
   * compares to the count it last wrote or adopted. A song switch or a
   * reshaped document (`resolve`) is not a pick and leaves it.
   */
  get picks(): number {
    return this.picked;
  }

  /**
   * A user's pick (windsor#462 decision 2): from the Parts tab's picker, the
   * Song view, or a part added or removed. True when the selection moved.
   */
  pick(slot: number): boolean {
    return this.change(slot, true);
  }

  /**
   * Select `slot`, by default the selected one, without counting a pick: a
   * song switch, or an undo or a redo that may have taken the selected part
   * away. True when the selection moved.
   */
  resolve(slot: number = this.slot): boolean {
    return this.change(slot, false);
  }

  /** Hear every selection change (the keyboard hands its bend and wheel over); returns the unsubscribe. */
  onSelect(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Tell the listeners the selection again, unmoved: the context calls this
   * once a rebuilt live system stands, because the selected slot now plays a
   * new `AudioPart` and the keyboard's bend and wheel must reach it, whichever
   * tab is shown (windsor#470 fix round 1).
   */
  announce(): void {
    for (const listener of this.listeners) listener();
  }

  /** Reload the working patch: the document's patch, else the built-in the part plays. */
  reload(): void {
    const doc = this.deps.doc();
    const part = partAt(doc, this.slot);
    const patch = part
      ? (doc.patches?.[part.preset] ?? libraryPatch(library, part.preset))
      : undefined;
    this.patch = patch ? clonePatch(patch) : makePatch();
  }

  /** Push the working patch: into the document, and through it to the live part. True when it landed. */
  push(): boolean {
    return this.deps.commit(this.patch);
  }

  /**
   * Push the working patch, with `parts`' partial when given, as one change,
   * and, once it landed, put every other tab out of date: an edit another
   * tab draws from the patch (a macro's name and mappings are the Song tab's
   * lane titles and lane picker, windsor#561), which a plain knob's push
   * leaves alone. True when it landed.
   */
  pushShared(parts?: PatchPartsEdit): boolean {
    if (!this.deps.commit(this.patch, parts)) return false;
    this.deps.invalidate();
    return true;
  }

  /**
   * The one change path (windsor#470 decision 3): the slot resolved to a part
   * that exists; the working patch reloaded from it, so the next knob edit
   * writes into this part's preset and never the last part's patch; every
   * other tab out of date when the selection moved, so the Parts tab draws
   * the new part and the Song view adopts it before either is next shown;
   * and the listeners told. A pick counts only when it moved the selection.
   */
  private change(slot: number, pick: boolean): boolean {
    const slots = this.deps.doc().parts.map((part) => part.slot);
    const resolved = resolveSlot(slots, slot);
    const moved = resolved !== this.slot;
    this.slot = resolved;
    if (pick && moved) this.picked++;
    this.reload();
    if (moved) this.deps.invalidate();
    this.announce();
    return moved;
  }
}

/**
 * What a Parts-tab control is handed: the working patch to read and edit,
 * the push that commits it, and the rail rebuild an algorithm change or an
 * envelope drop needs. The tab builds one per render over its session; a
 * test builds one over a bare patch and a document model.
 */
export interface PatchEditor {
  readonly patch: Patch;
  push(): void;
  /**
   * Push the working patch for an edit another tab draws (`PartsSession.pushShared`):
   * with `parts`' partial when given, one change, so one undo step, and every
   * other tab out of date once it landed. Absent, `push` stands in.
   */
  pushShared?(parts?: PatchPartsEdit): void;
  /** Rebuild the whole patch UI (an algorithm change recolours the bays). */
  refresh(): void;
  /**
   * The lock a lane of the selected part puts on the knob at `path`
   * (windsor#351): null while none that is on holds it. Absent, nothing locks.
   */
  automation?(path: string): KnobAutomation | null;
}
