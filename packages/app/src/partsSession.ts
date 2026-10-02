/**
 * The Parts tab's working patch (#70, #435; #620 decision 3): a clone of the
 * selected part's patch, edited by the knobs and pushed to the document's
 * `patches` section under the part's preset name — which `ctx.change` turns
 * into a live `setPatch` on the real `AudioPart` and a merge into the
 * document, so the export carries the sound itself (since #561 the library is
 * `audio/patches/*.json`).
 *
 * The session is owned by the `AppContext` and handed to the files that need
 * it. `commit` is a constructor parameter — the context's document write —
 * never a module hook reassigned by whichever tab rendered last.
 *
 * Its selected slot is the one part selection the Parts tab and the Song view
 * share (windsor#462): every pick goes through `selectPart`, and the Song
 * view adopts a pick it did not make (`partSelectionSync.ts`).
 */
import type { Patch } from '@windsor/engine';
import { clonePatch, makePatch, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import type { KnobAutomation } from './knobAutomation';
import { library, libraryPatch } from './libraryModel';

export class PartsSession {
  /** The selected part's slot (#597): a pick's (`pick`), or a song switch's reset. */
  selected = 0;
  patch: Patch = makePatch();
  private picked = 0;

  constructor(private readonly commit: (patch: Patch) => boolean) {}

  /**
   * How many picks have moved the selection (windsor#462): what the Song view
   * compares to the count it last wrote or adopted. A song switch's reset of
   * `selected` is not a pick and leaves it.
   */
  get picks(): number {
    return this.picked;
  }

  /** Select `slot` as a user's pick; true when the selection moved. */
  pick(slot: number): boolean {
    if (slot === this.selected) return false;
    this.selected = slot;
    this.picked++;
    return true;
  }

  /** Push the working patch: into the document, and through it to the live part. True when it landed. */
  push(): boolean {
    return this.commit(this.patch);
  }
}

/** Reload the working patch: the document's patch, else the built-in the part plays. */
export function loadWorkingPatch(ctx: AppCtx): void {
  const part = partAt(ctx.model.doc, ctx.parts.selected);
  const patch = part
    ? (ctx.model.doc.patches?.[part.preset] ?? libraryPatch(library, part.preset))
    : undefined;
  ctx.parts.patch = patch ? clonePatch(patch) : makePatch();
}

/**
 * The one way a part is picked (windsor#462 decision 2), from the Parts
 * tab's picker, the Song view, or a part added or removed: the slot selected,
 * the working patch reloaded from it — so the next knob edit writes into this
 * part's preset, never the last part's patch — and, when the selection moved,
 * every other tab out of date, so the Parts tab draws the new part and the
 * Song view adopts it before either is next shown. The keyboard and a MIDI
 * controller follow through `livePart()`.
 */
export function selectPart(ctx: AppCtx, slot: number): void {
  if (ctx.parts.pick(slot)) ctx.invalidate();
  loadWorkingPatch(ctx);
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
  /** Rebuild the whole patch UI (an algorithm change recolours the bays). */
  refresh(): void;
  /**
   * The lock a lane of the selected part puts on the knob at `path`
   * (windsor#351): null while none that is on holds it. Absent, nothing locks.
   */
  automation?(path: string): KnobAutomation | null;
}
