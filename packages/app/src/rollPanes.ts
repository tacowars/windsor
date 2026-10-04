/**
 * The Roll's four panes (windsor#602 decision 3; the mockup's `.roll`): the
 * ruler with the chord strip on top, the keyboard on the left, the notes,
 * and the velocity lane under them, with the corner that names the guide's
 * chord and the lane's VEL corner. The notes pane is the one scroller; the
 * other three are clipped and follow it, and a wheel over any of them
 * scrolls the notes. Their content runs `overhang` px past the notes', so
 * they still line up when the notes pane's scrollbars take room from it.
 */
import { el } from './dom';

/** The panes and their inner layers, which the paint fills. */
export interface RollPanes {
  readonly root: HTMLElement;
  readonly corner: HTMLElement;
  readonly head: HTMLElement;
  readonly headIn: HTMLElement;
  readonly keys: HTMLElement;
  readonly keysIn: HTMLElement;
  /** The notes pane, the scroller. */
  readonly body: HTMLElement;
  /** The notes pane's content: rows, lines, the repeats' hatch, notes and the playhead. */
  readonly canvas: HTMLElement;
  readonly vel: HTMLElement;
  readonly velIn: HTMLElement;
}

function pane(className: string): { outer: HTMLElement; inner: HTMLElement } {
  const outer = el('div', `roll-pane ${className}`);
  const inner = el('div', 'roll-inner');
  outer.appendChild(inner);
  return { outer, inner };
}

/** Keep the followers on the notes pane's scroll. */
export function syncPanes(panes: RollPanes): void {
  panes.head.scrollLeft = panes.body.scrollLeft;
  panes.vel.scrollLeft = panes.body.scrollLeft;
  panes.keys.scrollTop = panes.body.scrollTop;
}

/** A wheel over a follower scrolls the notes; with Shift, sideways. */
function forwardWheel(body: HTMLElement, e: WheelEvent): void {
  e.preventDefault();
  body.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
  if (!e.shiftKey) body.scrollTop += e.deltaY;
}

/** The empty panes, wired to follow the notes; `onScroll` runs after each sync. */
export function rollPanes(onScroll: () => void): RollPanes {
  const root = el('div', 'roll-grid');
  const corner = el('div', 'roll-pane roll-corner');
  const head = pane('roll-head');
  const keys = pane('roll-keys');
  const body = el('div', 'roll-body');
  const canvas = el('div', 'roll-inner roll-canvas');
  body.appendChild(canvas);
  const vcorner = el('div', 'roll-vcorner', 'VEL');
  const vel = pane('roll-vel');
  root.append(corner, head.outer, keys.outer, body, vcorner, vel.outer);
  const panes: RollPanes = {
    root,
    corner,
    head: head.outer,
    headIn: head.inner,
    keys: keys.outer,
    keysIn: keys.inner,
    body,
    canvas,
    vel: vel.outer,
    velIn: vel.inner,
  };
  body.addEventListener('scroll', () => {
    syncPanes(panes);
    onScroll();
  });
  for (const follower of [panes.head, panes.keys, panes.vel]) {
    follower.addEventListener('wheel', (e) => forwardWheel(body, e), { passive: false });
  }
  return panes;
}
