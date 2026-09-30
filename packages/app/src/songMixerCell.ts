/**
 * The Song tab's mixer column (windsor#157; record
 * `2026-09-30-mixer-on-the-song-tab` decisions 1 and 2): one cell a row
 * between the lane names and the timeline, frozen with the names while the
 * timeline scrolls. The ruler row's cell is the column's header; the loop
 * and Harmony rows' are empty; a part's is its collapsed strip — a compact
 * Level knob with its value, then M and S.
 *
 * The cell is drawn from the document and edits it through
 * `songMixerModel.ts`, never through `view.commit`: its fields are kept out
 * of the lanes' signature, so a Level drag never repaints its own row. An
 * undo, a redo or an import renders the tab, which draws the cell again; a
 * strip edited on the Mixer tab redraws it in place (`refreshMixerCells`).
 * A press on the cell leaves the selection alone; the name cell selects.
 */
import type { MusicPart } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { makeKnob } from './knob';
import { STRIP_LEVEL_KNOB } from './mixerTables';
import type { StripSwitch } from './songMixerModel';
import {
  setStripLevel,
  stripOf,
  switchLabel,
  switchOn,
  switchesApply,
  toggleStripSwitch,
} from './songMixerModel';

/** The letter each switch shows. */
const SWITCH_TEXT: Readonly<Record<StripSwitch, string>> = { mute: 'M', solo: 'S' };

/** The column's header, in the ruler row: "Mixer", with room on its left for the expand arrow (windsor#158). */
export function mixerHeaderCell(): HTMLElement {
  const cell = el('div', 'mix-cell mix-head');
  cell.appendChild(el('span', '', 'Mixer'));
  return cell;
}

/** The cell a row with no strip holds (the loop brace, the Harmony lane), so the column stays opaque. */
export const emptyMixerCell = (): HTMLElement => el('div', 'mix-cell');

/** Each drawn part cell's redraw from the document, found by its element. */
const REFRESH = new WeakMap<Element, () => void>();

/**
 * Redraw every part cell under `root` from the document, in place: the knob
 * re-reads its Level and each button its switch and whether it applies. A
 * Mixer tab edit marks this tab nothing, so the view's watch calls this when
 * `stripSignature` moves; nothing is rebuilt, so a knob mid-drag stays.
 */
export function refreshMixerCells(root: ParentNode): void {
  for (const cell of root.querySelectorAll('.mix-cell')) REFRESH.get(cell)?.();
}

/** An M or S button over the part's strip, pressed while the switch is on, with its redraw. */
function switchButton(
  ctx: AppCtx,
  part: MusicPart,
  which: StripSwitch,
): { button: HTMLButtonElement; sync: () => void } {
  const { slot } = part;
  const label = switchLabel(which, part.name);
  const button = el('button', `btn mix-btn ${which}`, SWITCH_TEXT[which]) as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const sync = (): void => {
    const strip = stripOf(ctx, slot);
    const applies = switchesApply(strip);
    button.setAttribute('aria-pressed', String(switchOn(strip, which)));
    button.disabled = !applies;
    button.title = applies
      ? label
      : `${part.name} only feeds a sidechain: it has no output to ${which}`;
  };
  button.onclick = (): void => {
    toggleStripSwitch(ctx, slot, which);
    sync();
  };
  sync();
  return { button, sync };
}

/** A part's collapsed strip: Level and its value, M, S. */
export function partMixerCell(ctx: AppCtx, part: MusicPart): HTMLElement {
  const { slot } = part;
  const cell = el('div', 'mix-cell');
  const knob = makeKnob({
    ...STRIP_LEVEL_KNOB,
    compact: true,
    color: STRIP_COLOR,
    get: () => stripOf(ctx, slot).level,
    set: (v) => setStripLevel(ctx, slot, v),
  });
  cell.appendChild(knob);
  const mute = switchButton(ctx, part, 'mute');
  const solo = switchButton(ctx, part, 'solo');
  const switches = el('div', 'mix-switches');
  switches.appendChild(mute.button);
  switches.appendChild(solo.button);
  cell.appendChild(switches);
  REFRESH.set(cell, () => {
    knob.refresh();
    mute.sync();
    solo.sync();
  });
  return cell;
}
