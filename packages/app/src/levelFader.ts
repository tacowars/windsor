/**
 * The master's Level fader (windsor#194 decision 6): a vertical fader beside
 * the In meters and as tall as them, reading dB, with the knob's gestures
 * as `knob.ts`'s `attachKnobInput` wires them, each one undo step named after it: a drag
 * from press to release (the cap follows the pointer; Shift moves it finer),
 * a double-click's reset, and arrow presses less than `UNDO_MERGE_MS` apart.
 * It is a `role="slider"` whose `aria-valuetext` is in dB.
 *
 * The rules are `levelFaderModel.ts`; `set` writes the linear level, so the
 * song stores what the knob stored.
 */
import { el } from './dom';
import { dragGesture, mergedGesture, withGesture, type OpenGesture } from './gestureHooks';
import { continuesKeySteps } from './knob';
import {
  faderDragLevel,
  faderKeyLevel,
  faderPosition,
  faderReadout,
  faderValueText,
} from './levelFaderModel';
import {
  LEVEL_FADER_CAP_HEIGHT_PX,
  LEVEL_FADER_VALUE_DECIMALS,
  LEVEL_FADER_WIDTH_PX,
} from './masterColumnTables';
import { MASTER_LEVEL_FADER, type LevelFaderTable } from './masterTables';

export interface LevelFaderOptions {
  heightPx: number;
  get(): number;
  set(level: number): void;
  table?: LevelFaderTable;
}

const ARROW_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
};

/** The fader's DOM: an empty LED slot and a readout above the track, "dB" below, as a meter channel. */
function faderDom(
  label: string,
  heightPx: number,
): Record<'root' | 'readout' | 'track' | 'cap', HTMLElement> {
  const root = el('div', 'level-fader');
  root.style.setProperty('--fader-w', `${LEVEL_FADER_WIDTH_PX}px`);
  root.style.setProperty('--fader-cap-h', `${LEVEL_FADER_CAP_HEIGHT_PX}px`);
  root.style.setProperty('--meter-h', `${heightPx}px`);
  const readout = el('span', 'meter-readout level-fader-readout');
  const track = el('div', 'level-fader-track');
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-orientation', 'vertical');
  track.title = `${label} - drag, shift-drag for fine, double-click to reset`;
  const cap = el('i', 'level-fader-cap');
  track.appendChild(cap);
  root.append(el('span', 'meter-led is-empty'), readout, track, el('span', 'meter-name', 'dB'));
  return { root, readout, track, cap };
}

export function createLevelFader(options: LevelFaderOptions): HTMLElement {
  const table = options.table ?? MASTER_LEVEL_FADER;
  const { heightPx } = options;
  const { root, readout, track, cap } = faderDom(table.label, heightPx);

  const render = (): void => {
    const level = options.get();
    const up = faderPosition(level) * heightPx;
    cap.style.transform = `translateY(calc(50% - ${up.toFixed(1)}px))`;
    readout.textContent = faderReadout(level);
    track.setAttribute('aria-valuetext', faderValueText(level));
    track.setAttribute('aria-valuenow', level.toFixed(LEVEL_FADER_VALUE_DECIMALS));
  };
  const commit = (level: number): void => {
    options.set(level);
    render();
  };
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(table.max));
  wireFaderInput(track, { table, heightPx, get: options.get, commit });
  render();
  return root;
}

/** The pointer and the keys, each gesture one undo step (the knob's, `attachKnobInput`). */
function wireFaderInput(
  track: HTMLElement,
  io: { table: LevelFaderTable; heightPx: number; get(): number; commit(level: number): void },
): void {
  const { table, heightPx, get, commit } = io;
  let drag: OpenGesture | null = null;
  let startY = 0;
  let startPosition = 0;
  track.addEventListener('pointerdown', (e) => {
    drag?.close();
    drag = dragGesture(table.label);
    startY = e.clientY;
    startPosition = faderPosition(get());
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const stop = (e: PointerEvent): void => {
    drag?.close();
    drag = null;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  };
  track.addEventListener('pointermove', (e) => {
    if (!drag?.open) return;
    if ((e.buttons & 1) === 0) return stop(e);
    const dyPx = e.clientY - startY;
    commit(faderDragLevel({ startPosition, dyPx, heightPx, fine: e.shiftKey }, table));
  });
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
  track.addEventListener('lostpointercapture', stop);
  track.addEventListener('dblclick', () => withGesture(table.label, () => commit(table.def)));
  const keys = mergedGesture({ label: table.label, continues: (e) => continuesKeySteps(e, track) });
  track.addEventListener('blur', () => keys.close());
  track.addEventListener('keydown', (e) => {
    const dir = Object.hasOwn(ARROW_KEYS, e.key) ? ARROW_KEYS[e.key] : undefined;
    if (dir === undefined) return;
    keys.touch();
    commit(faderKeyLevel(get(), dir, e.shiftKey, table));
    e.preventDefault();
  });
}
