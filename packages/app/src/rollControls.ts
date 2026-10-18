/**
 * The Roll device's controls (windsor#602 decision 2), in the mockup's two
 * columns: Snap, Loop, Keys, Fold and Quantise; then Show, Loop | Region
 * (windsor#902; record `2026-10-18-roll-zoom-bars-and-duplicate` decision
 * 2), with the zoom bars' hint under it, the Audition switch, Rec (windsor#663, `rollRecView.ts`) with the metronome
 * beside its switch (windsor#906, `rollMetronome.ts`), and Keyboard fold
 * (windsor#922, `rollKeyboardFold.ts`). Under both, the
 * Velocity row (windsor#754; record `2026-10-12-roll-note-accent-and-ratchet`
 * decision 9): Vel, the console's knob on the part's `velocity`, beside Acc
 * vel and Acc mod, the Grid's knobs on the roll's `accentVelocity` and
 * `accentMod`, written as any card's sequencer knob is (`driverKnob`).
 * Snap, Keys, Fold and the zoom are the view's (`rollView.ts`), and
 * Audition the console's (`rollAudition.ts`), never the song's. Loop's − and
 * + step the song's loop through whole bars (windsor#603 decision 3), and
 * Dup beside them doubles it with everything in it (windsor#904,
 * `rollDuplicate.ts`), its title saying why when it is off.
 */
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { auditionOn, setAudition } from './rollAudition';
import { tableKnob } from './seqFields';
import { ROLL_ACCENT_KNOBS, ROLL_KNOBS } from './sequencerKnobTables';
import type { DuplicateRefusal } from './rollDuplicate';
import { ROLL_DUPLICATE, ROLL_DUPLICATE_REFUSED } from './rollDuplicateTables';
import { barsOf, loopText } from './rollSummary';
import { quantiseOff } from './rollQuantise';
import { ROLL_QUANTISE, ROLL_SHOW, ROLL_SNAPS, ROLL_VELOCITY_ROW } from './rollTables';
import type { RollRecView } from './rollRecView';
import type { RollKeys } from './rollRows';
import { type RollViewState, snapOf } from './rollView';
import type { RollFit } from './rollZoomModel';

/** What the controls read and change. */
export interface RollControlsTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  /** The region whose roll the accent knobs write; none is the part's sequencer. */
  readonly region: number | undefined;
  readonly view: RollViewState;
  /** Which fits the view on show sits on, device or Expanded: Show lights them. */
  fits(): Record<RollFit, boolean>;
  /** Fit the view on show to the loop or the region. */
  show(fit: RollFit): void;
  /** The loop, the region and a bar, in ticks. */
  ticks(): { loop: number; region: number; bar: number };
  /** Redraw the roll for a changed view setting. */
  repaint(): void;
  /** One − (−1) or + (+1) of the loop, written to the song. */
  stepLoop(dir: number): void;
  /** Why Dup is off, or null when it can double the loop. */
  duplicateRefusal(): DuplicateRefusal | null;
  /** Dup's press: the loop doubled with what is in it, written to the song. */
  duplicate(): void;
  /** How many notes are selected, which Quantise names. */
  selectedCount(): number;
  /** One press of Quantise, written to the song. */
  quantise(): void;
  /** Rec, placed under Audition, and Keyboard fold, placed under Rec. */
  readonly rec: Pick<RollRecView, 'control' | 'keyboardFold' | 'besideSwitch'>;
  /** The metronome button (windsor#906), placed beside Rec's switch. */
  readonly metronome: HTMLElement;
}

/** The controls, and the readouts' refresh after a repaint. */
export interface RollControls {
  readonly root: HTMLElement;
  /** The Notes page's controls, the two columns and the Velocity row, which the Envelopes tab hides (windsor#707). */
  readonly cols: HTMLElement;
  /** The first column, where Snap sits on the Notes page. */
  readonly firstCol: HTMLElement;
  /** Snap's field, which heads whichever tab's column shows. */
  readonly snap: HTMLElement;
  refresh(): void;
  /** Light Show's fits again, after a scroll or a zoom. */
  refreshShow(): void;
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

/** Dup (windsor#904): off, its title saying why, when the loop can't double. */
function dupButton(target: RollControlsTarget): { node: HTMLButtonElement; refresh: () => void } {
  const button = el('button', 'roll-qbtn roll-dup', ROLL_DUPLICATE.label) as HTMLButtonElement;
  button.type = 'button';
  button.onclick = () => target.duplicate();
  const refresh = (): void => {
    const refusal = target.duplicateRefusal();
    button.disabled = refusal !== null;
    button.title = refusal === null ? ROLL_DUPLICATE.title : ROLL_DUPLICATE_REFUSED[refusal];
  };
  return { node: button, refresh };
}

/** Loop: its readout between − and +, and Dup beside them. */
function loopItem(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const label = el('span', 'field-label roll-loop-label', 'Loop');
  const most = el('em');
  label.appendChild(most);
  const text = el('span', 'roll-readout');
  const less = stepButton('−', 'Shorter loop', () => target.stepLoop(-1));
  const more = stepButton('+', 'Longer loop', () => target.stepLoop(1));
  const dup = dupButton(target);
  const row = el('div', 'roll-loop-row');
  row.append(stepper([less, text, more]), dup.node);
  const refresh = (): void => {
    const { loop, region, bar } = target.ticks();
    most.textContent = `≤ ${barsOf(region, bar)} bars`;
    text.textContent = loopText(Math.min(loop, region), bar);
    dup.refresh();
  };
  refresh();
  return { node: item(label, row), refresh };
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
    const off = quantiseOff(snap.ticks);
    const count = target.selectedCount();
    to.textContent = off ? Q.off : `${Q.to} ${snap.label}`;
    button.textContent = count > 0 ? `${count} ${Q.selected}` : Q.all;
    button.disabled = off;
    button.title = off ? Q.offTitle : Q.title;
  };
  refresh();
  return { node: wrap, refresh };
}

function firstColumn(target: RollControlsTarget): {
  node: HTMLElement;
  snap: HTMLElement;
  refresh: () => void;
} {
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
  snap.classList.add('roll-item', 'roll-snap');
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
    snap,
    refresh: () => {
      loop.refresh();
      quantise.refresh();
    },
  };
}

/** Show: Loop | Region, each lit while the view sits on it, and the zoom bars' hint. */
function showItem(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const S = ROLL_SHOW;
  const box = el('div', 'seg roll-seg roll-show');
  const buttons = (['loop', 'region'] as const).map((fit) => {
    const button = el('button', '', S[fit]) as HTMLButtonElement;
    button.type = 'button';
    button.title = fit === 'loop' ? S.loopTitle : S.regionTitle;
    button.onclick = () => target.show(fit);
    box.appendChild(button);
    return { fit, button };
  });
  const refresh = (): void => {
    const on = target.fits();
    for (const { fit, button } of buttons) button.setAttribute('aria-pressed', String(on[fit]));
  };
  refresh();
  const node = item(S.label, box);
  node.appendChild(el('span', 'roll-hint', S.hint));
  return { node, refresh };
}

function secondColumn(target: RollControlsTarget): { node: HTMLElement; refresh: () => void } {
  const show = showItem(target);
  const audition = segs(
    [
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    () => (auditionOn() ? 'on' : 'off'),
    (v) => setAudition(v === 'on'),
  );
  audition.title = 'Hear a note as you add it or drag it to a new pitch';
  const { rec } = target;
  rec.besideSwitch(target.metronome);
  const col = el('div', 'roll-ctl');
  col.append(show.node, item('Audition', audition), rec.control, rec.keyboardFold);
  return { node: col, refresh: show.refresh };
}

/** The Velocity row: Vel on the part, Acc vel and Acc mod on the roll. */
function velocityRow(target: RollControlsTarget): HTMLElement {
  const { ctx, slot, region } = target;
  const knobs = el('div', 'roll-vel-knobs');
  for (const entry of [...ROLL_KNOBS, ...ROLL_ACCENT_KNOBS]) {
    knobs.appendChild(tableKnob(ctx, slot, entry, PITCH_COLOR, region));
  }
  const row = el('div', 'roll-vel-row');
  row.append(el('span', 'field-label', ROLL_VELOCITY_ROW.label), knobs);
  return row;
}

/** The two columns over the Velocity row, as one section of the device. */
export function rollControls(target: RollControlsTarget): RollControls {
  const first = firstColumn(target);
  const second = secondColumn(target);
  const columns = el('div', 'roll-ctl-cols');
  columns.append(first.node, second.node);
  const cols = el('div', 'roll-ctl-stack');
  cols.append(columns, velocityRow(target));
  const root = el('div', 'seq-section roll-controls');
  root.appendChild(cols);
  return {
    root,
    cols,
    firstCol: first.node,
    snap: first.snap,
    refresh: () => {
      first.refresh();
      second.refresh();
    },
    refreshShow: second.refresh,
  };
}
