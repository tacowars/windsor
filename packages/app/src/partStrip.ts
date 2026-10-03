/**
 * The part strip (windsor#520; record `2026-10-03-parts-tab-layout`,
 * decisions 2, 3 and 9): the header's second row, above every tab. One chip
 * per part in the document's order, which is the Song tab's lane order; a
 * click picks that part as the shared selection (`ctx.parts.pick`) and
 * re-renders the shown tab, so the Parts tab's editor and the Song view's
 * lane follow it. + adds a part and − removes the selected one, with the
 * confirm the Parts tab's rail used to ask.
 *
 * The chips share the row, 70 to 150 px each (`console.css`). When they
 * don't fit, which is measured and never assumed from the window, the row
 * scrolls sideways like browser tabs: ‹ › page it, its edges fade, ▾ lists
 * every part, and the selected chip is kept in view after every draw.
 *
 * It is chrome (`ctx.addChrome`), so it draws on every `render()`, and it
 * hears every selection change (`ctx.parts.onSelect`), so a pick made in the
 * Song view moves its highlight. The rules are `partStripModel.ts`.
 */
import { partAt } from '@windsor/engine';
import type { AppContext } from './appContext';
import type { AppCtx } from './context';
import { el } from './dom';
import { openConfirm } from './metadataModal';
import { addPartLive, removePartLive } from './partEdits';
import { partListPopover } from './partStripList';
import { watchStripDots } from './partStripDots';
import {
  addPartTitle,
  canAddPart,
  canRemovePart,
  chipLabel,
  chipsOverflow,
  pageScrollTarget,
  removePartTitle,
  revealScrollLeft,
} from './partStripModel';
import { PART_STRIP } from './partStripTables';

function stripButton(className: string, text: string, title: string): HTMLButtonElement {
  const button = el('button', className, text) as HTMLButtonElement;
  button.type = 'button';
  button.title = title;
  return button;
}

/** Pick `slot` and bring the shown tab up to date; nothing when it was already selected. */
export function pickPart(ctx: AppCtx, slot: number): void {
  if (ctx.parts.pick(slot)) ctx.refreshTabs();
}

function chip(ctx: AppCtx, index: number, slot: number): { node: HTMLElement; dot: HTMLElement } {
  const part = ctx.model.doc.parts[index]!;
  const label = chipLabel(part, index);
  const node = stripButton('pchip', '', part.name);
  node.style.setProperty('--tone', label.tone);
  node.setAttribute('aria-pressed', String(slot === ctx.parts.selected));
  node.dataset.slot = String(slot);
  const dot = el('i', 'dot');
  dot.setAttribute('aria-hidden', 'true');
  node.append(el('span', 'n', label.name), el('span', 'k', label.meta), dot);
  node.onclick = (): void => pickPart(ctx, slot);
  return { node, dot };
}

/** − : remove the selected part after today's confirm; the selection then resolves to a neighbour. */
function confirmRemove(ctx: AppCtx, opener: HTMLElement): void {
  const slot = ctx.parts.selected;
  const part = partAt(ctx.model.doc, slot);
  if (!part) return;
  void openConfirm({
    title: 'Remove part',
    body: `Remove "${part.name}"? Its patch stays in the song while another part plays it.`,
    ok: 'Remove',
    opener,
  }).then((ok) => {
    if (ok) removePartLive(ctx, slot);
  });
}

/** Shift + wheel scrolls the row where the platform sends it as a vertical wheel. */
function wireWheel(scroll: HTMLElement): void {
  scroll.addEventListener(
    'wheel',
    (e) => {
      if (!e.shiftKey || e.deltaX !== 0 || e.deltaY === 0) return;
      scroll.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}

/** The strip's frame: built once; the chips inside are drawn again on every render and pick. */
interface StripFrame {
  readonly root: HTMLElement;
  readonly scroll: HTMLElement;
  readonly pm: HTMLElement;
  readonly add: HTMLButtonElement;
  readonly remove: HTMLButtonElement;
}

function buildFrame(ctx: AppCtx, root: HTMLElement): StripFrame {
  root.style.setProperty('--pfade', `${PART_STRIP.fadePx}px`);
  const scroll = el('div', 'pscroll');
  const page = (direction: -1 | 1): void =>
    scroll.scrollTo({
      left: pageScrollTarget(scroll, direction, PART_STRIP.fadePx),
      behavior: 'smooth',
    });
  const prev = stripButton('pnav', '‹', 'Scroll parts left');
  prev.onclick = (): void => page(-1);
  const next = stripButton('pnav', '›', 'Scroll parts right');
  next.onclick = (): void => page(1);
  const list = partListPopover(ctx, (slot) => pickPart(ctx, slot));
  const add = stripButton('btn pm-btn', '+', '');
  add.onclick = (): void => void addPartLive(ctx);
  const remove = stripButton('btn pm-btn', '−', '');
  remove.onclick = (): void => confirmRemove(ctx, remove);
  const pm = el('div', 'pm');
  pm.append(add, remove);
  wireWheel(scroll);
  root.replaceChildren(prev, scroll, next, list.button, list.popover, pm);
  return { root, scroll, pm, add, remove };
}

const px = (value: string): number => parseFloat(value) || 0;

/**
 * Show the overflow controls only while the chips overflow: measured on the
 * strip, against the room the chips have with ‹ › ▾ hidden, so the
 * controls' own width never holds them on.
 */
function fitOverflow(frame: StripFrame): void {
  const first = frame.scroll.firstElementChild;
  const over =
    first !== null &&
    chipsOverflow({
      count: frame.scroll.childElementCount,
      chipMinPx: px(getComputedStyle(first).minWidth),
      gapPx: px(getComputedStyle(frame.scroll).columnGap),
      availablePx:
        frame.root.clientWidth - frame.pm.offsetWidth - px(getComputedStyle(frame.root).columnGap),
    });
  frame.root.classList.toggle('over', over);
}

/** The slot of the chip holding the keyboard focus, if one does. */
function focusedSlot(frame: StripFrame): string | undefined {
  const active = document.activeElement;
  return active instanceof HTMLElement && frame.scroll.contains(active)
    ? active.dataset.slot
    : undefined;
}

/** The selected chip clear of the faded edges. */
function revealSelected(frame: StripFrame): void {
  const selected = frame.scroll.querySelector<HTMLElement>('.pchip[aria-pressed="true"]');
  if (!selected) return;
  frame.scroll.scrollLeft = revealScrollLeft(
    frame.scroll,
    { left: selected.offsetLeft, width: selected.offsetWidth },
    PART_STRIP.fadePx,
  );
}

export function mountPartStrip(ctx: AppContext<HTMLElement>, root: HTMLElement): void {
  const frame = buildFrame(ctx, root);
  const dots = watchStripDots(ctx, root);
  const draw = (): void => {
    const { parts } = ctx.model.doc;
    const focused = focusedSlot(frame);
    const chips = parts.map((part, index) => chip(ctx, index, part.slot));
    frame.scroll.replaceChildren(...chips.map((c) => c.node));
    // A keyboard pick redraws the chip it was made on; the focus stays with it.
    if (focused !== undefined) {
      frame.scroll.querySelector<HTMLElement>(`.pchip[data-slot="${focused}"]`)?.focus();
    }
    dots.set(new Map(parts.map((part, index) => [part.slot, chips[index]!.dot])));
    frame.add.disabled = !canAddPart(parts.length);
    frame.add.title = addPartTitle(parts.length);
    frame.remove.disabled = !canRemovePart(parts.length);
    frame.remove.title = removePartTitle(partAt(ctx.model.doc, ctx.parts.selected)?.name ?? '');
    fitOverflow(frame);
    revealSelected(frame);
  };
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => fitOverflow(frame)).observe(frame.root);
  }
  ctx.addChrome(draw);
  ctx.parts.onSelect(draw);
  draw();
}
