/**
 * A console for the gesture tests (windsor#130): a real `AppContext` — so the
 * gesture hook is set, as in the page — over a host that accepts every live
 * partial, one tab, and a stand-in window for the release and blur listeners.
 * Stand-in elements are `EventTarget`s with the pointer-capture calls a
 * control makes, and events are plain `Event`s carrying the fields it reads.
 */
import type { ApplyResult } from '@windsor/engine';
import { AppContext } from '../appContext';
import type { ContextHost, TabPanel } from '../appContext';
import { DocumentModel } from '../documentModel';
import type { EngineHost } from '../host';
import { newSong } from '../songParts';

export function openGestureConsole(raw: unknown = newSong()): AppContext<TabPanel> {
  const host: ContextHost = {
    apply: (): ApplyResult => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(raw),
    notify: () => {},
  });
  ctx.addTab('parts', { hidden: false }, () => {});
  return ctx;
}

/** An element stand-in: listeners, focus's `blur`, and pointer capture. */
export class FakeElement extends EventTarget {
  private readonly captured = new Set<number>();

  setPointerCapture(id: number): void {
    this.captured.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }

  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 160, height: 100 };
  }
}

/** An event of `type` carrying `fields` (a pointer's `clientY`, a key's `key`). */
export function fakeEvent(type: string, fields: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type), { pointerId: 1, button: 0, buttons: 1, ...fields });
}

/** Dispatch `type` on `target` with `fields`; `target` becomes the event's target. */
export function fire(
  target: EventTarget,
  type: string,
  fields: Record<string, unknown> = {},
): void {
  target.dispatchEvent(fakeEvent(type, fields));
}
