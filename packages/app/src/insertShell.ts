/**
 * One insert in the rack (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decisions 1 to 3; the
 * mockup's side-rail layout, `docs/research/2026-09-30-insert-rack/mockup.html`):
 * the shell every kind shares around its card's pages.
 *
 * - The rail on the left: the on/off switch bound to the insert's `enabled`
 *   (`insertRailControls.ts`, locked while a lane holds it), the vertical
 *   `N · NAME`, and ◀ ▶ ✕. The name folds the insert to its rail, and a
 *   click on a folded insert opens it.
 * - The body: a row of tabs when the card has two or more pages, then the
 *   page shown, the only one built. An insert that is off dims its body.
 * - A host's slot (windsor#692, `insertSlotArea.ts`), after the body: the
 *   collapsed tab, the picker, or the picker column and the child. Folding
 *   the host hides it with the body. A slot child is drawn by its own box,
 *   never by this shell, so a host kind as a child has no slot area.
 *
 * The page and the fold are session view state (`insertRackModel.ts`), kept
 * for the life of the page. Paging and folding repaint only the one insert;
 * a document edit goes through `commitChain` and a render.
 */
import { INSERT_KINDS, isHostKind } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { INSERT_CARDS } from './insertCards';
import { moveInsert, removeInsert } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import { insertIdAt, showPage, toggleFold, viewAt } from './insertRackModel';
import {
  commitChain,
  pageTabs,
  powerSwitch,
  railButton,
  rackViewNow,
  setRackView,
} from './insertRailControls';
import { slotArea } from './insertSlotArea';
import type { ChainTarget } from './insertTarget';
import { insertsOf } from './insertTarget';

/** One nudge along the chain: ◀ towards the front, ▶ towards the back (#652). */
function moveButton(ctx: AppCtx, slot: ChainTarget, index: number, delta: number): HTMLElement {
  const back = delta < 0;
  const list = insertsOf(ctx, slot);
  const kind = list[index]?.kind;
  const button = railButton(
    back ? '◀' : '▶',
    `Move ${kind ? INSERT_LABELS[kind] : 'this insert'} ${back ? 'earlier' : 'later'} in the chain`,
  );
  button.disabled = back ? index === 0 : index === list.length - 1;
  button.onclick = (): void => {
    commitChain(ctx, slot, moveInsert(insertsOf(ctx, slot), index, delta));
  };
  return button;
}

interface ShellParts {
  readonly ctx: AppCtx;
  readonly slot: ChainTarget;
  readonly index: number;
  /** The insert's id: what its view state is kept by. */
  readonly id: string;
  readonly folded: boolean;
  /** Redraw this insert in place, then focus what `focus` selects inside it. */
  repaint(focus: string): void;
}

function rail(parts: ShellParts, power: HTMLElement): HTMLElement {
  const { ctx, slot, index, id, folded, repaint } = parts;
  const root = el('div', 'insert-rail');
  const label = INSERT_LABELS[insertsOf(ctx, slot)[index]!.kind];
  const name = el('button', 'insert-name') as HTMLButtonElement;
  name.type = 'button';
  name.setAttribute('aria-label', `${index + 1} ${label}`);
  name.append(el('span', 'insert-num', String(index + 1)), document.createTextNode(label));
  name.title = `${folded ? 'Open' : 'Fold'} ${label}`;
  name.setAttribute('aria-expanded', String(!folded));
  name.onclick = (): void => {
    setRackView(toggleFold(rackViewNow(), slot, id));
    repaint('.insert-name');
  };
  const remove = railButton('✕', `Remove ${label}`);
  remove.onclick = (): void => {
    commitChain(ctx, slot, removeInsert(insertsOf(ctx, slot), index));
  };
  const tools = el('div', 'insert-tools');
  tools.append(moveButton(ctx, slot, index, -1), moveButton(ctx, slot, index, 1), remove);
  root.append(power, name, tools);
  return root;
}

/** The insert at `index` of the chain `slot` names, in its shell. */
export function insertBox(ctx: AppCtx, slot: ChainTarget, index: number): HTMLElement {
  const list = insertsOf(ctx, slot);
  const spec = list[index]!;
  const id = insertIdAt(list, index);
  const pages = INSERT_CARDS[spec.kind](ctx, slot, index);
  const names = pages.map((page) => page.name);
  const view = viewAt(rackViewNow(), slot, id, names);
  const box = el('div', 'insert-box');
  box.classList.toggle('folded', view.folded);
  const parts: ShellParts = {
    ctx,
    slot,
    index,
    id,
    folded: view.folded,
    repaint: (focus) => {
      const next = insertBox(ctx, slot, index);
      box.replaceWith(next);
      next.querySelector<HTMLElement>(focus)?.focus();
    },
  };
  box.appendChild(rail(parts, powerSwitch({ ctx, target: slot, index, spec, box })));
  if (view.folded) {
    box.onclick = (event): void => {
      if ((event.target as Element).closest('button')) return;
      setRackView(toggleFold(rackViewNow(), slot, id));
      parts.repaint('.insert-name');
    };
    return box;
  }
  const stack = el('div', 'insert-stack');
  if (pages.length > 1) {
    stack.appendChild(
      pageTabs(pages, view.page, (at) => {
        setRackView(showPage(rackViewNow(), slot, id, names, at));
        parts.repaint(`[data-page="${at}"]`);
      }),
    );
  }
  const body = el('div', 'insert-body');
  const page = pages[view.page]?.build();
  if (page) body.appendChild(page);
  stack.appendChild(body);
  box.appendChild(stack);
  if (isHostKind(INSERT_KINDS[spec.kind])) {
    const area = slotArea({
      ctx,
      chain: slot,
      id,
      spec,
      open: view.slotOpen,
      repaint: parts.repaint,
    });
    page?.append(...area.page);
    box.append(...area.box);
  }
  return box;
}
