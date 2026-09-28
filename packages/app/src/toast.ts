/**
 * The console's toasts: short notices in a stack at the bottom right, in
 * place of the header's old status line. `notify(message, tone)` is the one
 * entry point. `AppCtx.notify` is this function, and code with no context
 * (the envelope drag) calls it directly. Before `mountToasts`, and in a
 * DOM-free test, it does nothing: a notice must never break the edit it
 * reports.
 *
 * The rules (order, repeats, the cap, durations) are `toastModel.ts`. This
 * file draws the stack and runs the timers. Pointing at the stack or focusing
 * inside it pauses every timer, so a notice can be read and its × reached.
 * An error stays until dismissed.
 */
import { el } from './dom';
import type { Toast, ToastStack, ToastTone } from './toastModel';
import { addToast, emptyStack, removeToast, toastDuration } from './toastModel';

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  started: number;
}

let host: HTMLElement | null = null;
let stack: ToastStack = emptyStack();
const nodes = new Map<number, HTMLElement>();
const timers = new Map<number, Timer>();
let paused = false;

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  nodes.get(id)?.remove();
  nodes.delete(id);
  stack = removeToast(stack, id);
  // An empty stack has no area left to leave, so no pointerleave will come.
  if (stack.toasts.length === 0) paused = false;
}

function run(id: number, timer: Timer): void {
  timer.started = Date.now();
  timer.handle = setTimeout(() => dismiss(id), timer.remaining);
}

/** (Re)start a toast's full time; an error has none and waits for the ×. */
function startTimer(toast: Toast): void {
  const old = timers.get(toast.id);
  if (old?.handle) clearTimeout(old.handle);
  const duration = toastDuration(toast.tone);
  if (duration === null) return;
  const timer: Timer = { handle: null, remaining: duration, started: 0 };
  timers.set(toast.id, timer);
  if (!paused) run(toast.id, timer);
}

function pause(): void {
  if (paused) return;
  paused = true;
  for (const timer of timers.values()) {
    if (timer.handle) clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started));
  }
}

function resume(): void {
  if (!paused || host?.matches(':hover') || host?.contains(document.activeElement)) return;
  paused = false;
  for (const [id, timer] of timers) run(id, timer);
}

function messageText(toast: Toast): string {
  return toast.count > 1 ? `${toast.message} ×${toast.count}` : toast.message;
}

function build(toast: Toast): HTMLElement {
  const node = el('div', `toast toast-${toast.tone}`);
  // An error interrupts; the rest wait their turn in the stack's polite region.
  node.setAttribute('role', toast.tone === 'error' ? 'alert' : 'status');
  const text = el('p', 'toast-text', messageText(toast));
  const close = el('button', 'toast-close', '×') as HTMLButtonElement;
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.onclick = (): void => {
    dismiss(toast.id);
    resume();
  };
  node.onkeydown = (event): void => {
    if (event.key === 'Escape') close.click();
  };
  node.append(text, close);
  return node;
}

/** Show a notice. A no-op until `mountToasts` has run. */
export function notify(message: string, tone: ToastTone = 'info'): void {
  if (!host) return;
  const added = addToast(stack, message, tone);
  stack = added.stack;
  for (const gone of added.dropped) dismiss(gone.id);
  const { toast } = added;
  const existing = nodes.get(toast.id);
  if (existing) {
    const text = existing.querySelector('.toast-text');
    if (text) text.textContent = messageText(toast);
  }
  const node = existing ?? build(toast);
  nodes.set(toast.id, node);
  host.appendChild(node);
  startTimer(toast);
}

/** Take over the page's toast region; call once, from `main.ts`. */
export function mountToasts(region: HTMLElement): void {
  host = region;
  region.addEventListener('pointerenter', pause);
  region.addEventListener('pointerleave', resume);
  region.addEventListener('focusin', pause);
  region.addEventListener('focusout', () => queueMicrotask(resume));
}
