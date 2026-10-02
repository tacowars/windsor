/**
 * The open song's autosave (`2026-09-27-user-library-in-indexeddb`, decision
 * 3): a few seconds after the last change, the export text goes to the
 * record the open song lives in. For an untitled song that is the `songs`
 * store's `current`, exactly the export, so a restore reads it the way
 * Import reads a file. For a named song (windsor#433, record
 * `2026-10-02-song-library`) it is the song's own record in the library,
 * and the session points the autosave there with `retarget`.
 *
 * **A write goes to the song it read.** `flush()` reads the text and the
 * target together, synchronously, before anything is awaited, so a switch
 * that flushes and then replaces the document can never send the old
 * song's text to the new song's record. Writes run one after another.
 *
 * `SongStore` and `AutosaveTarget` are the whole of what this needs from
 * IndexedDB; the tests drive it with in-memory fakes and fake timers, and
 * only `userLibraryStore.ts` touches the browser.
 */
import { AUTOSAVE_DELAY_MS } from './songAutosaveConstants';

/** The untitled song's session record: when it was written, and the export text. */
export interface StoredSong {
  /** ISO 8601 time of the write. */
  updated: string;
  document: string;
}

/** The session record while a named song is open: only which song (windsor#433). */
export interface NamedSession {
  updated: string;
  songId: string;
}

/** What `songs/current` holds. */
export type SessionRecord = StoredSong | NamedSession;

export const isNamedSession = (record: SessionRecord): record is NamedSession => 'songId' in record;

export interface SongStore {
  /** The `current` record, or null when none was saved. */
  load(): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
}

/** Where the open song's text goes: `current`, or a named song's record. */
export interface AutosaveTarget {
  save(text: string, updated: string): Promise<void>;
}

/**
 * A write the target refused and has already told the reader about (a song
 * another tab saved since): the change stays owed, and is not reported again.
 */
export class ReportedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportedRefusal';
  }
}

/** The untitled song's target: `current` holds the whole text. */
export const sessionTarget = (store: SongStore): AutosaveTarget => ({
  save: (document, updated) => store.save({ updated, document }),
});

export interface AutosaveDeps {
  /** The session store; the first target is its `current` record. */
  store: SongStore;
  /** The export text of the open song, read when the save runs. */
  read: () => string;
  /** Where a failed write is reported (a toast). */
  report: (message: string) => void;
  delayMs?: number;
  now?: () => Date;
}

export class SongAutosave {
  private readonly deps: AutosaveDeps;
  private target: AutosaveTarget;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A change the target has not been sent: a flush, or a failed write, left it owed. */
  private owed = false;
  /** While above zero, a change schedules nothing (`quietly`). */
  private quiet = 0;
  /** The text and target last written, so a save that would write the same text is skipped. */
  private written: { text: string; target: AutosaveTarget } | null = null;
  /** The writes in order; each resolves true when it stored its text. */
  private queue: Promise<boolean> = Promise.resolve(true);
  /** Writes captured and not yet settled. */
  private inFlight = 0;

  constructor(deps: AutosaveDeps) {
    this.deps = deps;
    this.target = sessionTarget(deps.store);
  }

  /** A change landed: (re)start the quiet period. */
  schedule(): void {
    if (this.quiet > 0) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.deps.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  /**
   * True while leaving the page could lose an edit: a change is waiting
   * (scheduled, or owed after a flush or a failed write) or a write is
   * still under way. `beforeunload` asks the browser to confirm while it holds.
   */
  get unsaved(): boolean {
    return this.timer !== null || this.owed || this.inFlight > 0;
  }

  /** Resolves once every write already captured has settled; captures nothing itself. */
  settle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /**
   * Write now if a change is waiting (the page is being hidden, the quiet
   * period ended, or the session is about to switch songs). Resolves true
   * once the open song's text is stored, after any write already under way,
   * and false when the write failed; the failure is also reported, and the
   * change stays owed, so the next flush tries again.
   */
  flush(): Promise<boolean> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.owed = true;
    }
    if (!this.owed) return this.queue.then(() => !this.owed);
    this.owed = false;
    const text = this.deps.read();
    const target = this.target;
    this.inFlight++;
    this.queue = this.queue
      .then(() => this.write(target, text))
      .finally(() => void this.inFlight--);
    return this.queue;
  }

  /**
   * Send the open song's changes to `target` from now on.
   *
   * - `owed` given says whether `target` lacks the open text: a switch that
   *   has just replaced the document knows, since the drain wrote the song
   *   it left.
   * - Left out, **a retarget never drops a write still owed**: a change the
   *   last target was never sent is sent to this one. The one exception is
   *   `written` naming exactly the open text, because then it was written.
   * - `written` names text `target` already holds, so an identical write is
   *   skipped.
   */
  retarget(target: AutosaveTarget, options: { owed?: boolean; written?: string } = {}): void {
    this.target = target;
    const { owed, written } = options;
    if (written !== undefined) this.written = { text: written, target };
    if (owed !== undefined) this.owed = owed;
    else if (this.owed && written !== undefined && this.deps.read() === written) this.owed = false;
  }

  /** Drop a waiting change without writing it; true when one was waiting. */
  cancel(): boolean {
    const waiting = this.timer !== null || this.owed;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.owed = false;
    return waiting;
  }

  /** Run `replace` with changes scheduling nothing: a session's open decides for itself. */
  quietly(replace: () => void): void {
    this.quiet++;
    try {
      replace();
    } finally {
      this.quiet--;
    }
  }

  private async write(target: AutosaveTarget, text: string): Promise<boolean> {
    if (this.written?.target === target && this.written.text === text) return true;
    const updated = (this.deps.now?.() ?? new Date()).toISOString();
    try {
      await target.save(text, updated);
      this.written = { text, target };
      return true;
    } catch (error) {
      if (this.target === target) this.owed = true;
      if (error instanceof ReportedRefusal) return false;
      this.deps.report(
        `autosave failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
