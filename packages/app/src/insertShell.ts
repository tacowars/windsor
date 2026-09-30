/**
 * One insert in the rack (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decisions 1 to 3; the
 * mockup's side-rail layout, `docs/research/2026-09-30-insert-rack/mockup.html`):
 * the shell every kind shares around its card's pages.
 *
 * - The rail on the left: the on/off switch bound to the insert's `enabled`,
 *   the vertical `N · NAME`, and ◀ ▶ ✕. The name folds the insert to its
 *   rail, and a click on a folded insert opens it.
 * - The body: a row of tabs when the card has two or more pages, then the
 *   page shown, the only one built. An insert that is off dims its body.
 *
 * The page and the fold are session view state (`insertRackModel.ts`), kept
 * here for the life of the page. Paging and folding repaint only the one
 * insert; a document edit goes through `commitChain` and a render.
 */
import type { InsertSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import type { InsertPage } from './insertCards';
import { INSERT_CARDS } from './insertCards';
import { moveInsert, removeInsert, setInsertField } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import type { RackSeen, RackView } from './insertRackModel';
import {
  afterMove,
  afterRemove,
  emptyRack,
  emptySeen,
  recordKinds,
  showPage,
  syncChain,
  toggleFold,
  viewAt,
} from './insertRackModel';
import type { InsertTarget } from './insertTarget';
import { insertChange, insertsOf } from './insertTarget';

/** Every rack's view state, for this session only: never in the song. */
let rackView: RackView = emptyRack();
/** The kinds each chain held when `rackView` last matched it. */
let rackSeen: RackSeen = emptySeen();

const kindsOf = (inserts: readonly InsertSpec[]): string[] => inserts.map((spec) => spec.kind);

/** The rack's view state now. */
export const currentRackView = (): RackView => rackView;

/**
 * Before a render of the chain `slot`: reset its view state if the document
 * changed its kinds some way other than the rack's own edits (an undo, a
 * redo, an import), so no fold or page lands on another insert.
 */
export function syncRackView(ctx: AppCtx, slot: InsertTarget): void {
  const next = syncChain({ view: rackView, seen: rackSeen }, slot, kindsOf(insertsOf(ctx, slot)));
  rackView = next.view;
  rackSeen = next.seen;
}

/**
 * Send the chain's next insert list as one edit (one undo step) and render.
 * `view` is the rack's view state to hold once the edit takes, for an edit
 * that moves inserts along the chain; the chain's new kinds are recorded
 * with it, so the render that follows keeps it.
 */
export function commitChain(
  ctx: AppCtx,
  slot: InsertTarget,
  inserts: readonly InsertSpec[],
  view?: RackView,
): void {
  if (!ctx.change(insertChange(slot, inserts)).ok) return;
  if (view) {
    rackView = view;
    rackSeen = recordKinds(rackSeen, slot, kindsOf(inserts));
  }
  ctx.render();
}

/** One of the rail's small square buttons. */
function railButton(glyph: string, title: string, className = ''): HTMLButtonElement {
  const button = el('button', `insert-icon ${className}`.trim(), glyph) as HTMLButtonElement;
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

/** One nudge along the chain: ◀ towards the front, ▶ towards the back (#652). */
function moveButton(ctx: AppCtx, slot: InsertTarget, index: number, delta: number): HTMLElement {
  const back = delta < 0;
  const list = insertsOf(ctx, slot);
  const kind = list[index]?.kind;
  const button = railButton(
    back ? '◀' : '▶',
    `Move ${kind ? INSERT_LABELS[kind] : 'this insert'} ${back ? 'earlier' : 'later'} in the chain`,
  );
  button.disabled = back ? index === 0 : index === list.length - 1;
  button.onclick = (): void => {
    const now = insertsOf(ctx, slot);
    const view = afterMove(rackView, slot, { index, delta, length: now.length });
    commitChain(ctx, slot, moveInsert(now, index, delta), view);
  };
  return button;
}

interface ShellParts {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  readonly spec: InsertSpec;
  readonly folded: boolean;
  /** Redraw this insert in place, then focus what `focus` selects inside it. */
  repaint(focus: string): void;
}

function rail({ ctx, slot, index, spec, folded, repaint }: ShellParts): HTMLElement {
  const root = el('div', 'insert-rail');
  const label = INSERT_LABELS[spec.kind];
  const power = railButton('⏻', `Turn ${label} ${spec.enabled ? 'off' : 'on'}`, 'insert-power');
  power.setAttribute('aria-pressed', String(spec.enabled));
  power.onclick = (): void => {
    const now = insertsOf(ctx, slot)[index];
    if (now)
      commitChain(ctx, slot, setInsertField(insertsOf(ctx, slot), index, 'enabled', !now.enabled));
  };
  const name = el('button', 'insert-name') as HTMLButtonElement;
  name.type = 'button';
  name.setAttribute('aria-label', `${index + 1} ${label}`);
  name.append(el('span', 'insert-num', String(index + 1)), document.createTextNode(label));
  name.title = `${folded ? 'Open' : 'Fold'} ${label}`;
  name.setAttribute('aria-expanded', String(!folded));
  name.onclick = (): void => {
    rackView = toggleFold(rackView, slot, index);
    repaint('.insert-name');
  };
  const remove = railButton('✕', `Remove ${label}`);
  remove.onclick = (): void => {
    const now = insertsOf(ctx, slot);
    commitChain(
      ctx,
      slot,
      removeInsert(now, index),
      afterRemove(rackView, slot, index, now.length),
    );
  };
  const tools = el('div', 'insert-tools');
  tools.append(moveButton(ctx, slot, index, -1), moveButton(ctx, slot, index, 1), remove);
  root.append(power, name, tools);
  return root;
}

function tabs(parts: ShellParts, pages: readonly InsertPage[], shown: number): HTMLElement {
  const row = el('div', 'insert-tabs');
  row.setAttribute('role', 'tablist');
  const names = pages.map((page) => page.name);
  pages.forEach((page, at) => {
    const tab = el('button', '', page.name) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(at === shown));
    tab.dataset.page = String(at);
    if (page.title) tab.title = page.title;
    tab.onclick = (): void => {
      rackView = showPage(rackView, parts.slot, parts.index, names, at);
      parts.repaint(`[data-page="${at}"]`);
    };
    row.appendChild(tab);
  });
  return row;
}

/** The insert at `index` of the chain `slot` names, in its shell. */
export function insertBox(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const spec = insertsOf(ctx, slot)[index]!;
  const pages = INSERT_CARDS[spec.kind](ctx, slot, index);
  const view = viewAt(
    rackView,
    slot,
    index,
    pages.map((page) => page.name),
  );
  const box = el('div', 'insert-box');
  box.classList.toggle('off', !spec.enabled);
  box.classList.toggle('folded', view.folded);
  const parts: ShellParts = {
    ctx,
    slot,
    index,
    spec,
    folded: view.folded,
    repaint: (focus) => {
      const next = insertBox(ctx, slot, index);
      box.replaceWith(next);
      next.querySelector<HTMLElement>(focus)?.focus();
    },
  };
  box.appendChild(rail(parts));
  if (view.folded) {
    box.onclick = (event): void => {
      if ((event.target as Element).closest('button')) return;
      rackView = toggleFold(rackView, slot, index);
      parts.repaint('.insert-name');
    };
    return box;
  }
  const stack = el('div', 'insert-stack');
  if (pages.length > 1) stack.appendChild(tabs(parts, pages, view.page));
  const body = el('div', 'insert-body');
  const page = pages[view.page];
  if (page) body.appendChild(page.build());
  stack.appendChild(body);
  box.appendChild(stack);
  return box;
}
