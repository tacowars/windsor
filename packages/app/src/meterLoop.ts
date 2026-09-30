/**
 * The meters' paint loop (windsor#193 decision 4; record
 * `2026-09-30-master-column-and-meters`, decision 10): it paints only while
 * someone can see a meter, and schedules nothing otherwise.
 *
 * It runs while all three hold: the owning tab is shown, the document is
 * visible, and at least one registered part's root intersects the viewport.
 * The moment one stops holding it cancels its frame request, and tells each
 * part to reset its shown level, so a resumed meter rises from the floor
 * rather than falling from a stale level. That is the difference from
 * `watchPlayhead`, whose frame is queued even while its panel is hidden.
 * While it runs it paints only when the stage's report `revision` moved
 * (`meterRevision`), so the meters draw at the report rate whatever the
 * display's.
 *
 * It ends for good once its root, having been in the document, is not: on
 * the next frame or gate event it drops every subscription.
 *
 * Every source is injected, so `meterLoop.test.ts` drives it with a fake
 * frame clock, visibility and observer; `browserMeterEnvironment` is the
 * page's.
 */

/** One frame at a time: a request handle, and its cancel. */
export interface FrameClock {
  request(run: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

/** The document's visibility, and a subscription to its changes. */
export interface PageVisibility {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}

/** What an intersection report carries that the loop reads. */
export interface ViewportEntry<T> {
  readonly target: T;
  readonly isIntersecting: boolean;
}
export interface ViewportObserver<T> {
  observe(target: T): void;
  unobserve(target: T): void;
  disconnect(): void;
}
export type ObserveViewport<T> = (
  report: (entries: readonly ViewportEntry<T>[]) => void,
) => ViewportObserver<T>;

/** The page's sources, as the loop reads them. */
export interface MeterEnvironment<T> {
  frames: FrameClock;
  visibility: PageVisibility;
  observeViewport: ObserveViewport<T>;
}

/** One thing the loop paints: a bar, a scale's dot, a bridge. */
export interface MeterPart<T> {
  /** Watched for intersection with the viewport. */
  readonly root: T;
  /** Draw the latest report; `nowMs` is the frame's timestamp. */
  paint(nowMs: number): void;
  /** The loop stopped: go back to the floor. */
  reset(): void;
}

export interface MeterLoopDeps<T> extends MeterEnvironment<T> {
  /** The loop's own root; once it has been attached and is not, the loop ends. */
  root: { readonly isConnected: boolean };
  /** The owning tab's shown state, now and on each change (`AppContext.onTabShown`). */
  onTabShown(listener: (shown: boolean) => void): () => void;
  /** The stage's report revision (`meterRevision`). */
  revision(): number;
}

export interface MeterLoop<T> {
  /** Register a part; the returned call removes it. */
  add(part: MeterPart<T>): () => void;
  /** Whether a frame is scheduled. */
  readonly running: boolean;
  /** Whether the loop has ended for good. */
  readonly ended: boolean;
  /** End now: cancel the frame and drop every subscription. */
  end(): void;
}

/** The three gates: the tab shown, the page visible, a watched root in view. */
interface MeterGates<T> {
  open(): boolean;
  watch(root: T): void;
  unwatch(root: T): void;
  close(): void;
}

/**
 * Follows the three gates and calls `changed` when any may have moved. It
 * stays quiet while it subscribes (the tab's listener hears its state at
 * once), so the loop reads the gates itself once they stand.
 */
function meterGates<T>(deps: MeterLoopDeps<T>, changed: () => void): MeterGates<T> {
  const inView = new Set<T>();
  let tabShown = false;
  let ready = false;
  const observer = deps.observeViewport((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target);
      else inView.delete(entry.target);
    }
    changed();
  });
  const stopVisibility = deps.visibility.subscribe(changed);
  const stopTab = deps.onTabShown((shown) => {
    tabShown = shown;
    if (ready) changed();
  });
  ready = true;
  return {
    open: () => tabShown && !deps.visibility.hidden() && inView.size > 0,
    watch: (root) => observer.observe(root),
    unwatch: (root) => {
      observer.unobserve(root);
      inView.delete(root);
    },
    close: () => {
      observer.disconnect();
      stopVisibility();
      stopTab();
      inView.clear();
    },
  };
}

/** True once `root` has been in the document and is not: a root not yet mounted is waited for. */
function detachWatch(root: { readonly isConnected: boolean }): () => boolean {
  let attachedOnce = false;
  return () => {
    if (root.isConnected) attachedOnce = true;
    return attachedOnce && !root.isConnected;
  };
}

export function createMeterLoop<T>(deps: MeterLoopDeps<T>): MeterLoop<T> {
  const parts = new Set<MeterPart<T>>();
  const detached = detachWatch(deps.root);
  let ended = false;
  let handle: number | null = null;
  let lastRevision: number | null = null;

  const resetParts = (): void => parts.forEach((part) => part.reset());
  const stop = (): void => {
    if (handle === null) return;
    deps.frames.cancel(handle);
    handle = null;
    resetParts();
  };
  const tick = (nowMs: number): void => {
    handle = null;
    if (ended) return;
    if (detached()) return end();
    if (!gates.open()) return resetParts();
    handle = deps.frames.request(tick);
    const revision = deps.revision();
    if (revision === lastRevision) return;
    lastRevision = revision;
    for (const part of parts) part.paint(nowMs);
  };
  const update = (): void => {
    if (ended) return;
    if (detached()) return end();
    if (!gates.open()) return stop();
    handle ??= deps.frames.request(tick);
  };
  const gates = meterGates(deps, update);
  function end(): void {
    if (ended) return;
    stop();
    ended = true;
    gates.close();
    parts.clear();
  }
  update();

  return {
    add(part) {
      if (ended) return () => undefined;
      parts.add(part);
      gates.watch(part.root);
      return () => {
        if (!parts.delete(part)) return;
        gates.unwatch(part.root);
        update();
      };
    },
    get running() {
      return handle !== null;
    },
    get ended() {
      return ended;
    },
    end,
  };
}

/** The page's frame clock, visibility and intersection observer. */
export function browserMeterEnvironment(): MeterEnvironment<Element> {
  return {
    frames: {
      request: (run) => requestAnimationFrame(run),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
    visibility: {
      hidden: () => document.hidden,
      subscribe: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
    },
    observeViewport: (report) => new IntersectionObserver((entries) => report(entries)),
  };
}
