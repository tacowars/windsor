/**
 * What every tab gets handed (#70): the engine host, the document model, the
 * Parts tab's session, and the operations that keep them in step.
 * `appContext.ts` implements it; the interface lives here so tab modules need
 * no import cycle. The names are the surface the cards and panels call, and
 * they stay put when the implementation moves (#620).
 */
import type { ApplyResult, DocumentPartial } from '@windsor/engine';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import type { PartsSession } from './partsSession';
import type { TransportState } from './transportModel';

/**
 * ▶ ■ ‖ and the position (#708, epic #703 decision 8) — the strip's, and the
 * Song view's (#709). `host.ts`'s `HostTransport` implements it.
 */
export interface ConsoleTransport {
  readonly state: TransportState;
  /** The transport is issuing ticks (▶ pressed on a live system). */
  readonly running: boolean;
  /** Run from the current tick; false when audio is not enabled. */
  play(): boolean;
  /** Stop and release, keeping the tick (the game's mute). */
  pause(): void;
  /** Stop, release, and rewind to tick 0 with every part's region state cleared. */
  stop(): void;
  /** The audible transport tick; 0 before audio is enabled. */
  position(): number;
}

export interface AppCtx {
  host: EngineHost;
  model: DocumentModel;
  /** The Parts tab's selection and working patch (#620 decision 3). */
  parts: PartsSession;
  /** ▶ ■ ‖ and the audible position (#708). */
  transport: ConsoleTransport;
  /**
   * A live change: applied to the live system (when audio is enabled) and
   * merged into the document. Refused by the engine → nothing changes.
   * Parts are addressed by slot: `{ parts: { 2: { velocity: 0.5 } } }` (#597);
   * a whole part at a free slot adds one, `null` at a slot or a patch id
   * removes it (#629) — `partEdits.ts` builds those.
   */
  change(partial: DocumentPartial): ApplyResult;
  /** Adopt a freshly imported raw document: normalise, rebuild, re-render — the one rebuild the UI offers (#629; Restart went with #708, `restructure` with #709). */
  importDoc(raw: unknown): void;
  /** Re-render the active tab from the current document; the rest render when shown (#620). */
  render(): void;
  /**
   * Every tab is out of date and the active one re-renders now, the chrome
   * (the transport strip) untouched — what a strip control mid-gesture calls
   * when its edit reshapes what the tabs draw (#708: Bars).
   */
  refreshTabs(): void;
  /** The other tabs are out of date and render when shown; the active tab keeps its controls (a knob mid-drag). */
  invalidate(): void;
  status(message: string): void;
}

/** A partial touching one part, by slot. */
export const partChange = (slot: number, partial: Record<string, unknown>): DocumentPartial =>
  ({ parts: { [slot]: partial } }) as DocumentPartial;
