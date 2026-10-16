/**
 * The touch or pen long press (windsor#825; record
 * `2026-10-16-song-tab-context-menu`, decision 8), shared by the part color
 * picker and the context menus. It is pointer-timed, because iOS Safari fires
 * no `contextmenu`: a touch or pen `pointerdown` starts it, moving past the
 * slop, `pointerup` or `pointercancel` cancels it, and at 450 ms it calls
 * `onLong`. While it is held, a ring around the finger fills, drawn on
 * `document.body` only once the press is past the ring's show time, so a tap
 * never flashes it. The rules are `longPressModel.ts`.
 */
import { HOLD_RING, LONG_PRESS } from './contextMenuTables';
import { el } from './dom';
import type { Point } from './longPressModel';
import { holdRingTiming, longPressDue, longPressMoved, longPressOpens } from './longPressModel';

/** The press that became a long press: where it began, and which pointer it is. */
export interface LongPressAt extends Point {
  readonly pointerType: string;
  readonly pointerId: number;
}

/** What `wireLongPress` hands back to the element's own handlers. */
export interface LongPressHandle {
  /**
   * Whether the release now arriving ends a press that opened, read once:
   * the caller swallows that release (no tap select, no click).
   */
  took(): boolean;
  /**
   * The platform's own `contextmenu` arrived (a right-click, or a touch
   * platform's long press): false when this press has already opened, since
   * one opening is enough; else it cancels the waiting press, counting it as
   * opened when one was held, and the caller opens.
   */
  claimContextMenu(): boolean;
  /** Drop the waiting press, if any, as a drag that takes over does. */
  cancel(): void;
}

const SVG = 'http://www.w3.org/2000/svg';

function ringCircle(className: string, radius: number): SVGCircleElement {
  const circle = document.createElementNS(SVG, 'circle');
  circle.setAttribute('class', className);
  circle.setAttribute('cx', String(radius));
  circle.setAttribute('cy', String(radius));
  circle.setAttribute('r', String(radius));
  circle.setAttribute('pathLength', '1');
  return circle;
}

/** The ring around `at`, filling over `fillMs`, on the page body. */
function drawRing(at: Point, fillMs: number): HTMLElement {
  const radius = HOLD_RING.radiusPx;
  const ring = el('div', 'hold-ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.left = `${at.x - radius}px`;
  ring.style.top = `${at.y - radius}px`;
  ring.style.setProperty('--hold-ring-size', `${radius * 2}px`);
  ring.style.setProperty('--hold-fill-ms', `${fillMs}ms`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.append(ringCircle('hold-ring-track', radius), ringCircle('hold-ring-fill', radius));
  ring.append(svg);
  document.body.append(ring);
  return ring;
}

/** A touch or pen press, waiting to become a long press. */
interface HeldPress {
  readonly at: LongPressAt;
  readonly startMs: number;
  now: Point;
  readonly timer: number;
  readonly ringTimer: number;
  ring: HTMLElement | null;
}

/**
 * Start timing the press `e`: `due` at the long press's time, and the ring
 * at its show time while `held` says the press is still the one waiting.
 */
function holdPress(
  e: PointerEvent,
  due: () => void,
  held: (press: HeldPress) => boolean,
): HeldPress {
  const at = { x: e.clientX, y: e.clientY, pointerType: e.pointerType, pointerId: e.pointerId };
  const { delayMs, fillMs } = holdRingTiming();
  const press: HeldPress = {
    at,
    startMs: performance.now(),
    now: at,
    timer: window.setTimeout(due, LONG_PRESS.ms),
    ringTimer: window.setTimeout(() => {
      if (held(press)) press.ring = drawRing(at, fillMs);
    }, delayMs),
    ring: null,
  };
  return press;
}

/** Call `onLong` when a touch or pen press on `target` is held 450 ms within 8 px. */
export function wireLongPress(
  target: HTMLElement,
  onLong: (at: LongPressAt) => void,
): LongPressHandle {
  let press: HeldPress | null = null;
  let opened = false;
  const cancel = (): void => {
    if (!press) return;
    window.clearTimeout(press.timer);
    window.clearTimeout(press.ringTimer);
    press.ring?.remove();
    press = null;
  };
  const due = (): void => {
    const held = press;
    cancel();
    if (!held) return;
    const now = { ms: performance.now(), at: held.now };
    if (!longPressDue({ startMs: held.startMs, from: held.at }, now)) return;
    opened = true;
    onLong(held.at);
  };
  target.addEventListener('pointerdown', (e) => {
    cancel();
    opened = false;
    if (longPressOpens(e.pointerType)) press = holdPress(e, due, (held) => press === held);
  });
  target.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.at.pointerId) return;
    press.now = { x: e.clientX, y: e.clientY };
    if (longPressMoved(press.at, press.now)) cancel();
  });
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointercancel', cancel);
  return {
    took: () => {
      const took = opened;
      opened = false;
      return took;
    },
    claimContextMenu: () => {
      if (opened) return false;
      opened = press !== null;
      cancel();
      return true;
    },
    cancel,
  };
}
