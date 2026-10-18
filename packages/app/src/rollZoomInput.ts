/**
 * The Roll's zoom gestures on its panes (windsor#903; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 4 to 6), over
 * `rollZoomGestures.ts`'s maths and the card's zoom (`rollZoomControl.ts`):
 *
 * - the ruler: a drag zooms and scrolls; a double-click switches the view
 *   between the loop and the region (from neither, to the loop). The loop
 *   brace's handle keeps its own drag (`rollLaneGestures.ts`);
 * - the keys: a drag sets the row height and scrolls the rows; a tap does
 *   what it did before, nothing;
 * - Ctrl or ⌘ with the wheel, as a trackpad's pinch arrives, over the
 *   notes, the ruler or the lane: time zooms around the pointer;
 * - two fingers on the notes: `rollPinch.ts`.
 *
 * Each drag captures the pointer on the pane, which outlives the paint
 * that replaces its content, and ends on a release, a cancel, a lost
 * capture, a window blur or a move with the button up (`stepRulerDrag`).
 */
import type { RollPanes } from './rollPanes';
import { ROLL_ZOOM_TEXT } from './rollTables';
import type { RollZoomControl } from './rollZoomControl';
import {
  type ZoomPress,
  keysDrag,
  rulerDrag,
  stepKeys,
  stepRuler,
  wheelFactor,
} from './rollZoomGestures';
import { zoomTimeAbout } from './rollZoomModel';
import type { RulerDragEvent } from './songZoomModel';

/** What the gestures read and zoom. */
export interface ZoomInputHost {
  readonly panes: RollPanes;
  readonly zoom: RollZoomControl;
}

/** One drag: its start from a press (null refuses the press), and one event of it (null once it ended). */
interface Stepper<Drag> {
  begin(down: PointerEvent): Drag | null;
  step(drag: Drag, event: RulerDragEvent): Drag | null;
}

/** A pointer's place in the notes pane, px from its left and top edges. */
const paneX = (body: HTMLElement, clientX: number): number =>
  clientX - body.getBoundingClientRect().left;

const pressOf = (body: HTMLElement, e: PointerEvent): ZoomPress => {
  const box = body.getBoundingClientRect();
  const { pointerId, clientX, clientY } = e;
  return { pointerId, clientX, clientY, at: { x: clientX - box.left, y: clientY - box.top } };
};

/** Whether a mouse event landed inside `node`, by position: a drag's capture retargets the clicks. */
const lands = (node: Element | null, e: MouseEvent): boolean => {
  const box = node?.getBoundingClientRect();
  if (!box) return false;
  const { clientX: x, clientY: y } = e;
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
};

/** Run `stepper`'s drags on `node`, one at a time, with the pointer captured. */
function wireDrag<Drag extends { readonly pointerId: number }>(
  node: HTMLElement,
  stepper: Stepper<Drag>,
): void {
  let drag: Drag | null = null;
  const onBlur = (): void => run({ type: 'blur' });
  const run = (event: RulerDragEvent): void => {
    const was = drag;
    if (!was) return;
    drag = stepper.step(was, event);
    if (drag) return;
    window.removeEventListener('blur', onBlur);
    if (node.hasPointerCapture(was.pointerId)) node.releasePointerCapture(was.pointerId);
  };
  node.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    const next = stepper.begin(down);
    if (!next) return;
    down.preventDefault();
    if (drag) run({ type: 'cancel', pointerId: drag.pointerId });
    drag = next;
    try {
      node.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track: the drag still runs on the pane's own events.
    }
    window.addEventListener('blur', onBlur);
  });
  node.addEventListener('pointermove', (e) => {
    const { pointerId, buttons, clientX, clientY } = e;
    run({ type: 'move', pointerId, buttons, clientX, clientY });
  });
  node.addEventListener('pointerup', (e) => run({ type: 'up', pointerId: e.pointerId }));
  node.addEventListener('pointercancel', (e) => run({ type: 'cancel', pointerId: e.pointerId }));
  node.addEventListener('lostpointercapture', (e) => run({ type: 'lost', pointerId: e.pointerId }));
}

/** The ruler: a drag zooms and scrolls time; a double-click switches loop and region. */
function wireRuler({ panes, zoom }: ZoomInputHost): void {
  const { head, body } = panes;
  head.title = ROLL_ZOOM_TEXT.ruler;
  wireDrag(head, {
    begin: (down) => {
      const on = down.target instanceof Element ? down.target : null;
      if (!on?.closest('.roll-ruler') || on.closest('.roll-brace-end')) return null;
      const view = zoom.timeView();
      const bounds = zoom.timeBounds();
      return view && bounds.widthPx > 0 ? rulerDrag(pressOf(body, down), view, bounds) : null;
    },
    step: (drag, event) => {
      const next = stepRuler(drag, event);
      if (next.view && event.type === 'move') {
        zoom.setTime(next.view, { x: paneX(body, event.clientX) });
      }
      return next.drag;
    },
  });
  head.addEventListener('dblclick', (e) => {
    const brace = head.querySelector('.roll-brace-end');
    if (!lands(head.querySelector('.roll-ruler'), e) || lands(brace, e)) return;
    zoom.show(zoom.fits().loop ? 'region' : 'loop');
  });
}

/** The keys: a drag sideways sets the row height, along them scrolls the rows. */
function wireKeys({ panes, zoom }: ZoomInputHost): void {
  panes.keys.title = ROLL_ZOOM_TEXT.keys;
  wireDrag(panes.keys, {
    begin: (down) => {
      const view = zoom.rowView();
      const drawn = zoom.rowsDrawn();
      return view && drawn ? keysDrag(pressOf(panes.body, down), view, drawn) : null;
    },
    step: (drag, event) => {
      const next = stepKeys(drag, event);
      if (next.view) zoom.setRows(next.view);
      return next.drag;
    },
  });
}

/** Ctrl or ⌘ with the wheel over the notes, the ruler or the lane: time zooms around the pointer. */
function wireWheel({ panes, zoom }: ZoomInputHost): void {
  const over = '.roll-body, .roll-head, .roll-vel, .renv-layer';
  panes.root.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const view = zoom.timeView();
      const bounds = zoom.timeBounds();
      const on = e.target instanceof Element && e.target.closest(over) !== null;
      if (!on || !view || !(bounds.widthPx > 0)) return;
      const x = Math.min(bounds.widthPx, Math.max(0, paneX(panes.body, e.clientX)));
      zoom.setTime(zoomTimeAbout(view, bounds, { factor: wheelFactor(e), x }), { x });
    },
    { passive: false },
  );
}

/** Wire the ruler's, the keys' and the wheel's zoom on one card's panes. */
export function rollZoomInput(host: ZoomInputHost): void {
  wireRuler(host);
  wireKeys(host);
  wireWheel(host);
}
