/**
 * What every tab gets handed (#70): the engine host, the document model, and
 * the operations that keep the two in step. `main.ts` implements it; the
 * interface lives here so tab modules need no import cycle.
 */
import type {
  ApplyResult,
  ArrangementDocument,
  DeepPartial,
  MusicPartId,
} from '../../../packages/client/src/audio/index-for-editor';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';

export interface AppCtx {
  host: EngineHost;
  model: DocumentModel;
  /**
   * A field-level change: applied to the live system (when audio is enabled)
   * and merged into the document. Refused by the engine → nothing changes.
   */
  change(partial: DeepPartial<ArrangementDocument>): ApplyResult;
  /** A structural change: edit a draft document, renormalise, rebuild, re-render. */
  restructure(edit: (draft: Record<string, unknown>) => void): void;
  /** Adopt a freshly imported raw document: normalise, rebuild, re-render. */
  importDoc(raw: unknown): void;
  /** Freeze the sounding pattern of a part into the document (record §6). */
  capture(id: MusicPartId): boolean;
  /** Release a captured part back to generative. */
  release(id: MusicPartId): void;
  /** Re-render every tab from the current document. */
  render(): void;
  status(message: string): void;
}

/** The slots a document may define, in play order. */
export const SLOT_IDS: readonly MusicPartId[] = ['kick', 'hat', 'arp', 'drone'];

/**
 * What an enabled slot starts as — the committed bed's identities, so a part
 * lands on a `MIX` strip and a preset that exist. The normaliser fills the
 * driver defaults.
 */
export const SLOT_DEFAULTS: Record<MusicPartId, Record<string, unknown>> = {
  kick: { part: 'kick', preset: 'kick', note: 36, velocity: 1, hold: 0.2, driver: {} },
  hat: { part: 'hat', preset: 'hat', note: 42, velocity: 0.6, hold: 0.08, driver: {} },
  arp: { part: 'arp', preset: 'saw-arp', velocity: 0.7, driver: {} },
  drone: { part: 'drone', preset: 'drone-sqr', velocity: 0.8, driver: {} },
};
