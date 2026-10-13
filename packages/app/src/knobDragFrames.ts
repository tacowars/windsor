/**
 * A knob drag's commits, at most one per animation frame (windsor#795): a
 * pointer reports 120 to 240 moves a second, and each commit renormalises
 * the document and posts a patch to the engine, so a move only records the
 * value it reached and the frame commits the last one. The drag's release,
 * however the gesture closes, commits what is still waiting at once, inside
 * the gesture's undo step (`flush` is its `onClose`). Pure over its frame
 * source, so `knob.test.ts` drives it with its own.
 */
import type { FrameSource } from './stepStrip';

/** The browser's frame request. */
const ANIMATION_FRAME: FrameSource = (run) => void requestAnimationFrame(run);

export interface DragFrames {
  /** A move's value: committed at the next frame, unless a later move's replaces it first. */
  push(value: number): void;
  /** Commit the value waiting now, if any: the release's. */
  flush(): void;
}

/** Coalesce `commit` to one call a frame of `frame`, the last value winning. */
export function dragFrames(
  commit: (value: number) => void,
  frame: FrameSource = ANIMATION_FRAME,
): DragFrames {
  let waiting = false;
  let value = 0;
  let requested = false;
  const flush = (): void => {
    if (!waiting) return;
    waiting = false;
    commit(value);
  };
  return {
    push: (next) => {
      value = next;
      waiting = true;
      if (requested) return;
      requested = true;
      frame(() => {
        requested = false;
        flush();
      });
    },
    flush,
  };
}
