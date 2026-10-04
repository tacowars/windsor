/**
 * The audio gate (windsor#578, record `2026-10-04-audio-gate`): the
 * `index.html` `<dialog>` that greets Windsor on load and comes back whenever
 * the page's audio context is not running. Its one button calls
 * `host.enable`, the gesture that creates and builds audio on the first
 * press and unlocks a suspended context afterwards. The rules are
 * `audioGateModel.ts`; this file feeds it the DOM's events and draws it.
 *
 * It cannot be dismissed: `showModal()` with `closedby="none"`, `cancel`
 * prevented, and a backdrop click does nothing. Chrome still lets a second
 * Escape close a dialog whose `cancel` was prevented, so a close while the
 * model says open reopens it at once. It opens itself rather than through
 * `metadataModal.ts`'s `showTrapped`: nothing opened it, so there is no
 * opener to hand focus back to.
 */
import { buildLine } from './audioGateBuildLine';
import {
  GATE_HIDDEN,
  audioGateView,
  gateClosed,
  stepAudioGate,
  type AudioGate,
  type AudioGateEvent,
} from './audioGateModel';
import { $, el } from './dom';
import type { EngineHost } from './host';

export interface AudioGateOptions {
  /** The context's state and its changes, followed across a rebuild or a discarded start. */
  readonly host: Pick<EngineHost, 'audioRunning' | 'onAudioState'>;
  /** The press: `host.enable` over the open document. */
  readonly enable: () => Promise<void>;
  /** An enable resolved: the console re-renders over live audio. */
  readonly onEnabled: () => void;
}

/** What the mounted gate tells the rest of the boot. */
export interface MountedAudioGate {
  /**
   * Resolves the first time the gate goes from open to closed, whatever event
   * closed it (an enable that resolved with audio running, or a context that
   * came back running after one that did not), and never rejects: while the
   * gate is up it stays pending. The restore question waits on it so it never
   * opens over the gate (windsor#581).
   */
  readonly passed: Promise<void>;
}

/** The gate's parts in `index.html`. */
interface GateParts {
  readonly dialog: HTMLDialogElement;
  readonly power: HTMLButtonElement;
  readonly action: HTMLElement;
  readonly lede: HTMLElement;
}

const TONES = ['busy', 'fail'] as const;

function paint(parts: GateParts, gate: AudioGate): void {
  const view = audioGateView(gate);
  parts.action.textContent = view.action;
  parts.action.classList.toggle('fail', view.tone === 'fail');
  const { before, code, after } = view.lede;
  // The error is text, never markup (#618).
  if (code === null) parts.lede.replaceChildren(before);
  else parts.lede.replaceChildren(before, el('code', '', code), after);
  for (const tone of TONES) parts.power.classList.toggle(tone, view.tone === tone);
  parts.power.disabled = view.disabled;
  parts.power.setAttribute('aria-busy', String(view.tone === 'busy'));
  if (view.open && !parts.dialog.open) parts.dialog.showModal();
  if (!view.open && parts.dialog.open) parts.dialog.close();
}

/** Open the gate in its first-load state and keep it on the context from then on. */
export function mountAudioGate(options: AudioGateOptions): MountedAudioGate {
  const parts: GateParts = {
    dialog: $('audioGate') as HTMLDialogElement,
    power: $('gatePower') as HTMLButtonElement,
    action: $('gateAction'),
    lede: $('gateLede'),
  };
  const { host } = options;
  let gate = GATE_HIDDEN;
  let pass = (): void => {};
  const passed = new Promise<void>((resolve) => (pass = resolve));
  const dispatch = (event: AudioGateEvent): void => {
    const before = gate;
    gate = stepAudioGate(gate, event);
    paint(parts, gate);
    if (gateClosed(before, gate)) pass();
  };

  $('gateBuild').textContent = buildLine(__WINDSOR_BUILD__);
  parts.dialog.addEventListener('cancel', (event) => event.preventDefault());
  parts.dialog.addEventListener('close', () => {
    if (audioGateView(gate).open) parts.dialog.showModal();
  });
  parts.power.onclick = (): void => {
    if (gate.kind === 'hidden' || gate.kind === 'starting') return;
    dispatch({ type: 'press' });
    options.enable().then(
      () => {
        dispatch({ type: 'resolved', running: host.audioRunning });
        options.onEnabled();
      },
      (error: unknown) => dispatch({ type: 'rejected', error: String(error) }),
    );
  };
  host.onAudioState(() => dispatch({ type: 'context', running: host.audioRunning }));
  document.addEventListener('visibilitychange', () =>
    dispatch({
      type: 'visibility',
      visible: document.visibilityState === 'visible',
      running: host.audioRunning,
    }),
  );
  dispatch({ type: 'load' });
  return { passed };
}
