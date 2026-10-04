/**
 * The Roll's gestures on the notes (windsor#603 decision 1), FL style and
 * with no modes. A press on empty space adds a note and the drag that
 * follows moves it; a drag on a note moves the selection and a drag on its
 * right edge resizes it; a press and release on a note without moving
 * deletes it, as a right-click does; Shift adds a note to the selection,
 * and a Shift-drag on empty space box-selects. On touch a tap adds and a
 * one-finger drag on empty space scrolls. A drag near the pane's edge
 * scrolls it.
 *
 * These only translate the pointer into ticks and rows: the edits are
 * `rollEdits.ts`'s, previewed and written by the editor (`rollEditor.ts`).
 */
import { el } from './dom';
import {
  type RollEdit,
  type RollFrame,
  addNote,
  boxSelect,
  deleteNotes,
  moveNotes,
  resizeNotes,
} from './rollEdits';
import type { RollEditor } from './rollEditor';
import { boxPitches, edgeScroll, isTap, onResizeEdge } from './rollHit';
import { velocityOf } from './rollNoteLook';
import type { RollPanes } from './rollPanes';
import { rowIndexAt } from './rollRows';
import type { RollScene } from './rollScene';
import { type RollViewState, addTicksOf } from './rollView';

/** What the gestures read and drive. */
export interface NoteGestureTarget {
  readonly panes: RollPanes;
  readonly editor: RollEditor;
  readonly view: RollViewState;
  scene(): RollScene | null;
  frame(): RollFrame;
  /** Sound a note briefly, when Audition allows. */
  audition(pitch: number, velocity: number): void;
}

/** A press: where it started in the notes' px, where the pointer is now, and whether it became a drag. */
interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  client: { x: number; y: number };
  moved: boolean;
}

/** A drag on notes: from `origin`, last drawn as `edit`; `tap` is the note a release in place deletes. */
interface NoteDrag extends Press {
  readonly kind: 'move' | 'resize';
  readonly origin: RollEdit;
  edit: RollEdit;
  readonly anchor: number;
  readonly tap: number | null;
  readonly added: boolean;
  heard: number;
  lastTicks: number | null;
}

type Drag =
  | NoteDrag
  | (Press & { readonly kind: 'box'; readonly base: readonly number[]; readonly box: HTMLElement })
  | (Press & { readonly kind: 'tap' });

/** The gestures on one device's notes pane. */
class NoteGestures {
  private drag: Drag | null = null;
  private frameId = 0;

  constructor(private readonly target: NoteGestureTarget) {
    const { body } = target.panes;
    body.addEventListener('pointerdown', (e) => this.down(e));
    body.addEventListener('pointermove', (e) => this.moved(e));
    body.addEventListener('pointerup', (e) => this.up(e));
    body.addEventListener('pointercancel', (e) => this.cancel(e));
    body.addEventListener('lostpointercapture', (e) => this.cancel(e));
    body.addEventListener('contextmenu', (e) => this.context(e));
  }

  /** A pointer's place in the notes' px. */
  private local(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.target.panes.canvas.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  }

  /** The drawn note under a press, by its index in the roll; a ghost repeat is empty space. */
  private noteAt(e: Event): { index: number; node: HTMLElement } | null {
    const node = e.target instanceof Element ? e.target.closest<HTMLElement>('.roll-note') : null;
    if (!node || node.classList.contains('ghost')) return null;
    return { index: Number(node.dataset.index), node };
  }

  private press(e: PointerEvent): Press {
    const { x, y } = this.local(e.clientX, e.clientY);
    return { pointerId: e.pointerId, x, y, client: { x: e.clientX, y: e.clientY }, moved: false };
  }

  private capture(pointerId: number): void {
    try {
      this.target.panes.body.setPointerCapture(pointerId);
    } catch {
      // A pointer the browser does not track: the drag runs on the pane's own events.
    }
  }

  private down(e: PointerEvent): void {
    const scene = this.target.scene();
    if (e.button !== 0 || !scene || this.drag) return;
    const hit = this.noteAt(e);
    if (hit) return this.pressNote(e, hit);
    const press = this.press(e);
    if (e.shiftKey) {
      const box = el('div', 'roll-box');
      this.target.panes.canvas.appendChild(box);
      this.drag = { ...press, kind: 'box', base: this.target.editor.selected(), box };
      this.capture(e.pointerId);
    } else if (e.pointerType === 'touch') {
      this.drag = { ...press, kind: 'tap' };
    } else {
      const edit = this.add(press.x, press.y, scene);
      if (!edit) return void this.target.editor.select([]);
      this.target.editor.preview(edit);
      this.drag = this.noteDrag(press, 'move', edit, { anchor: edit.selected[0] ?? 0, tap: null });
      this.drag = { ...this.drag, added: true };
      this.capture(e.pointerId);
    }
    this.watchEdges();
  }

  /** A press on a note: select it (Shift adds), then a move, or a resize on its right edge. */
  private pressNote(e: PointerEvent, hit: { index: number; node: HTMLElement }): void {
    const { editor } = this.target;
    // Read the edge first: a new selection redraws the notes, and the node with them.
    const box = hit.node.getBoundingClientRect();
    const kind = onResizeEdge(e.clientX - box.left, box.width) ? 'resize' : 'move';
    const selected = editor.selected();
    if (e.shiftKey) {
      if (!selected.includes(hit.index)) editor.select([...selected, hit.index]);
    } else if (!selected.includes(hit.index)) {
      editor.select([hit.index]);
    }
    const origin = { config: editor.current(), selected: editor.selected() };
    // A Shift-press builds a selection; only a plain press deletes on release in place.
    const tap = e.shiftKey ? null : hit.index;
    this.drag = this.noteDrag(this.press(e), kind, origin, { anchor: hit.index, tap });
    this.capture(e.pointerId);
    this.watchEdges();
  }

  private noteDrag(
    press: Press,
    kind: NoteDrag['kind'],
    origin: RollEdit,
    at: { anchor: number; tap: number | null },
  ): NoteDrag {
    const heard = origin.config.notes[at.anchor]?.pitch ?? -1;
    return { ...press, kind, origin, edit: origin, ...at, added: false, heard, lastTicks: null };
  }

  /** The note a press at `x`, `y` adds, sounded; null past the loop or off the rows. */
  private add(x: number, y: number, scene: RollScene): RollEdit | null {
    const { rows } = scene.rows;
    if (y < 0 || y >= scene.rows.height) return null;
    const row = rows[rowIndexAt(rows, y)];
    if (!row) return null;
    const frame = this.target.frame();
    const at = {
      tick: x / scene.pxPerTick,
      pitch: row.pitch,
      lastTicks: addTicksOf(this.target.view, frame.snap),
    };
    const edit = addNote(this.target.editor.current(), at, frame);
    const note = edit?.config.notes.at(-1);
    if (note) this.target.audition(note.pitch, velocityOf(note));
    return edit;
  }

  private moved(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.client = { x: e.clientX, y: e.clientY };
    this.track();
  }

  /** Follow the pointer: the drag's edit at where it is now, over the notes as they scroll. */
  private track(): void {
    const { drag } = this;
    const scene = this.target.scene();
    if (!drag || !scene) return;
    const { x, y } = this.local(drag.client.x, drag.client.y);
    if (!drag.moved && isTap(x - drag.x, y - drag.y)) return;
    drag.moved = true;
    if (drag.kind === 'move') this.moveTo(drag, scene, x, y);
    else if (drag.kind === 'resize') this.resizeTo(drag, scene, x);
    else if (drag.kind === 'box') placeBox(drag.box, drag, { x, y });
  }

  private moveTo(drag: NoteDrag, scene: RollScene, x: number, y: number): void {
    const { rows } = scene.rows;
    const by = {
      dTicks: (x - drag.x) / scene.pxPerTick,
      dRows: rowIndexAt(rows, y) - rowIndexAt(rows, drag.y),
    };
    const frame = { ...this.target.frame(), rows: rows.map((row) => row.pitch) };
    drag.edit = moveNotes(drag.origin.config, drag.origin.selected, by, frame);
    this.target.editor.preview(drag.edit);
    const anchor = drag.edit.config.notes[drag.anchor];
    if (anchor && anchor.pitch !== drag.heard) {
      drag.heard = anchor.pitch;
      this.target.audition(anchor.pitch, velocityOf(anchor));
    }
  }

  private resizeTo(drag: NoteDrag, scene: RollScene, x: number): void {
    const frame = { ...this.target.frame(), anchor: drag.anchor };
    const dTicks = (x - drag.x) / scene.pxPerTick;
    const { edit, lastTicks } = resizeNotes(
      drag.origin.config,
      drag.origin.selected,
      dTicks,
      frame,
    );
    drag.edit = edit;
    drag.lastTicks = lastTicks;
    this.target.editor.preview(edit);
  }

  private up(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.end();
    const { editor } = this.target;
    if (drag.kind === 'box') return this.selectBox(drag);
    if (drag.kind === 'tap') {
      const scene = this.target.scene();
      const edit = !drag.moved && scene ? this.add(drag.x, drag.y, scene) : null;
      if (edit) editor.commit(edit);
      return;
    }
    if (!drag.moved) {
      if (drag.tap !== null) {
        editor.commit(deleteNotes(drag.origin.config, [drag.tap], drag.origin.selected));
      } else if (drag.added) editor.commit(drag.origin);
      return;
    }
    if (drag.kind === 'resize' && drag.lastTicks !== null)
      this.target.view.lastTicks = drag.lastTicks;
    editor.commit(drag.edit);
  }

  /** Add the notes the box touches to the selection it started with. */
  private selectBox(
    drag: Press & { readonly base: readonly number[]; readonly box: HTMLElement },
  ): void {
    drag.box.remove();
    const scene = this.target.scene();
    if (!scene || !drag.moved) return;
    const { x, y } = this.local(drag.client.x, drag.client.y);
    const box = {
      from: Math.min(x, drag.x) / scene.pxPerTick,
      to: Math.max(x, drag.x) / scene.pxPerTick,
      pitches: boxPitches(scene.rows.rows, drag.y, y),
    };
    const hits = boxSelect(this.target.editor.current().notes, box);
    this.target.editor.select([...new Set([...drag.base, ...hits])]);
  }

  /** A drag that ended without a release: its preview dropped. */
  private cancel(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.end();
    if (drag.kind === 'box') drag.box.remove();
    else if (drag.kind !== 'tap') this.target.editor.cancel();
  }

  private end(): void {
    const drag = this.drag;
    this.drag = null;
    cancelAnimationFrame(this.frameId);
    const { body } = this.target.panes;
    if (drag && body.hasPointerCapture(drag.pointerId)) body.releasePointerCapture(drag.pointerId);
  }

  /** Right-click deletes the note under it. */
  private context(e: MouseEvent): void {
    e.preventDefault();
    const hit = this.noteAt(e);
    if (!hit || this.drag) return;
    const { editor } = this.target;
    editor.commit(deleteNotes(editor.current(), [hit.index], editor.selected()));
  }

  /** Each frame of a drag, scroll the pane when the pointer is at its edge, and follow. */
  private watchEdges(): void {
    const step = (): void => {
      const drag = this.drag;
      if (!drag || drag.kind === 'tap') return;
      const { body } = this.target.panes;
      const box = body.getBoundingClientRect();
      const dx = edgeScroll(drag.client.x - box.left, body.clientWidth);
      const dy = edgeScroll(drag.client.y - box.top, body.clientHeight);
      if (drag.moved && (dx !== 0 || dy !== 0)) {
        body.scrollLeft += dx;
        body.scrollTop += dy;
        this.track();
      }
      this.frameId = requestAnimationFrame(step);
    };
    this.frameId = requestAnimationFrame(step);
  }
}

/** Draw the box between the press and the pointer. */
function placeBox(
  box: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  box.style.left = `${Math.min(from.x, to.x)}px`;
  box.style.top = `${Math.min(from.y, to.y)}px`;
  box.style.width = `${Math.abs(to.x - from.x)}px`;
  box.style.height = `${Math.abs(to.y - from.y)}px`;
}

/** Wire the notes pane's gestures. */
export function rollNoteGestures(target: NoteGestureTarget): void {
  new NoteGestures(target);
}
