/**
 * A host's slot area in its box (windsor#692; the approved mockup,
 * `docs/design/echo-slot-mockup.html`), after the host's own page:
 *
 * - **Empty, collapsed** (the default): a narrow tab with › and a vertical
 *   "Slot". A press expands the slot.
 * - **Empty, expanded:** the tab turned to ‹, then the picker on None. A
 *   press on ‹ collapses it again.
 * - **With a child:** a rule and the picker column (naming the child) at the
 *   end of the host's page, then the child (`insertChildBox.ts`). There is
 *   no tab; the child's own fold covers that.
 *
 * The picker lists None, then the Add picker's groups less the host's own
 * kind (`addPickerGroups`). Picking a kind puts a fresh child at its
 * defaults in the slot; None removes the child. Either drops the child's
 * lanes in the same edit and leaves the slot collapsed. Collapsed or
 * expanded is session view state beside the host's fold and page.
 */
import type { InsertKindName, InsertSpec } from '@windsor/engine';
import { insertSlot } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { addPickerGroups } from './insertAddPicker';
import { changeChild, childBox } from './insertChildBox';
import { INSERT_LABELS } from './insertKnobTables';
import { insertPage, insertRule, wideColumn } from './insertLayout';
import { openSlot } from './insertRackModel';
import { rackViewNow, setRackView } from './insertRailControls';
import type { ChainTarget } from './insertTarget';

/** The picker's value for an empty slot. */
const NONE = 'none';

/** The host whose slot is drawn, and its slot's view. */
export interface SlotHost {
  readonly ctx: AppCtx;
  readonly chain: ChainTarget;
  readonly id: string;
  readonly spec: InsertSpec;
  /** The empty slot is expanded to its picker. */
  readonly open: boolean;
  /** Redraw the host's box in place, then focus what `focus` selects inside it. */
  repaint(focus: string): void;
}

/** The slot area's cells: those at the end of the host's page, and those after its body. */
export interface SlotCells {
  readonly page: readonly HTMLElement[];
  readonly box: readonly HTMLElement[];
}

/** The slot picker, labelled Slot, on the child's kind or None. */
function slotPicker(host: SlotHost, value: string): HTMLElement {
  const label = INSERT_LABELS[host.spec.kind];
  const wrap = el('label', 'field-wrap', 'Slot');
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', `Slot: an insert on ${label}’s wet path, before Mix`);
  select.add(new Option('None', NONE));
  for (const group of addPickerGroups(host.spec.kind)) {
    const options = document.createElement('optgroup');
    options.label = group.label;
    for (const kind of group.kinds) options.append(new Option(INSERT_LABELS[kind], kind));
    select.append(options);
  }
  select.value = value;
  select.onchange = (): void => {
    const kind = select.value === NONE ? null : (select.value as InsertKindName);
    changeChild(host.ctx, host.chain, host.id, kind);
  };
  wrap.append(select);
  return wrap;
}

/** The empty slot's tab: › expands it to the picker, ‹ collapses it again. */
function slotTab(host: SlotHost): HTMLElement {
  const label = INSERT_LABELS[host.spec.kind];
  const tab = el('button', host.open ? 'slot-tab open' : 'slot-tab') as HTMLButtonElement;
  tab.type = 'button';
  tab.title = host.open
    ? 'Collapse the empty slot'
    : `Expand the slot: add an insert on ${label}’s wet path`;
  tab.setAttribute('aria-label', tab.title);
  tab.setAttribute('aria-expanded', String(host.open));
  tab.append(
    el('span', 'slot-tab-glyph', host.open ? '‹' : '›'),
    el('span', 'slot-tab-label', 'Slot'),
  );
  tab.onclick = (): void => {
    setRackView(openSlot(rackViewNow(), host.chain, host.id, !host.open));
    host.repaint(host.open ? '.slot-tab' : '.slot-open select');
  };
  return tab;
}

/** The host's slot area, in whichever of its three states the slot is. */
export function slotArea(host: SlotHost): SlotCells {
  const child = insertSlot(host.spec);
  if (child) {
    return {
      page: [insertRule(), wideColumn(slotPicker(host, child.kind))],
      box: [childBox({ ctx: host.ctx, chain: host.chain, hostId: host.id, repaint: host.repaint })],
    };
  }
  if (!host.open) return { page: [], box: [slotTab(host)] };
  const open = el('div', 'slot-open');
  open.append(slotTab(host), insertPage(wideColumn(slotPicker(host, NONE))));
  return { page: [], box: [open] };
}
