/**
 * The Roll recorder wired to the console (windsor#663): its host over the
 * context, the live system's clock and the gestures; the keyboard's tap;
 * the selection, which ends a take when it moves; the context's
 * `onBeforeEdit`, which ends it before any other edit; and a timer that
 * reads the playhead while no Roll device is on screen (the Parts tab's
 * keys play while the Song tab is hidden). The Roll devices reach the one
 * recorder through `rollRecorder()`.
 *
 * The stamp (record `2026-10-09-roll-recording` decision 3): an input
 * event's `timeStamp` mapped to the context time heard then
 * (`heardContextTime`), and that to the transport tick the scheduler
 * stamped there (`audibleTick`).
 */
import type { AudioSystem } from '@windsor/engine';
import type { AppContext } from './appContext';
import { settleGestures } from './gestureHooks';
import type { Keyboard } from './keyboard';
import { type RecorderHost, RollRecorder } from './rollRecorder';
import { ROLL_REC } from './rollTables';
import { heardContextTime } from './rollTakeStamp';

let current: RollRecorder | null = null;

/** The console's recorder, once mounted. */
export const rollRecorder = (): RollRecorder | null => current;

/** The context time heard at performance time `timeStamp` on `system`'s context. */
function heardAt(system: AudioSystem, timeStamp: number): number {
  const context = system.engine.context;
  return heardContextTime(timeStamp, {
    output: context.getOutputTimestamp?.(),
    outputLatency: context.outputLatency,
    currentTime: context.currentTime,
    performanceNow: performance.now(),
  });
}

/** The recorder's host over the console. */
function consoleHost(ctx: AppContext): RecorderHost {
  const system = (): AudioSystem | null => ctx.host.system;
  return {
    doc: () => ctx.model.doc,
    selected: () => ctx.parts.selected,
    livePart: () => ctx.livePart(),
    running: () => ctx.transport.running,
    position: () => ctx.transport.position(),
    now: () => {
      const live = system();
      if (!live) return null;
      const time = heardAt(live, performance.now());
      return { tick: live.scheduler.audibleTick(time), time };
    },
    stamp: (timeStamp) => {
      const live = system();
      if (!live) return null;
      return live.scheduler.audibleTick(heardAt(live, timeStamp ?? performance.now()));
    },
    secondsPerTick: () => system()?.scheduler.transport.secondsPerTick ?? 0,
    settle: () => {
      settleGestures();
      return !ctx.gestureOpen;
    },
    write: (partial) => {
      const result = ctx.recordTake(partial, ROLL_REC.undo);
      if (result?.ok) ctx.invalidate();
      return result?.ok === true;
    },
    closeStep: () => ctx.closeTake(),
  };
}

/** Build the console's recorder and wire it: the keyboard's tap, the selection, every edit, the timer. */
export function mountRollRecorder(ctx: AppContext, keyboard: Keyboard): RollRecorder {
  const recorder = new RollRecorder(consoleHost(ctx));
  current = recorder;
  keyboard.tap = recorder;
  ctx.parts.onSelect(() => recorder.sync());
  ctx.onBeforeEdit(() => recorder.close());
  setInterval(() => recorder.sync(), ROLL_REC.pollMs);
  return recorder;
}
