/**
 * What an insert's rail and a slot child's rail share (windsor#173,
 * windsor#692): the rack's session view state, the one chain write, the
 * rail's small square buttons, the on/off switch and the page tabs. The
 * shell (`insertShell.ts`) and the slot child's box (`insertChildBox.ts`)
 * both draw from here, so neither imports the other.
 *
 * While a lane on the switch is on (windsor#631, record
 * `2026-10-06-insert-switch-lanes` decision 9), the switch locks as an
 * automated knob does (`knobLock.ts`): the lane's colour and an AUTO tag,
 * the lane's level at the playhead on the button and the box, and a press
 * that says to switch the lane off instead of toggling.
 */
import type { InsertSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import type { InsertPage } from './insertCards';
import { setInsertField } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import { insertFieldLock } from './insertKnobs';
import type { RackView } from './insertRackModel';
import { emptyRack } from './insertRackModel';
import type { InsertTarget } from './insertTarget';
import { insertsOf, targetChange } from './insertTarget';
import { lockNotice, type KnobAutomation } from './knobAutomation';
import { AUTO_TAG_TEXT, followAutomation, paintLock, switchShowsOn } from './knobLock';

/**
 * Every rack's view state, for this session only: never in the song. It is
 * keyed by each insert's id, so no edit, undo or import has to move it.
 */
let rackView: RackView = emptyRack();

/** The racks' view state now. */
export const rackViewNow = (): RackView => rackView;

/** Replace the racks' view state with `next`. */
export function setRackView(next: RackView): void {
  rackView = next;
}

/** Send the chain's next insert list as one edit (one undo step) and render. */
export function commitChain(
  ctx: AppCtx,
  target: InsertTarget,
  inserts: readonly InsertSpec[],
): void {
  if (!ctx.change(targetChange(ctx, target, inserts)).ok) return;
  ctx.render();
}

/** One of the rail's small square buttons. */
export function railButton(glyph: string, title: string, className = ''): HTMLButtonElement {
  const button = el('button', `insert-icon ${className}`.trim(), glyph) as HTMLButtonElement;
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

/** What the switch needs: the insert it turns on and off, and the box it dims. */
export interface SwitchParts {
  readonly ctx: AppCtx;
  readonly target: InsertTarget;
  readonly index: number;
  readonly spec: InsertSpec;
  /** The insert's box, which the switch dims while the insert is off. */
  readonly box: HTMLElement;
}

/** The switch's field, which a lane may hold (windsor#628). */
const SWITCH_FIELD = 'enabled';

/** The on/off switch and its AUTO tag, lit and following the lane while one holds it. */
export function powerSwitch({ ctx, target, index, spec, box }: SwitchParts): HTMLElement {
  const label = INSERT_LABELS[spec.kind];
  const root = el('div', 'insert-switch');
  const power = railButton('⏻', '', 'insert-power');
  root.append(power, el('span', 'knob-auto', AUTO_TAG_TEXT));
  const automation = insertFieldLock(ctx, target, index, SWITCH_FIELD).automation;
  const lockNow = (): KnobAutomation | null => automation?.() ?? null;
  const render = (): void => {
    const lock = lockNow();
    const on = switchShowsOn(spec.enabled, lock);
    const title = lock ? `${label} is automated in the song` : `Turn ${label} ${on ? 'off' : 'on'}`;
    power.title = title;
    power.setAttribute('aria-label', title);
    power.setAttribute('aria-pressed', String(on));
    box.classList.toggle('off', !on);
    paintLock(root, lock);
  };
  power.onclick = (): void => {
    const lock = lockNow();
    if (lock) return ctx.notify(lockNotice(`${label} On`, lock));
    const now = insertsOf(ctx, target)[index];
    if (now)
      commitChain(
        ctx,
        target,
        setInsertField(insertsOf(ctx, target), index, SWITCH_FIELD, !now.enabled),
      );
  };
  render();
  if (automation) followAutomation(root, lockNow, render);
  return root;
}

/** A row of page tabs, `shown` selected; a press on another calls `pick` with its index. */
export function pageTabs(
  pages: readonly InsertPage[],
  shown: number,
  pick: (at: number) => void,
): HTMLElement {
  const row = el('div', 'insert-tabs');
  row.setAttribute('role', 'tablist');
  pages.forEach((page, at) => {
    const tab = el('button', '', page.name) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(at === shown));
    tab.dataset.page = String(at);
    if (page.title) tab.title = page.title;
    tab.onclick = (): void => pick(at);
    row.appendChild(tab);
  });
  return row;
}
