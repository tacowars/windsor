/**
 * A chain's inserts as a rack (#641; windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains`): one row that never wraps
 * and scrolls sideways, every insert the rack's height and as wide as its
 * content, in signal order between two Add slots. The left slot adds at the
 * front of the chain and the right slot at the back; both are disabled once
 * the chain holds `MAX_INSERTS`. Each insert is `insertShell.ts`'s shell
 * around its card's pages. Adding and removing are live partials like every
 * other strip edit: the engine rebuilds that one strip's chain, and the
 * transport and every other part keep playing.
 */
import type { InsertTarget } from './insertTarget';
import type { InsertKindName } from '@windsor/engine';
import { MAX_INSERTS } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { addSlot } from './insertAddPicker';
import { addInsert, addInsertAtFront, canAddInsert } from './insertEdits';
import { insertsOf } from './insertKnobs';
import { afterAdd } from './insertRackModel';
import type { RackAccent } from './insertRackTables';
import { INSERT_RACK_PX, RACK_ACCENTS } from './insertRackTables';
import { commitChain, currentRackView, insertBox, syncRackView } from './insertShell';

/** Which end of the chain an Add slot adds at. */
type AddSide = 'front' | 'back';

const SIDE_WORDS: Readonly<Record<AddSide, string>> = {
  front: 'at the front',
  back: 'at the back',
};

function add(ctx: AppCtx, slot: InsertTarget, side: AddSide, kind: InsertKindName): void {
  const list = insertsOf(ctx, slot);
  const front = side === 'front';
  const next = front ? addInsertAtFront(list, kind, slot) : addInsert(list, kind, slot);
  const view = afterAdd(currentRackView(), slot, front ? 0 : list.length, list.length);
  commitChain(ctx, slot, next, view);
}

function addPicker(ctx: AppCtx, slot: InsertTarget, side: AddSide): HTMLElement {
  const full = !canAddInsert(insertsOf(ctx, slot));
  const picker = addSlot({
    disabled: full,
    title: full ? `A strip holds at most ${MAX_INSERTS} inserts` : '',
    pick: (kind) => add(ctx, slot, side, kind),
  });
  picker.name = `add-insert-${slot}-${side}`;
  picker.setAttribute(
    'aria-label',
    slot === 'master'
      ? 'Add an insert to Master'
      : typeof slot === 'string'
        ? `Add an insert to Send ${slot.toUpperCase()}`
        : `Add an insert to slot ${slot}`,
  );
  picker.setAttribute('aria-label', `${picker.getAttribute('aria-label')} ${SIDE_WORDS[side]}`);
  return picker;
}

/**
 * The chain's rack: the front Add slot, each insert, the back Add slot.
 * `accent` is the rack's colour: a part's and the master's by default, a
 * send bus's with `'bus'`.
 */
export function stripInserts(
  ctx: AppCtx,
  slot: InsertTarget,
  accent: RackAccent = 'strip',
): HTMLElement {
  syncRackView(ctx, slot);
  const row = el('div', 'insert-row');
  for (const [name, px] of Object.entries(INSERT_RACK_PX)) row.style.setProperty(name, `${px}px`);
  row.style.setProperty('--kc', RACK_ACCENTS[accent]);
  row.appendChild(addPicker(ctx, slot, 'front'));
  insertsOf(ctx, slot).forEach((_, index) => row.appendChild(insertBox(ctx, slot, index)));
  row.appendChild(addPicker(ctx, slot, 'back'));
  return row;
}
