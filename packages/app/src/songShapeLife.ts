/**
 * An open Shape selection's window listeners (windsor#350; windsor#708's fix
 * round 2): Escape, and the scroll and resize that place the popover again.
 * They are added when a selection opens and removed when it closes, and a
 * host that owns the tool (a Roll card, `rollPopoverLife.ts`) hears both,
 * so it can close the tool when it leaves the page. The Song tab's lanes
 * pass no hooks: a render of the lanes closes their tool.
 */

/** Where the listeners go: the window in the page, a stand-in in a test. */
export type ListenTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** What an open selection listens with. */
export interface ShapeListeners {
  onKey(e: KeyboardEvent): void;
  place(): void;
}

/** A host's hold on the tool: `close` closes the tool, selection and all. */
export interface ShapeLifeHooks {
  hold(close: () => void): void;
  release(close: () => void): void;
}

/** One tool's open selection, as far as its listeners go. */
export interface ShapeLife {
  /** A selection opened; `close` is the tool's, for the host to call. */
  open(close: () => void): void;
  /** The selection closed: its listeners removed and the host's hold released. */
  close(): void;
  isOpen(): boolean;
}

/** The listeners of one Shape tool's selection on `target`, held by `hooks` while open. */
export function shapeLife(
  target: ListenTarget,
  listeners: ShapeListeners,
  hooks?: ShapeLifeHooks,
): ShapeLife {
  const onKey = (e: Event): void => listeners.onKey(e as KeyboardEvent);
  const place = (): void => listeners.place();
  let held: (() => void) | null = null;
  return {
    open(close) {
      if (held) return;
      held = close;
      target.addEventListener('keydown', onKey, true);
      target.addEventListener('scroll', place, { capture: true, passive: true });
      target.addEventListener('resize', place);
      hooks?.hold(close);
    },
    close() {
      const close = held;
      if (!close) return;
      held = null;
      target.removeEventListener('keydown', onKey, true);
      target.removeEventListener('scroll', place, true);
      target.removeEventListener('resize', place);
      hooks?.release(close);
    },
    isOpen: () => held !== null,
  };
}
