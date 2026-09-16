/**
 * What every tab gets handed (#70): the engine host, the document model, and
 * the operations that keep the two in step. `main.ts` implements it; the
 * interface lives here so tab modules need no import cycle.
 */
import type {
  ApplyResult,
  DocumentPartial,
} from '../../../packages/client/src/audio/index-for-editor';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';

export interface AppCtx {
  host: EngineHost;
  model: DocumentModel;
  /**
   * A field-level change: applied to the live system (when audio is enabled)
   * and merged into the document. Refused by the engine → nothing changes.
   * Parts are addressed by slot: `{ parts: { 2: { velocity: 0.5 } } }` (#597).
   */
  change(partial: DocumentPartial): ApplyResult;
  /** A structural change: edit a draft document, renormalise, rebuild, re-render. */
  restructure(edit: (draft: Record<string, unknown>) => void): void;
  /** Adopt a freshly imported raw document: normalise, rebuild, re-render. */
  importDoc(raw: unknown): void;
  /** Freeze the sounding pattern of the part on `slot` into the document (record §6). */
  capture(slot: number): boolean;
  /** Release a captured part back to generative. */
  release(slot: number): void;
  /** Re-render every tab from the current document. */
  render(): void;
  status(message: string): void;
}

/** A partial touching one part, by slot. */
export const partChange = (slot: number, partial: Record<string, unknown>): DocumentPartial =>
  ({ parts: { [slot]: partial } }) as DocumentPartial;
