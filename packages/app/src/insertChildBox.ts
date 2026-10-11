/**
 * A host's slot child in its host's box (windsor#692; the approved mockup,
 * `docs/design/echo-slot-mockup.html`, the `.sub`): a nested shell around
 * the child's own card.
 *
 * - Its rail: the switch, `SLOT · <KIND>` and ✕, in the chain's accent
 *   (`--kc`), with no ◀ ▶ since the child can't move. The name folds the
 *   child to its rail and a click on the folded child opens it; ✕ removes
 *   the child.
 * - Its stack: the child's own tabs over its area only when it has two or
 *   more pages, then the page shown, its Mix included. Every card draws here
 *   as it draws on the rack, through the child's target.
 *
 * The fold and the page are kept under the child's target, which names the
 * host, so they follow the host through a reorder; a new child starts open
 * on its first page.
 */
import type { InsertKindName } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { INSERT_CARDS } from './insertCards';
import { childKindChange } from './insertChildLanes';
import { removeChild, setChild } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import { openSlot, showPage, toggleFold, viewAt } from './insertRackModel';
import { pageTabs, powerSwitch, railButton, rackViewNow, setRackView } from './insertRailControls';
import type { ChainTarget } from './insertTarget';
import { childTarget, insertsOf } from './insertTarget';
import { insertLaneHolder } from './knobAutomation';

/**
 * Put a fresh child of `kind` in the slot of the host `hostId` in `chain`, or
 * empty it for null, and drop the child's lanes in the same edit, so one undo
 * brings back the child, its id and its lanes. The slot is left collapsed.
 */
export function changeChild(
  ctx: AppCtx,
  chain: ChainTarget,
  hostId: string,
  kind: InsertKindName | null,
): void {
  const list = insertsOf(ctx, chain);
  const inserts = kind ? setChild(list, hostId, kind) : removeChild(list, hostId);
  const holder = insertLaneHolder(ctx.model.doc, chain);
  setRackView(openSlot(rackViewNow(), chain, hostId, false));
  if (ctx.change(childKindChange({ chain, inserts, hostId, holder })).ok) ctx.render();
}

/** Where a child sits: its host, and how to redraw the host's box. */
export interface ChildPlace {
  readonly ctx: AppCtx;
  readonly chain: ChainTarget;
  readonly hostId: string;
  /** Redraw the host's box in place, then focus what `focus` selects inside it. */
  repaint(focus: string): void;
}

/** The child's rail: switch, name (the fold) and ✕. */
function childRail(place: ChildPlace, sub: HTMLElement, folded: boolean): HTMLElement {
  const { ctx, chain, hostId, repaint } = place;
  const target = childTarget(chain, hostId);
  const spec = insertsOf(ctx, target)[0]!;
  const label = INSERT_LABELS[spec.kind];
  const root = el('div', 'sub-rail');
  const name = el('button', 'insert-name', `SLOT · ${label}`) as HTMLButtonElement;
  name.type = 'button';
  name.title = `${folded ? 'Open' : 'Fold'} ${label}`;
  name.setAttribute('aria-expanded', String(!folded));
  name.onclick = (): void => {
    setRackView(toggleFold(rackViewNow(), target, spec.id ?? ''));
    repaint('.sub .insert-name');
  };
  const remove = railButton('✕', `Remove ${label} from the slot`);
  remove.onclick = (): void => changeChild(ctx, chain, hostId, null);
  const tools = el('div', 'insert-tools');
  tools.append(remove);
  root.append(powerSwitch({ ctx, target, index: 0, spec, box: sub }), name, tools);
  return root;
}

/** The child in the slot of the host `hostId` in `chain`: its rail, then its tabs and page. */
export function childBox(place: ChildPlace): HTMLElement {
  const { ctx, chain, hostId, repaint } = place;
  const target = childTarget(chain, hostId);
  const spec = insertsOf(ctx, target)[0]!;
  const id = spec.id ?? '';
  const pages = INSERT_CARDS[spec.kind](ctx, target, 0);
  const names = pages.map((page) => page.name);
  const view = viewAt(rackViewNow(), target, id, names);
  const sub = el('div', 'sub');
  sub.classList.toggle('folded', view.folded);
  sub.appendChild(childRail(place, sub, view.folded));
  if (view.folded) {
    sub.onclick = (event): void => {
      if ((event.target as Element).closest('button')) return;
      setRackView(toggleFold(rackViewNow(), target, id));
      repaint('.sub .insert-name');
    };
    return sub;
  }
  const stack = el('div', 'sub-stack');
  if (pages.length > 1) {
    stack.appendChild(
      pageTabs(pages, view.page, (at) => {
        setRackView(showPage(rackViewNow(), target, id, names, at));
        repaint(`.sub [data-page="${at}"]`);
      }),
    );
  }
  const body = el('div', 'insert-body');
  const page = pages[view.page];
  if (page) body.appendChild(page.build());
  stack.appendChild(body);
  sub.appendChild(stack);
  return sub;
}
