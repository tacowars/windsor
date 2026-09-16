/**
 * Dragging an envelope curve from one display onto another (#588).
 *
 * The curve is the handle: press on any of the six envelope canvases, move a
 * few pixels and the pointer carries a ghost of that shape; release it over
 * another display and that slot takes the shape, or — with Shift held at
 * release — the two swap. Pointer events with capture, the pattern `knob.ts`
 * and `harmonicEditor.ts` use, because HTML5 drag-and-drop never starts from a
 * canvas on touch.
 *
 * The state machine is the whole behaviour and knows no DOM: it is handed
 * `slotAt`, `paint` and `apply` and is tested through fakes. The second half
 * of the file is the browser wiring that supplies those three.
 */
import { el } from './dom';
import { drawEnv } from './envCanvas';
import {
  type EnvelopeSlot,
  copyEnvelope,
  isEnvelopeSlot,
  readEnvelope,
  slotLabel,
  swapEnvelopes,
  transferMessage,
} from './envelopeTransfer';
import { hooks, partsState, pushPatch } from './patchState';

export type TransferKind = 'copy' | 'swap';

/** What the view needs to draw one frame of a drag; `null` means "drag over". */
export interface DragPaint {
  readonly from: EnvelopeSlot;
  readonly kind: TransferKind;
  readonly over: EnvelopeSlot | null;
  readonly x: number;
  readonly y: number;
}

export interface EnvelopeDragHost {
  /** The slot whose canvas is under this client point, if any. */
  slotAt(x: number, y: number): EnvelopeSlot | null;
  paint(state: DragPaint | null): void;
  apply(kind: TransferKind, from: EnvelopeSlot, to: EnvelopeSlot): void;
}

export interface EnvelopeDragController {
  readonly dragging: boolean;
  down(from: EnvelopeSlot, x: number, y: number): void;
  move(x: number, y: number, shift: boolean): void;
  /** Shift pressed or released without the pointer moving. */
  shift(held: boolean): void;
  up(x: number, y: number, shift: boolean): void;
  cancel(): void;
}

/** Pixels the pointer must travel before a press becomes a drag, so a click stays inert. */
export const ENVELOPE_DRAG_THRESHOLD_PX = 4;

export function createEnvelopeDrag(
  host: EnvelopeDragHost,
  thresholdPx: number = ENVELOPE_DRAG_THRESHOLD_PX,
): EnvelopeDragController {
  let from: EnvelopeSlot | null = null;
  let dragging = false;
  let kind: TransferKind = 'copy';
  let start = { x: 0, y: 0 };
  let at = { x: 0, y: 0 };

  const repaint = (): void => {
    if (!from || !dragging) return;
    host.paint({ from, kind, over: host.slotAt(at.x, at.y), x: at.x, y: at.y });
  };
  const reset = (): void => {
    const wasDragging = dragging;
    from = null;
    dragging = false;
    if (wasDragging) host.paint(null);
  };

  return {
    get dragging(): boolean {
      return dragging;
    },
    down(slot, x, y) {
      from = slot;
      dragging = false;
      start = { x, y };
      at = { x, y };
    },
    move(x, y, held) {
      if (!from) return;
      at = { x, y };
      if (!dragging && Math.hypot(x - start.x, y - start.y) < thresholdPx) return;
      dragging = true;
      kind = held ? 'swap' : 'copy';
      repaint();
    },
    shift(held) {
      if (!dragging) return;
      kind = held ? 'swap' : 'copy';
      repaint();
    },
    // Shift is read here, at release, not at the press: the user picks the
    // operation after seeing which display the curve is over.
    up(x, y, held) {
      const source = from;
      const wasDragging = dragging;
      at = { x, y };
      reset();
      if (!source || !wasDragging) return;
      const to = host.slotAt(x, y);
      if (!to || to === source) return;
      host.apply(held ? 'swap' : 'copy', source, to);
    },
    cancel() {
      reset();
    },
  };
}

/* ---------------------------------------------------------------- the DOM */

const GHOST = { offsetX: 16, offsetY: 12 };
const SWAP_GLYPH = '&#8646;';

let ghostRoot: HTMLElement | null = null;
let ghostFrom: HTMLCanvasElement | null = null;
let ghostTo: HTMLCanvasElement | null = null;
let ghostGlyph: HTMLElement | null = null;

const canvasFor = (slot: EnvelopeSlot): HTMLCanvasElement | null =>
  document.querySelector<HTMLCanvasElement>(`canvas.env-canvas[data-env-slot="${slot}"]`);

/** A slot's bay colour, recorded on its canvas when the drag was attached. */
const slotColor = (slot: EnvelopeSlot): string | undefined => canvasFor(slot)?.dataset.envColor;

function drawSlotInto(canvas: HTMLCanvasElement | null, slot: EnvelopeSlot): void {
  const env = readEnvelope(partsState.patch, slot);
  const color = slotColor(slot);
  if (canvas && env && color) drawEnv(canvas, env, color);
}

function ensureGhost(): HTMLElement {
  if (ghostRoot) return ghostRoot;
  const root = el('div', 'env-ghost');
  ghostFrom = el('canvas', 'env-ghost-curve') as HTMLCanvasElement;
  ghostGlyph = el('span', 'env-ghost-glyph', SWAP_GLYPH);
  ghostTo = el('canvas', 'env-ghost-curve') as HTMLCanvasElement;
  root.append(ghostFrom, ghostGlyph, ghostTo);
  document.body.appendChild(root);
  ghostRoot = root;
  return root;
}

/**
 * The ghost carries the source curve; over a swap target it carries both, so
 * the user can see which of the two operations a release will do.
 */
function paintGhost(state: DragPaint): void {
  const root = ensureGhost();
  root.style.display = 'flex';
  root.style.transform = `translate(${state.x + GHOST.offsetX}px, ${state.y + GHOST.offsetY}px)`;
  drawSlotInto(ghostFrom, state.from);
  const swapping = state.kind === 'swap' && state.over !== null && state.over !== state.from;
  if (ghostGlyph) ghostGlyph.style.display = swapping ? 'inline-block' : 'none';
  if (ghostTo) ghostTo.style.display = swapping ? 'block' : 'none';
  if (swapping && state.over) drawSlotInto(ghostTo, state.over);
}

function showStatus(message: string): void {
  // The console's one status line. It is absent in a DOM-free test, and a
  // missing status line must never swallow an edit that already landed.
  const line = typeof document === 'undefined' ? null : document.getElementById('status');
  if (line) line.textContent = message;
}

/**
 * The drop itself: the model's copy or swap, one `pushPatch()` into the
 * document and the live part, then the whole patch UI so the target's knobs,
 * loop-mode picker and curve all show the new shape.
 */
export function applyEnvelopeTransfer(
  kind: TransferKind,
  from: EnvelopeSlot,
  to: EnvelopeSlot,
): boolean {
  const changed =
    kind === 'swap'
      ? swapEnvelopes(partsState.patch, from, to)
      : copyEnvelope(partsState.patch, from, to);
  if (!changed) return false;
  pushPatch();
  hooks.refresh();
  showStatus(transferMessage(kind, from, to));
  return true;
}

const domHost: EnvelopeDragHost = {
  slotAt(x, y) {
    const under = document.elementFromPoint(x, y);
    const canvas = under?.closest('canvas.env-canvas');
    const slot = canvas instanceof HTMLElement ? canvas.dataset.envSlot : null;
    return isEnvelopeSlot(slot) ? slot : null;
  },
  paint(state) {
    document.querySelectorAll('.drop-target, .swap-target').forEach((node) => {
      node.classList.remove('drop-target', 'swap-target');
    });
    document.body.classList.toggle('env-dragging', state !== null);
    if (!state) {
      if (ghostRoot) ghostRoot.style.display = 'none';
      return;
    }
    if (state.over && state.over !== state.from) {
      canvasFor(state.over)?.classList.add(state.kind === 'swap' ? 'swap-target' : 'drop-target');
    }
    paintGhost(state);
  },
  apply: applyEnvelopeTransfer,
};

const controller = createEnvelopeDrag(domHost);
let keysBound = false;

function bindKeys(): void {
  if (keysBound) return;
  keysBound = true;
  window.addEventListener('keydown', (e) => {
    if (!controller.dragging) return;
    if (e.key === 'Escape') {
      controller.cancel();
      e.preventDefault();
    } else if (e.key === 'Shift') controller.shift(true);
  });
  window.addEventListener('keyup', (e) => {
    if (controller.dragging && e.key === 'Shift') controller.shift(false);
  });
}

/**
 * Make one envelope canvas both a drag source and a drop target. Re-attaching
 * to the same canvas — the filter and pitch canvases live in the template and
 * survive every rebuild — refreshes the slot and colour without stacking a
 * second set of listeners on it.
 */
export function attachEnvelopeDrag(
  canvas: HTMLCanvasElement,
  slot: EnvelopeSlot,
  color: string,
): void {
  const alreadyBound = canvas.dataset.envSlot !== undefined;
  canvas.dataset.envSlot = slot;
  canvas.dataset.envColor = color;
  canvas.style.setProperty('--env-color', color);
  canvas.title = `${slotLabel(slot)} envelope - drag onto another display to copy, shift-drag to swap`;
  if (alreadyBound) return;
  bindKeys();

  const release = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    controller.down(slot, e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    // Same guard as the knobs: a release lost with capture must not leave the
    // curve stuck to the pointer.
    if ((e.buttons & 1) === 0) return controller.cancel();
    controller.move(e.clientX, e.clientY, e.shiftKey);
    if (controller.dragging) e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    // The drop first: releasing capture fires `lostpointercapture`, and in
    // some engines it lands before this handler finishes.
    controller.up(e.clientX, e.clientY, e.shiftKey);
    release(e);
  });
  canvas.addEventListener('pointercancel', (e) => {
    controller.cancel();
    release(e);
  });
  canvas.addEventListener('lostpointercapture', () => controller.cancel());
}
