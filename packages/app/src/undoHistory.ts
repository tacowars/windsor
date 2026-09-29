/**
 * The song's undo history (windsor#124; epic windsor#112 decisions 2, 5 and
 * 6; record `2026-09-29-undo-history`), pure: an undo stack and a redo stack
 * of steps, each holding the document as it was before the step, the step's
 * name and the tab it was made on. It knows nothing of the DOM or the
 * engine: `AppContext` records into it and applies what it hands back, and
 * `undoHistory.test.ts` drives it with plain values.
 *
 * On the undo stack a step's `before` is the document an undo returns to; on
 * the redo stack it is the document a redo returns to, which is the one the
 * undo left behind.
 */
import { UNDO_DEPTH } from './undoConstants';

export interface UndoStep<D> {
  /** The document as it stood before the step: a reference, never a copy (decision 2). */
  readonly before: D;
  /** What the step did, for "Undo Cutoff" (ticket 3's tooltips). */
  readonly label: string;
  /** The tab the step was made on, which an undo or a redo shows; null before any tab exists. */
  readonly tab: string | null;
}

export class UndoHistory<D> {
  private readonly undos: UndoStep<D>[] = [];
  private readonly redos: UndoStep<D>[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly depth: number = UNDO_DEPTH) {}

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** The step an undo would take back, or null. */
  get nextUndo(): UndoStep<D> | null {
    return this.undos.at(-1) ?? null;
  }

  /** The step a redo would make again, or null. */
  get nextRedo(): UndoStep<D> | null {
    return this.redos.at(-1) ?? null;
  }

  get undoLabel(): string | null {
    return this.nextUndo?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.nextRedo?.label ?? null;
  }

  /** How many steps each stack holds, for tests and the memory note. */
  get size(): { undo: number; redo: number } {
    return { undo: this.undos.length, redo: this.redos.length };
  }

  /** A new step: onto the undo stack, the oldest dropped past the depth, the redo stack emptied (decision 6). */
  record(step: UndoStep<D>): void {
    this.pushUndo(step);
    this.redos.length = 0;
    this.notify();
  }

  /** The next undo was applied, leaving `after`: its step moves to the redo stack, holding `after`. */
  undone(after: D): void {
    const step = this.undos.pop();
    if (!step) return;
    this.redos.push({ ...step, before: after });
    this.notify();
  }

  /** The next redo was applied, leaving `after`: its step moves back to the undo stack, holding `after`. */
  redone(after: D): void {
    const step = this.redos.pop();
    if (!step) return;
    this.pushUndo({ ...step, before: after });
    this.notify();
  }

  /** Forget every step: an import, New song or the restore on reload (decision 4). */
  clear(): void {
    if (this.undos.length === 0 && this.redos.length === 0) return;
    this.undos.length = 0;
    this.redos.length = 0;
    this.notify();
  }

  /** Listen for every change to either stack; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private pushUndo(step: UndoStep<D>): void {
    this.undos.push(step);
    if (this.undos.length > this.depth) this.undos.shift();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * A step's name when the caller gives none: the partial's top-level
 * sections, the first capitalised ("Transport", "Parts, patches"). A gesture
 * names itself (ticket 2), so this is the fallback for a one-shot edit.
 */
export function stepLabel(partial: object): string {
  const text = Object.keys(partial).join(', ');
  return text === '' ? 'Edit' : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
