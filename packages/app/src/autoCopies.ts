/**
 * The patch copies the app made on its own this session (windsor#671,
 * record `2026-10-10-each-part-owns-its-patch`, addendum): the copy a load
 * makes because another part plays the picked id (windsor#669 decision 2),
 * and the open-time split (`isolatePartPatches`). Only these may be dropped
 * when their part moves on (`leftCopyDrop`). What is recorded is the fact,
 * never inferred from an id's shape, so a renamed copy is never taken for
 * one. Session state only: it is not written to the document or exported,
 * and opening a song starts it afresh, so a copy an earlier session or
 * another song made is never dropped.
 */
export class AutoCopies {
  private readonly ids = new Set<string>();

  /** A song opens: forget every earlier copy, and record the ids its split made. */
  reset(made: Iterable<string> = []): void {
    this.ids.clear();
    for (const id of made) this.ids.add(id);
  }

  /** A load made copy `id` because another part plays what it picked. */
  add(id: string): void {
    this.ids.add(id);
  }

  /** True when the app made `id` as a copy this session. */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** A rename: the old id is no copy any more, and the new one never becomes one. */
  renamed(from: string, to: string): void {
    this.ids.delete(from);
    this.ids.delete(to);
  }
}
