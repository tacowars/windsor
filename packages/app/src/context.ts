/**
 * What every tab gets handed (#70): the engine host, the document model, the
 * Parts tab's session, and the operations that keep them in step.
 * `appContext.ts` implements it; the interface lives here so tab modules need
 * no import cycle. The names are the surface the cards and panels call, and
 * they stay put when the implementation moves (#620).
 */
import type {
  ApplyResult,
  DocumentPartial,
} from '../../../packages/client/src/audio/index-for-editor';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import type { PartsSession } from './partsSession';

export interface AppCtx {
  host: EngineHost;
  model: DocumentModel;
  /** The Parts tab's selection and working patch (#620 decision 3). */
  parts: PartsSession;
  /**
   * A live change: applied to the live system (when audio is enabled) and
   * merged into the document. Refused by the engine → nothing changes.
   * Parts are addressed by slot: `{ parts: { 2: { velocity: 0.5 } } }` (#597);
   * a whole part at a free slot adds one, `null` at a slot or a patch id
   * removes it (#629) — `partEdits.ts` builds those.
   */
  change(partial: DocumentPartial): ApplyResult;
  /** A whole-document change — Import's and Restart's path (#629): edit a draft, renormalise, rebuild from tick 0, re-render. */
  restructure(edit: (draft: Record<string, unknown>) => void): void;
  /** Adopt a freshly imported raw document: normalise, rebuild, re-render. */
  importDoc(raw: unknown): void;
  /** Re-render the active tab from the current document; the rest render when shown (#620). */
  render(): void;
  /** The other tabs are out of date and render when shown; the active tab keeps its controls (a knob mid-drag). */
  invalidate(): void;
  status(message: string): void;
}

/** A partial touching one part, by slot. */
export const partChange = (slot: number, partial: Record<string, unknown>): DocumentPartial =>
  ({ parts: { [slot]: partial } }) as DocumentPartial;
