/**
 * The Roll device's controls (windsor#602 decision 2), in the mockup's two
 * columns: Snap, Loop, Keys and Fold; then Vel, the ↔ and ↕ zooms and the
 * Audition switch. Vel is the console's knob on the part's `velocity`.
 * Snap, Keys, Fold and the zooms are the view's (`rollView.ts`), and
 * Audition the console's (`rollAudition.ts`), never the song's. Loop's − and
 * + step the song's loop through whole bars (windsor#603 decision 3).
 */
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { auditionOn, setAudition } from './rollAudition';
import { tableKnob } from './seqFields';
import { ROLL_KNOBS } from './sequencerKnobTables';
import { barsOf, loopText } from './rollSummary';
import { ROLL_QUANTISE, ROLL_SNAP_OFF_TICKS, ROLL_SNAPS } from './rollTables';
import type { RollKeys } from './rollRows';
import { type RollViewState, type RollZoom, rowZoomText, snapOf, timeZoomText } from './rollView';

/** What the controls read and change. */
export interface RollControlsTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly view: RollViewState;
  /** The zoom of the view on show, device or Expanded. */
  zoom(): RollZoom;
  /** One ↔ step (−1 or +1), Fit (0), or one ↕ step. */
  zoomTime(dir: number): void;
  zoomRows(dir: number): void;
  /** The px per beat the roll draws at now. */
  beatPx(): number;
  /** The loop, the region and a bar, in ticks. */
  ticks(): { loop: number; region: number; bar: number };
  /** Redraw the roll for a changed view setting. */
  repaint(): void;
  /** One − (−1) or + (+1) of the loop, written to the song. */
  stepLoop(dir: number): void;
  /** How many notes are selected, which Quantise names. */
  selectedCount(): number;
  /** One press of Quantise, written to the song. */
  quantise(): void;
}

/** The controls, and the readouts' refresh after a repaint. */
export interface RollControls {
  readonly root: HTMLElement;
  refresh(): void;
}

function item(label: string | HTMLElement, control: HTMLElement): HTMLElement {
  const wrap = el('div', 'roll-item');
  wrap.append(typeof label === 'string' ? el('span', 'field-label', label) : label, control);
  return wrap;
}

function stepButton(text: string, label: string, act: () => void): HTMLButtonElement {
  const button = el('button', 'roll-step', text) as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.onclick = act;
  return button;
}

function stepper(nodes: readonly HTMLElement[]): HTMLElement {
  const box = el('div', 'roll-stepper');
  box.append(...nodes);
  return box;
}

const segs = (
  options: readonly { value: string; label: string }[],
  current: () => string,
  pick: (value: string) => void,
): HTMLElement => {
  const box = seg(options, current, pick, PITCH_COLOR);
  box.classList.add('roll-seg');
  return box;
};

/** Loop: its readout between − and +. */
function loopItem(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const label = el('span', 'field-label roll-loop-label', 'Loop');
  const most = el('em');
  label.appendChild(most);
  const text = el('span', 'roll-readout');
  const less = stepButton('−', 'Shorter loop', () => target.stepLoop(-1));
  const more = stepButton('+', 'Longer loop', () => target.stepLoop(1));
  const refresh = (): void => {
    const { loop, region, bar } = target.ticks();
    most.textContent = `≤ ${barsOf(region, bar)} bars`;
    text.textContent = loopText(Math.min(loop, region), bar);
  };
  refresh();
  return { node: item(label, stepper([less, text, more])), refresh };
}

/**
 * Quantise (windsor#661): its label names the Snap step, the button what it
 * acts on; disabled with Snap Off, which has no step to snap to.
 */
function quantiseItem(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const Q = ROLL_QUANTISE;
  const label = el('span', 'field-label roll-loop-label', Q.label);
  const to = el('em');
  label.appendChild(to);
  const button = el('button', 'roll-qbtn') as HTMLButtonElement;
  button.type = 'button';
  button.onclick = () => target.quantise();
  const wrap = item(label, button);
  const refresh = (): void => {
    const snap = snapOf(target.view.snap);
    const off = snap.ticks === ROLL_SNAP_OFF_TICKS;
    const count = target.selectedCount();
    to.textContent = off ? Q.off : `${Q.to} ${snap.label}`;
    button.textContent = count > 0 ? `${count} ${Q.selected}` : Q.all;
    button.disabled = off;
    button.title = off ? Q.offTitle : Q.title;
  };
  refresh();
  return { node: wrap, refresh };
}

function firstColumn(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const { view } = target;
  const snap = select(
    'Snap',
    ROLL_SNAPS.map((s, i) => ({ value: String(i), label: s.label })),
    String(view.snap),
    (v) => {
      view.snap = Number(v);
      target.repaint();
    },
  );
  snap.classList.add('roll-item');
  const loop = loopItem(target);
  const keys = segs(
    [
      { value: '12', label: '12' },
      { value: 'scale', label: 'Scale' },
    ],
    () => view.keys,
    (v) => {
      view.keys = v as RollKeys;
      target.repaint();
    },
  );
  const fold = segs(
    [
      { value: 'all', label: 'All' },
      { value: 'fold', label: 'Fold' },
    ],
    () => (view.fold ? 'fold' : 'all'),
    (v) => {
      view.fold = v === 'fold';
      target.repaint();
    },
  );
  const quantise = quantiseItem(target);
  const col = el('div', 'roll-ctl');
  col.append(snap, loop.node, item('Keys', keys), item('Fold', fold), quantise.node);
  return {
    node: col,
    refresh: () => {
      loop.refresh();
      quantise.refresh();
    },
  };
}

function zooms(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const fit = stepButton('fit', 'Fit the region to the width', () => target.zoomTime(0));
  fit.classList.add('roll-fit');
  const rows = el('span', 'roll-readout');
  const grid = el('div', 'roll-zooms');
  const axis = (glyph: string, title: string): HTMLElement => {
    const mark = el('i', '', glyph);
    mark.title = title;
    return mark;
  };
  grid.append(
    axis('↔', 'Horizontal zoom'),
    stepper([
      stepButton('−', 'Zoom out in time', () => target.zoomTime(-1)),
      fit,
      stepButton('+', 'Zoom in in time', () => target.zoomTime(1)),
    ]),
    axis('↕', 'Vertical zoom'),
    stepper([
      stepButton('−', 'Shorter rows', () => target.zoomRows(-1)),
      rows,
      stepButton('+', 'Taller rows', () => target.zoomRows(1)),
    ]),
  );
  const refresh = (): void => {
    const zoom = target.zoom();
    fit.textContent = timeZoomText(zoom, target.beatPx(), target.ticks().bar);
    fit.classList.toggle('on', zoom.beatPx === null);
    rows.textContent = rowZoomText(zoom);
  };
  refresh();
  return { node: item('Zoom', grid), refresh };
}

function secondColumn(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const vel = ROLL_KNOBS[0];
  const zoom = zooms(target);
  const audition = segs(
    [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    () => (auditionOn() ? 'on' : 'off'),
    (v) => setAudition(v === 'on'),
  );
  audition.title = 'Hear a note as you add it or drag it to a new pitch';
  const col = el('div', 'roll-ctl');
  if (vel) col.appendChild(tableKnob(target.ctx, target.slot, vel, PITCH_COLOR));
  col.append(zoom.node, item('Audition', audition));
  return { node: col, refresh: zoom.refresh };
}

/** The two columns as one section of the device. */
export function rollControls(target: RollControlsTarget): RollControls {
  const first = firstColumn(target);
  const second = secondColumn(target);
  const cols = el('div', 'roll-ctl-cols');
  cols.append(first.node, second.node);
  const root = el('div', 'seq-section roll-controls');
  root.appendChild(cols);
  return {
    root,
    refresh: () => {
      first.refresh();
      second.refresh();
    },
  };
}
