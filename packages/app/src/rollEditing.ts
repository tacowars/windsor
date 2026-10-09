/**
 * The Roll device's editing (windsor#603), wired to one device: its editor
 * (`rollEditor.ts`), the gestures on its notes (`rollNoteGestures.ts`), its
 * velocity lane and loop brace (`rollLaneGestures.ts`), the Loop stepper,
 * Quantise (`rollQuantise.ts`, windsor#661) and Audition on its part
 * (`rollAudition.ts`). The device draws; this hands each gesture the frame
 * it edits in.
 */
import type { AppCtx } from './context';
import { withGesture } from './gestureHooks';
import { auditionNote } from './rollAudition';
import { type RollFrame, loopStops, stepLoop } from './rollEdits';
import { RollEditor } from './rollEditor';
import { rollLaneGestures } from './rollLaneGestures';
import { rollNoteGestures } from './rollNoteGestures';
import type { RollPanes } from './rollPanes';
import { quantiseNotes } from './rollQuantise';
import type { RollScene } from './rollScene';
import type { RollSource } from './rollSource';
import { ROLL_QUANTISE } from './rollTables';
import { type RollViewState, snapOf } from './rollView';

/** What the device hands its editing. */
export interface RollEditingHost {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  readonly body: HTMLElement;
  readonly panes: RollPanes;
  readonly view: RollViewState;
  /** The last paint's scene, its notes the edit in progress. */
  scene(): RollScene | null;
  /** What the roll was last drawn from, the edit in progress over it. */
  source(): RollSource;
  /** Redraw the notes on the rows already drawn. */
  previewNotes(): void;
  /** Redraw the whole roll. */
  repaint(): void;
}

/** The device's editor, the Loop stepper's step and Quantise's press. */
export interface RollEditing {
  readonly editor: RollEditor;
  stepLoop(dir: number): void;
  /** Quantise the selection, or every note, to the Snap: one undo step, none when nothing moves. */
  quantise(): void;
}

/** Where an edit happens: the loop as drawn, the region and the snap. */
export function rollFrame(source: RollSource, view: RollViewState): RollFrame {
  const { loopTicks, regionTicks } = source;
  return {
    loop: Math.min(loopTicks, regionTicks),
    region: regionTicks,
    snap: snapOf(view.snap).ticks,
  };
}

/** Wire the editing of one device. */
export function rollEditing(host: RollEditingHost): RollEditing {
  const { ctx, slot, panes, view } = host;
  const editor = new RollEditor({
    ctx,
    slot,
    region: host.region,
    body: host.body,
    previewNotes: () => host.previewNotes(),
    repaint: () => host.repaint(),
  });
  const scene = (): RollScene | null => host.scene();
  const frame = (): RollFrame => rollFrame(host.source(), view);
  const stops = (): number[] => loopStops(host.source().regionTicks, host.source().barTicks);
  rollNoteGestures({
    panes,
    editor,
    view,
    scene,
    frame,
    audition: (pitch, velocity) => auditionNote(ctx, slot, pitch, velocity),
  });
  rollLaneGestures({ panes, editor, scene, frame, loopStops: stops });
  return {
    editor,
    stepLoop: (dir) => {
      const config = stepLoop(editor.current(), dir, { loop: frame().loop, stops: stops() });
      if (config) editor.commit({ config, selected: editor.selected() });
    },
    quantise: () => {
      const edit = quantiseNotes(editor.current(), editor.selected(), frame());
      if (edit) withGesture(ROLL_QUANTISE.undo, () => editor.commit(edit));
    },
  };
}
