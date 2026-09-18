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
 */
import type { Patch } from '../../../packages/client/src/audio/index-for-editor';
import { makePatch } from '../../../packages/client/src/audio/index-for-editor';

export class PartsSession {
  /** The selected part's slot (#597). */
  selected = 0;
  patch: Patch = makePatch();

  constructor(private readonly commit: (patch: Patch) => boolean) {}

  /** Push the working patch: into the document, and through it to the live part. True when it landed. */
  push(): boolean {
    return this.commit(this.patch);
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
  /** Rebuild the whole patch UI (an algorithm change recolours the bays). */
  refresh(): void;
}
