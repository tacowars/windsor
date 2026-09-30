/**
 * The Song tab's mixer column (windsor#157, windsor#158; record
 * `2026-09-30-mixer-on-the-song-tab` decisions 1 to 3): one cell a row
 * between the lane names and the timeline, frozen with the names while the
 * timeline scrolls. The ruler row's cell is the column's header, led by the
 * arrow that expands every strip at once; the loop and Harmony rows' are
 * empty. A part's is its strip: collapsed, a compact Level knob with its
 * value, then M and S; expanded, Level, Pan, Low cut, a send per return, the
 * Output select, M and S, under the header's column labels. The arrow's
 * state is the view's (`SongViewState.mixerExpanded`), and a toggle draws
 * the cells again, so one set of strip controls exists at a time.
 *
 * The cell is drawn from the document and edits it through
 * `songMixerModel.ts`, never through `view.commit`: its fields are kept out
 * of the lanes' signature, so a Level drag never repaints its own row. An
 * undo, a redo or an import renders the tab, which draws the cell again; a
 * strip edited on the Mixer tab redraws it in place (`refreshMixerCells`).
 * A press on the cell leaves the selection alone; the name cell selects.
 *
 * After M and S sit the part's activity and clip lights (windsor#159). The
 * cell only places them: the column's one poller (`songMixerLights.ts`)
 * owns their meters and the clip latch, so a redrawn cell keeps both.
 */
import type { MusicPart } from '@windsor/engine';
import { RETURN_NAMES } from '@windsor/engine';
import { RETURN_COLOR, STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import type { KnobElement, KnobSpec } from './knob';
import { makeKnob } from './knob';
import {
  SEND_DEFAULT,
  STRIP_LEVEL_KNOB,
  STRIP_LOW_CUT_KNOB,
  STRIP_PAN_KNOB,
  sendKnob,
} from './mixerTables';
import type { StripSwitch } from './songMixerModel';
import {
  setStripLevel,
  setStripLowCut,
  setStripOutput,
  setStripPan,
  setStripSend,
  stripOf,
  stripOutput,
  switchEnabled,
  switchLabel,
  switchOn,
  toggleStripSwitch,
} from './songMixerModel';
import type { MixerLights } from './songMixerLights';
import { outputSelect } from './trackOutput';

/** The letter each switch shows. */
const SWITCH_TEXT: Readonly<Record<StripSwitch, string>> = { mute: 'M', solo: 'S' };

/** The expanded header's label over the Output select; the knobs' come from their specs. */
const OUTPUT_HEADING = 'Out';

/** The expanded strip's knobs, in order: Level, Pan, Low cut, then a send per return. */
const EXPANDED_KNOBS: readonly string[] = [
  STRIP_LEVEL_KNOB.label,
  STRIP_PAN_KNOB.label,
  STRIP_LOW_CUT_KNOB.label,
  ...RETURN_NAMES.map((ret) => sendKnob(ret).label),
];

/** How many knob columns the expanded strip draws, for the column's width. */
export const EXPANDED_KNOB_COUNT = EXPANDED_KNOBS.length;

/** The mixer column's arrow: whether every strip is expanded, and what a press does. */
export interface MixerToggle {
  readonly expanded: boolean;
  toggle(): void;
}

/** The arrow that expands or collapses every strip (windsor#158 decision 1). */
function toggleButton({ expanded, toggle }: MixerToggle): HTMLButtonElement {
  const button = el('button', 'mix-toggle', expanded ? '▾' : '▸') as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', 'Mixer strips');
  button.title = expanded
    ? 'Collapse every strip to Level, M and S'
    : 'Expand every strip to Level, Pan, Low cut, the sends and Output';
  button.onclick = toggle;
  return button;
}

/**
 * The column's header, in the ruler row: the arrow, then "Mixer" collapsed
 * or, expanded, each column's label over its control (decision 3).
 */
export function mixerHeaderCell(toggle: MixerToggle): HTMLElement {
  const cell = el('div', toggle.expanded ? 'mix-cell mix-head expanded' : 'mix-cell mix-head');
  cell.appendChild(toggleButton(toggle));
  if (!toggle.expanded) {
    cell.appendChild(el('span', '', 'Mixer'));
    return cell;
  }
  for (const label of [...EXPANDED_KNOBS, OUTPUT_HEADING]) {
    cell.appendChild(el('span', 'mix-label', label));
  }
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
    const enabled = switchEnabled(strip, which);
    button.setAttribute('aria-pressed', String(switchOn(strip, which)));
    button.disabled = !enabled;
    button.title = enabled
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

/** A compact strip knob over the part's strip. */
const stripKnob = (
  spec: Omit<KnobSpec, 'get' | 'set'>,
  get: () => number,
  set: (v: number) => void,
): KnobElement => makeKnob({ color: STRIP_COLOR, ...spec, compact: true, get, set });

/** The part's knobs: Level alone collapsed; expanded, Level, Pan, Low cut and a send per return. */
function stripKnobs(ctx: AppCtx, slot: number, expanded: boolean): KnobElement[] {
  const strip = (): ReturnType<typeof stripOf> => stripOf(ctx, slot);
  const level = stripKnob(
    STRIP_LEVEL_KNOB,
    () => strip().level,
    (v) => setStripLevel(ctx, slot, v),
  );
  if (!expanded) return [level];
  return [
    level,
    stripKnob(
      STRIP_PAN_KNOB,
      () => strip().pan,
      (v) => setStripPan(ctx, slot, v),
    ),
    stripKnob(
      STRIP_LOW_CUT_KNOB,
      () => strip().lowCut,
      (v) => setStripLowCut(ctx, slot, v),
    ),
    ...RETURN_NAMES.map((ret) =>
      stripKnob(
        { ...sendKnob(ret), color: RETURN_COLOR },
        () => strip().sends[ret] ?? SEND_DEFAULT,
        (v) => setStripSend(ctx, slot, ret, v),
      ),
    ),
  ];
}

/**
 * A part's strip: collapsed, Level and its value, M, S; expanded, every
 * knob, the Output select, M, S; then the lights either way, placed here
 * and polled by `lights`. Its redraw re-reads every control; an
 * Output change re-syncs M and S at once, since whether they apply follows
 * it (windsor#157's rule as amended on PR #168).
 */
export function partMixerCell(
  ctx: AppCtx,
  part: MusicPart,
  expanded: boolean,
  lights: MixerLights,
): HTMLElement {
  const { slot } = part;
  const cell = el('div', expanded ? 'mix-cell expanded' : 'mix-cell');
  const knobs = stripKnobs(ctx, slot, expanded);
  cell.append(...knobs);
  const mute = switchButton(ctx, part, 'mute');
  const solo = switchButton(ctx, part, 'solo');
  const output = expanded
    ? outputSelect({
        label: `Output ${part.name}`,
        get: () => stripOutput(stripOf(ctx, slot)),
        set: (next) => {
          const ok = setStripOutput(ctx, slot, next);
          mute.sync();
          solo.sync();
          return ok;
        },
      })
    : null;
  if (output) cell.appendChild(output.select);
  const switches = el('div', 'mix-switches');
  switches.appendChild(mute.button);
  switches.appendChild(solo.button);
  cell.appendChild(switches);
  cell.appendChild(lights.lightsFor(slot, part.name));
  REFRESH.set(cell, () => {
    for (const knob of knobs) knob.refresh();
    output?.sync();
    mute.sync();
    solo.sync();
  });
  return cell;
}
