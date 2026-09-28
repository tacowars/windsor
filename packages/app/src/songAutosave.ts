/**
 * The open song's autosave (`2026-09-27-user-library-in-indexeddb`, decision
 * 3): a few seconds after the last change, the export text goes to the
 * `songs` store under `current`. The record is exactly the export, so a
 * restore reads it the way Import reads a file. `SongStore` is the whole of
 * what this needs from IndexedDB; the tests drive it with an in-memory fake
 * and fake timers, and only `userLibraryStore.ts` touches the browser.
 */
import { AUTOSAVE_DELAY_MS } from './songAutosaveConstants';

/** One stored song: when it was written, and the export text. */
export interface StoredSong {
  /** ISO 8601 time of the write. */
  updated: string;
  document: string;
}

export interface SongStore {
  /** The `current` record, or null when none was saved. */
  load(): Promise<StoredSong | null>;
  save(song: StoredSong): Promise<void>;
}

export interface AutosaveDeps {
  store: SongStore;
  /** The export text of the open song, read when the save runs. */
  read: () => string;
  /** Where a failed write is reported (the status line). */
  report: (message: string) => void;
  delayMs?: number;
  now?: () => Date;
}

export class SongAutosave {
  private readonly deps: AutosaveDeps;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The text last written, so a save that would write the same text is skipped. */
  private written: string | null = null;

  constructor(deps: AutosaveDeps) {
    this.deps = deps;
  }

  /** A change landed: (re)start the quiet period. */
  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.deps.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  /** Write now if a change is waiting (the page is being hidden, or the quiet period ended). */
  async flush(): Promise<void> {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    const document = this.deps.read();
    if (document === this.written) return;
    const updated = (this.deps.now?.() ?? new Date()).toISOString();
    try {
      await this.deps.store.save({ updated, document });
      this.written = document;
    } catch (error) {
      this.deps.report(
        `autosave failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
