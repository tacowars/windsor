/**
 * Rec on the Roll device (windsor#663; record `2026-10-09-roll-recording`,
 * the approved mockup `docs/research/2026-10-09-roll-recording-mockup/`):
 * the switch under Audition, drawn as Audition's two-way switch in the
 * record colour, its label reading the look and its hint under it; the notes
 * the take holds, drawn growing; and the summary line, which says when the
 * region being recorded into is full. The state is the console's recorder
 * (`rollRecMount.ts`); the device reads it on its playhead loop (`frame`).
 */
import { ROLL_NOTES_MAX } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { paintHeld } from './rollNotesPaint';
import type { RollPanes } from './rollPanes';
import { rollRecorder } from './rollRecMount';
import { type RecLook, recOn } from './rollRecState';
import type { RollScene } from './rollScene';
import type { RollSource } from './rollSource';
import { ROLL_REC } from './rollTables';

/** What Rec reads of its device. */
export interface RecViewHost {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly panes: RollPanes;
  /** The tab bar's summary line. */
  readonly summary: HTMLElement;
  source(): RollSource;
  scene(): RollScene | null;
  /** The notes' layer of the last whole paint. */
  layer(): HTMLElement | null;
}

/** Rec's switch for the controls, and what the device calls on each frame and paint. */
export interface RollRecView {
  readonly control: HTMLElement;
  /** Read the recorder: the look, the summary, the held notes. */
  frame(): void;
  /** The summary line as the device words it, kept under a full region's. */
  summary(text: string): void;
}

/** The item's class for each look (the mockup's: a full region records on, its dot blinking). */
const LOOK_CLASS: Readonly<Record<RecLook, string>> = {
  'no-region': 'disabled',
  off: '',
  armed: 'armed',
  paused: 'paused',
  recording: 'recording',
  full: 'recording',
};

function sideButton(className: string, text: string): HTMLButtonElement {
  const button = el('button', className, text) as HTMLButtonElement;
  button.type = 'button';
  return button;
}

/** The switch's parts. */
interface RecControl {
  readonly root: HTMLElement;
  readonly state: HTMLElement;
  readonly box: HTMLElement;
  readonly off: HTMLButtonElement;
  readonly on: HTMLButtonElement;
}

/** The switch: Off and ●Rec, the label's state and the hint. */
function recControl(): RecControl {
  const R = ROLL_REC;
  const root = el('div', 'roll-item rec-item');
  const label = el('span', 'field-label roll-loop-label', R.label);
  const state = el('em', 'rec-state');
  label.appendChild(state);
  const box = el('div', 'seg roll-seg rec-seg');
  const off = sideButton('rec-off', R.off);
  const on = sideButton('rec-on', R.on);
  on.prepend(el('i', 'rec-dot'));
  box.append(off, on);
  root.append(label, box, el('span', 'rec-hint', R.hint));
  return { root, state, box, off, on };
}

/** Show look `next` on the switch, having shown `prev`. */
function paintLook(ui: RecControl, prev: RecLook | null, next: RecLook): void {
  if (prev && LOOK_CLASS[prev]) ui.root.classList.remove(LOOK_CLASS[prev]);
  if (LOOK_CLASS[next]) ui.root.classList.add(LOOK_CLASS[next]);
  const on = recOn(next);
  ui.state.textContent = ROLL_REC.looks[next];
  ui.on.setAttribute('aria-pressed', String(on));
  ui.off.setAttribute('aria-pressed', String(!on));
  ui.on.disabled = ui.off.disabled = next === 'no-region';
  const titles = ROLL_REC.titles;
  ui.box.title =
    next === 'no-region' ? titles['no-region'] : next === 'paused' ? titles.paused : titles.live;
}

/** Rec on one Roll device. */
class RecView implements RollRecView {
  private readonly ui = recControl();
  private look: RecLook | null = null;
  private full = false;
  private words = '';
  private held: HTMLElement[] = [];
  private heldKey = '';

  constructor(private readonly host: RecViewHost) {
    this.ui.off.onclick = () => this.set(false);
    this.ui.on.onclick = () => this.set(true);
    this.show('no-region');
  }

  get control(): HTMLElement {
    return this.ui.root;
  }

  frame(): void {
    const recorder = rollRecorder();
    recorder?.sync();
    const selected = this.host.ctx.parts.selected === this.host.slot;
    const look = recorder && selected ? recorder.look() : 'no-region';
    this.show(look);
    const full = look === 'full' && recorder?.place().region === this.host.source().regionIndex;
    if (full !== this.full) {
      this.full = full;
      this.showSummary();
    }
    this.drawHeld(look === 'recording' || look === 'full');
  }

  summary(text: string): void {
    this.words = text;
    this.showSummary();
  }

  private set(on: boolean): void {
    rollRecorder()?.setOn(on);
    this.frame();
  }

  private show(look: RecLook): void {
    if (look === this.look) return;
    paintLook(this.ui, this.look, look);
    this.look = look;
  }

  private showSummary(): void {
    const { summary } = this.host;
    summary.classList.toggle('full', this.full);
    summary.textContent = this.full ? ROLL_REC.full(ROLL_NOTES_MAX) : this.words;
  }

  /** The take's held notes in this device's region, redrawn when they moved or the roll was repainted. */
  private drawHeld(recording: boolean): void {
    const { host } = this;
    const recorder = rollRecorder();
    const region = host.source().regionIndex;
    const notes =
      recording && !this.full && recorder
        ? recorder.held(host.slot).filter((note) => note.regionIndex === region)
        : [];
    const key = notes.map((n) => `${n.pitch}:${n.tick}:${n.ticks}`).join(' ');
    if (key === this.heldKey && this.held.every((node) => node.isConnected)) return;
    for (const node of this.held) node.remove();
    this.heldKey = key;
    const scene = host.scene();
    const layer = host.layer();
    this.held = scene && layer ? paintHeld(host.panes, layer, scene, notes) : [];
  }
}

/** Rec on the Roll device of `host`. */
export const rollRecView = (host: RecViewHost): RollRecView => new RecView(host);
