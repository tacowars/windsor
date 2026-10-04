/**
 * The audio gate's rules (windsor#578, record `2026-10-04-audio-gate`),
 * without the DOM. The gate is a modal that cannot be dismissed: it greets
 * Windsor on load, and it comes back whenever the page's audio context is not
 * running, so its one button is always the gesture that starts or resumes
 * audio. `audioGate.ts` draws it and feeds it these events.
 *
 * It shows by the context's state, never by device: desktop Chrome keeps a
 * context running across a tab switch and never sees the gate again, while
 * iOS Safari suspends it (or interrupts it) and does.
 */
import { GATE_COPY, GATE_ERROR_SLOT, type GateCopyTable } from './audioGateTables';

/**
 * Where the gate is: closed over a running console, or open in one of the
 * mockup's four states — before the first press, while an enable is pending,
 * after one threw (with its error text), or after the browser paused audio.
 */
export type AudioGate =
  | { readonly kind: 'hidden' | 'first' | 'starting' | 'back' }
  | { readonly kind: 'failed'; readonly error: string };

/**
 * What moves the gate. `running` is the host's context state at the moment
 * of the event: false with no context yet, as well as with one suspended or
 * interrupted.
 */
export type AudioGateEvent =
  /** The page has loaded; there is no context yet. */
  | { readonly type: 'load' }
  /** The gate's button was pressed. */
  | { readonly type: 'press' }
  /** The press's `host.enable` resolved. */
  | { readonly type: 'resolved'; readonly running: boolean }
  /** The press's `host.enable` threw. */
  | { readonly type: 'rejected'; readonly error: string }
  /** The context's `statechange`. */
  | { readonly type: 'context'; readonly running: boolean }
  /** The page's `visibilitychange`. */
  | { readonly type: 'visibility'; readonly visible: boolean; readonly running: boolean };

/** Before the page has loaded. */
export const GATE_HIDDEN: AudioGate = { kind: 'hidden' };
const FIRST: AudioGate = { kind: 'first' };
const STARTING: AudioGate = { kind: 'starting' };
const BACK: AudioGate = { kind: 'back' };

/** Closed while audio runs; open to resume it otherwise. */
const byContext = (running: boolean): AudioGate => (running ? GATE_HIDDEN : BACK);

/**
 * Once audio has come on, the gate follows the context: it opens to resume a
 * context that left `running` and closes on one that came back by itself (a
 * phone call ending). Before that — no context yet, a start pending or one
 * that failed — only the button's own outcome moves it.
 */
function followContext(gate: AudioGate, running: boolean): AudioGate {
  return gate.kind === 'hidden' || gate.kind === 'back' ? byContext(running) : gate;
}

/** The gate after `event`. */
export function stepAudioGate(gate: AudioGate, event: AudioGateEvent): AudioGate {
  switch (event.type) {
    case 'load':
      return FIRST;
    case 'press':
      // The button is disabled while starting, and there is none while hidden.
      return gate.kind === 'hidden' || gate.kind === 'starting' ? gate : STARTING;
    case 'resolved':
      return gate.kind === 'starting' ? byContext(event.running) : gate;
    case 'rejected':
      return gate.kind === 'starting' ? { kind: 'failed', error: event.error } : gate;
    case 'context':
      return followContext(gate, event.running);
    case 'visibility':
      return event.visible ? followContext(gate, event.running) : gate;
  }
}

/** What the gate shows: whether it is open, its words, and the button's look. */
export interface AudioGateView {
  readonly open: boolean;
  readonly action: string;
  /** The lede around the error text; `code` is the error, or null with none. */
  readonly lede: { readonly before: string; readonly code: string | null; readonly after: string };
  /** The button's look: `busy` while starting, `fail` after a throw. */
  readonly tone: '' | 'busy' | 'fail';
  readonly disabled: boolean;
}

/** The view of `gate`, in `copy`'s words. Hidden reads as the first-load copy, closed. */
export function audioGateView(gate: AudioGate, copy: GateCopyTable = GATE_COPY): AudioGateView {
  const words = gate.kind === 'hidden' ? copy.first : copy[gate.kind];
  const error = gate.kind === 'failed' ? gate.error : null;
  const slot = words.lede.indexOf(GATE_ERROR_SLOT);
  const lede =
    error === null || slot < 0
      ? { before: words.lede, code: null, after: '' }
      : {
          before: words.lede.slice(0, slot),
          code: error,
          after: words.lede.slice(slot + GATE_ERROR_SLOT.length),
        };
  const tone = gate.kind === 'starting' ? 'busy' : gate.kind === 'failed' ? 'fail' : '';
  return {
    open: gate.kind !== 'hidden',
    action: words.action,
    lede,
    tone,
    disabled: gate.kind === 'starting',
  };
}
