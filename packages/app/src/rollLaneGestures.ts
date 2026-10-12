/**
 * The Roll's gestures outside the notes (windsor#603 decisions 2 and 3): a
 * stem in the Vel lane sets its note's velocity, or the whole selection's
 * when it is selected; the loop brace's end on the ruler sets the loop in
 * whole bars. Each previews while it moves and writes once, on release,
 * through the editor (`rollEditor.ts`).
 *
 * On the Acc and Rat lanes (windsor#754; record
 * `2026-10-12-roll-note-accent-and-ratchet` decisions 6 and 7) a click on a
 * note's cell toggles its accent or steps its ratchet (Shift steps back),
 * for the whole selection when the note is selected (`markClick`): one
 * write through the editor, one undo step.
 */
import type { RollSequencerConfig } from '@windsor/engine';
import { withGesture } from './gestureHooks';
import { pointerDrag } from './pointerDrag';
import { type RollFrame, nearestLoop, setLoop, setVelocity } from './rollEdits';
import type { RollEditor } from './rollEditor';
import { laneVelocity, stemAt } from './rollHit';
import { type RollLane, markClick } from './rollMarks';
import type { RollPanes } from './rollPanes';
import type { RollScene } from './rollScene';
import { ROLL_MARK_TEXT, ROLL_PANE_PX } from './rollTables';

/** What the lane and the brace read and drive. */
export interface LaneGestureTarget {
  readonly panes: RollPanes;
  readonly editor: RollEditor;
  scene(): RollScene | null;
  frame(): RollFrame;
  /** The loops the region allows (`loopStops`). */
  loopStops(): readonly number[];
  /** What the lane under the notes shows. */
  lane(): RollLane;
}

/** A stem drag: the notes it sets, from the roll it started on. */
interface StemDrag {
  readonly pointerId: number;
  readonly origin: RollSequencerConfig;
  readonly indices: readonly number[];
  readonly selected: readonly number[];
}

/** Drag a stem: the press takes the nearest stem top in reach and sets it at once. */
function wireStems(target: LaneGestureTarget): void {
  const { vel, velIn } = target.panes;
  const { editor } = target;
  let drag: StemDrag | null = null;
  const set = (e: PointerEvent): void => {
    if (!drag) return;
    const y = e.clientY - velIn.getBoundingClientRect().top;
    const config = setVelocity(drag.origin, drag.indices, laneVelocity(y, ROLL_PANE_PX.vel));
    editor.preview({ config, selected: drag.selected });
  };
  const finish = (e: PointerEvent, write: boolean): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { pointerId } = drag;
    drag = null;
    if (vel.hasPointerCapture(pointerId)) vel.releasePointerCapture(pointerId);
    const draft = editor.drafting();
    if (write && draft) editor.commit({ config: draft, selected: editor.selected() });
    else editor.cancel();
  };
  vel.addEventListener('pointerdown', (e) => {
    const scene = target.scene();
    if (e.button !== 0 || !scene || drag || target.lane() !== 'vel') return;
    const box = velIn.getBoundingClientRect();
    const origin = editor.current();
    const lane = {
      pxPerTick: scene.pxPerTick,
      loop: target.frame().loop,
      lanePx: ROLL_PANE_PX.vel,
    };
    const hit = stemAt(origin.notes, { x: e.clientX - box.left, y: e.clientY - box.top }, lane);
    if (hit === null) return;
    const selected = editor.selected();
    const indices = selected.includes(hit) ? selected : [hit];
    drag = { pointerId: e.pointerId, origin, indices, selected };
    try {
      vel.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser does not track: the drag runs on the lane's own events.
    }
    set(e);
  });
  vel.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.pointerId) set(e);
  });
  vel.addEventListener('pointerup', (e) => finish(e, true));
  vel.addEventListener('pointercancel', (e) => finish(e, false));
  vel.addEventListener('lostpointercapture', (e) => finish(e, false));
}

/** A click on an Acc or Rat cell: one write of the clicked note's next state. */
function wireCells(target: LaneGestureTarget): void {
  const { vel } = target.panes;
  const { editor } = target;
  vel.addEventListener('click', (e) => {
    const lane = target.lane();
    if (lane === 'vel' || editor.drafting()) return;
    const cell = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-index]') : null;
    if (!cell || !vel.contains(cell)) return;
    const index = Number(cell.dataset.index);
    const edit = markClick(editor.current(), editor.selected(), { lane, index, back: e.shiftKey });
    if (!edit) return;
    const undo = lane === 'acc' ? ROLL_MARK_TEXT.undoAccent : ROLL_MARK_TEXT.undoRatchet;
    withGesture(undo, () => editor.commit(edit));
  });
}

/** Drag the brace's end: the loop follows to the nearest whole bar, from one bar to the region. */
function wireBrace(target: LaneGestureTarget): void {
  const { head, headIn } = target.panes;
  const { editor } = target;
  let origin: RollSequencerConfig | null = null;
  pointerDrag(head, {
    accept: (e) => {
      const onEnd = e.target instanceof Element && e.target.closest('.roll-brace-end') !== null;
      origin = onEnd ? editor.current() : null;
      return onEnd;
    },
    move: (e) => {
      const scene = target.scene();
      if (!origin || !scene) return;
      const ticks = (e.clientX - headIn.getBoundingClientRect().left) / scene.pxPerTick;
      const loop = nearestLoop(ticks, target.loopStops());
      if (loop !== target.frame().loop) editor.previewLoop(setLoop(origin, loop));
    },
    end: (_e, moved) => {
      const draft = editor.drafting();
      if (moved && draft) editor.commit({ config: draft, selected: editor.selected() });
      else editor.cancel();
    },
    abort: () => editor.cancel(),
  });
}

/** Wire the lane under the notes and the loop brace. */
export function rollLaneGestures(target: LaneGestureTarget): void {
  wireStems(target);
  wireCells(target);
  wireBrace(target);
}
