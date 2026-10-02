/**
 * The open-song session (windsor#433, record `2026-10-02-song-library`),
 * `ctx.songs`: whether the open document is an untitled song or one of the
 * named songs stored in this browser, and every way the console moves
 * between them. The open song's name and tags are always the document's
 * `meta`; the session holds only which record the song lives in.
 *
 * - **Untitled** (with an optional `origin`, the template it came from, for
 *   display) autosaves into the session record `current`, as before.
 * - **Named** autosaves into its own library record, and `current` names it.
 *
 * Only `open`, `saveAs` and `saveAsCopy` make the song named. Every other
 * replacement of the document — New song, Import, a restore, New from — is
 * untitled, through `adoptUntitled`, which `ctx.importDoc` calls, so no
 * caller can forget it.
 *
 * **Autosave goes to the song it read.** A switch first flushes the pending
 * autosave into the record being left, and when that write fails the switch
 * is abandoned and reported, and the song stays open with its edits.
 * Opening a stored song writes nothing back until the first edit, unless the
 * open was clean and renamed a part (`saveOpenIfClean`).
 *
 * Storage reads and writes are `songSessionStorage.ts`; the edits to stored
 * songs by id are `songSessionStored.ts`.
 */
import type { ApplyResult, ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import type { DocumentModel } from './documentModel';
import { sessionTarget } from './songAutosave';
import type { SongListEntry } from './songLibrary';
import { fileNameAmend, metaOf, templateCopy, withMeta } from './songMetaText';
import { newSong } from './songParts';
import { importRefusedText, songRefusal } from './songRestore';
import type { OpenProblem, SessionStorage } from './songSessionStorage';
import {
  errorText,
  namedTarget,
  pointCurrentAt,
  problemText,
  readStored,
} from './songSessionStorage';
import type { StoredSongs } from './songSessionStored';
import { duplicateSong, editMeta, exportSong } from './songSessionStored';
import type { ToastTone } from './toastModel';
import { saveOpenIfClean } from './userSessionAutosave';

/** Which record the open song lives in. */
export type SongSessionState =
  | { readonly kind: 'untitled'; readonly origin?: string }
  | { readonly kind: 'named'; readonly id: string };

/** An edit the opening itself makes (windsor#103's load-time rename is one). */
export type OpenAmend = (doc: ArrangementDocument) => DocumentPartial | null;

/** What the session needs of the console: the document, and the one way to replace it. */
export interface SessionHost {
  readonly model: DocumentModel;
  readonly parts: { selected: number };
  /** Replace the document: normalise it, start a new undo history, rebuild the live system. */
  replace(raw: unknown, amend?: OpenAmend): void;
  /** A document edit: applied live and recorded as one undo step named `label`. */
  change(partial: DocumentPartial, label: string): ApplyResult;
  notify(message: string, tone?: ToastTone): void;
}

export interface SessionOptions {
  now?: () => Date;
  newId?: () => string;
  /** What must have arrived before a stored song opens: the built-ins, for an older song's library fill (#562). */
  ready?: () => Promise<unknown>;
}

/** How opening a stored song went: its name, or why it did not open. */
export type OpenOutcome =
  { readonly ok: true; readonly name: string } | ({ readonly ok: false } & OpenProblem);

/** The undo steps the session's own edits are named. */
export const SONG_META_LABELS = { name: 'Song name', tags: 'Song tags' } as const;

export class SongSession {
  private readonly host: SessionHost;
  private storage: SessionStorage | null = null;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly ready: () => Promise<unknown>;
  private current: SongSessionState = { kind: 'untitled' };
  private readonly listeners = new Set<() => void>();
  /** The session's operations, one after another, so two switches never interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(host: SessionHost, options: SessionOptions = {}) {
    this.host = host;
    this.now = options.now ?? ((): Date => new Date());
    this.newId = options.newId ?? ((): string => crypto.randomUUID());
    this.ready = options.ready ?? loadBuiltIns;
  }

  /** Give the session the browser's storage (at boot, once IndexedDB has opened). */
  attach(storage: SessionStorage): void {
    this.storage = storage;
    this.emit();
  }

  /** False where the browser offers no IndexedDB: the library is unavailable, Document works as before. */
  get available(): boolean {
    return this.storage !== null;
  }

  get state(): SongSessionState {
    return this.current;
  }

  /** Hear every change of state, and every write to a stored song; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Every stored song's index record, with its refusal; reads no document it has an index for. */
  list(): Promise<SongListEntry[]> {
    return this.storage ? this.storage.library.list() : Promise.resolve([]);
  }

  /** True only when leaving would lose something: the open song is untitled and has changed. */
  leaveNeedsConfirm(): boolean {
    return this.current.kind === 'untitled' && this.host.model.changed;
  }

  /**
   * Name the untitled song and store it: the name and tags are one document
   * edit (one undo step), and the song becomes the open named song. On a
   * named song this is `saveAsCopy`. Resolves the new id, or null.
   */
  saveAs(name: string, tags: readonly string[]): Promise<string | null> {
    return this.withStorage(null, async (storage) => {
      if (this.current.kind === 'named') return this.storeCopy(storage, name, tags);
      this.host.change({ meta: { name, tags } }, SONG_META_LABELS.name);
      return this.storeAsNew(storage, this.host.model.toJson());
    });
  }

  /**
   * A new named song from the open one, under `name` and `tags`; it becomes
   * the open song, and the original's records are not written. On an
   * untitled song this is `saveAs`.
   */
  saveAsCopy(name: string, tags: readonly string[]): Promise<string | null> {
    return this.saveAs(name, tags);
  }

  /** Open stored song `id` as the named song; a problem is reported. */
  async open(id: string): Promise<boolean> {
    const outcome = await this.openSong(id);
    return outcome.ok || this.fail(problemText(outcome));
  }

  /** Open stored song `id`, reporting nothing: the reload says it its own way. */
  openSong(id: string): Promise<OpenOutcome> {
    return this.withStorage<OpenOutcome>({ ok: false, problem: 'unavailable' }, async (storage) => {
      if (this.isOpen(id)) return { ok: true, name: metaOf(this.host.model.doc).name };
      const song = await readStored(storage.library, id);
      if (!song.ok) return song;
      if (!(await this.leave(storage))) return { ok: false, problem: 'unsaved' };
      await this.ready();
      storage.autosave.quietly(() => this.replace(song.raw));
      const target = namedTarget(storage.library, id, () => this.emit());
      storage.autosave.retarget(target, { written: song.text });
      this.become({ kind: 'named', id });
      saveOpenIfClean(this.host.model, storage.autosave);
      await this.pointAt(storage, id);
      return { ok: true, name: song.name };
    });
  }

  /** Open a copy of stored song `id` as a new untitled song: an empty name, `template` gone from its tags. */
  newFrom(id: string): Promise<boolean> {
    return this.withStorage(false, async (storage) => {
      const song = await readStored(storage.library, id);
      if (!song.ok) return this.fail(problemText(song));
      if (!(await this.leave(storage))) return false;
      await this.ready();
      this.adoptUntitled(templateCopy(song.raw), { origin: song.name });
      return true;
    });
  }

  /** New song, the song being left flushed first; false when that failed and it stayed open. */
  newSong(): Promise<boolean> {
    return this.run(async () => {
      if (this.storage && !(await this.leave(this.storage))) return false;
      this.adoptUntitled(newSong());
      return true;
    });
  }

  /** Import a file's text as an untitled song, the song being left flushed first; false when it did not open. */
  importText(text: string, fileName: string): Promise<boolean> {
    return this.run(async () => {
      const refusal = songRefusal(text);
      if (refusal) return this.fail(importRefusedText(fileName, refusal));
      if (this.storage && !(await this.leave(this.storage))) return false;
      await this.ready();
      this.adoptUntitled(JSON.parse(text) as unknown, { fileName });
      return true;
    });
  }

  /**
   * Replace the document with `raw` as an untitled song: `ctx.importDoc`'s
   * path, and every untitled switch's. The pending autosave of the song
   * being left is sent to its own record first (read now, written in
   * order), so none of it reaches the new song's. An imported song with no
   * name takes `fileName`'s, as an edit the open makes.
   */
  adoptUntitled(raw: unknown, source: { fileName?: string; origin?: string } = {}): void {
    const storage = this.storage;
    const leftNamed = this.current.kind === 'named';
    if (storage) {
      void storage.autosave.flush();
      storage.autosave.retarget(sessionTarget(storage.store), { owed: leftNamed });
    }
    const { fileName, origin } = source;
    this.replace(raw, fileName === undefined ? undefined : fileNameAmend(fileName));
    this.become(origin === undefined ? { kind: 'untitled' } : { kind: 'untitled', origin });
    // `current` still names the song just left: it takes this one's text now.
    if (storage && leftNamed) void storage.autosave.flush();
  }

  /** Rename song `id`: the open one as an undoable edit, another as a write. Which song is open doesn't change. */
  rename(id: string, name: string): Promise<boolean> {
    return this.withStored(false, (songs) =>
      editMeta(songs, id, (meta) => ({ ...meta, name }), SONG_META_LABELS.name),
    );
  }

  /** Set song `id`'s tags, the way `rename` sets its name. */
  setTags(id: string, tags: readonly string[]): Promise<boolean> {
    return this.withStored(false, (songs) =>
      editMeta(songs, id, (meta) => ({ ...meta, tags }), SONG_META_LABELS.tags),
    );
  }

  /** A new stored song copied from song `id`, named `<name> copy`; the open song doesn't change. */
  duplicate(id: string): Promise<string | null> {
    return this.withStored(null, (songs) => duplicateSong(songs, id));
  }

  /** Song `id`'s export text, a song this build can't read included, as stored. */
  exportText(id: string): Promise<string | null> {
    return this.withStored(null, (songs) => exportSong(songs, id));
  }

  /**
   * Delete stored song `id`. Deleting the open song leaves it open and
   * playing, now untitled, and its text goes back into `current` at once.
   * The autosave is pointed away first, so no late write brings it back.
   */
  remove(id: string): Promise<boolean> {
    return this.withStorage(false, async (storage) => {
      const open = this.isOpen(id);
      if (open) storage.autosave.retarget(sessionTarget(storage.store), { owed: true });
      try {
        await storage.library.remove(id);
      } catch (error) {
        if (open) storage.autosave.retarget(namedTarget(storage.library, id, () => this.emit()));
        return this.fail(`delete failed: ${errorText(error)}`);
      }
      if (open) {
        this.become({ kind: 'untitled' });
        await storage.autosave.flush();
      } else this.emit();
      return true;
    });
  }

  private isOpen(id: string): boolean {
    return this.current.kind === 'named' && this.current.id === id;
  }

  private become(state: SongSessionState): void {
    this.current = state;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Run `op` after every operation before it. */
  private run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.chain.then(op, op);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** `run` with the storage; `absent` without IndexedDB. */
  private withStorage<T>(absent: T, op: (storage: SessionStorage) => Promise<T>): Promise<T> {
    return this.run(() => (this.storage ? op(this.storage) : Promise.resolve(absent)));
  }

  /** `run` with what the edits to stored songs need. */
  private withStored<T>(absent: T, op: (songs: StoredSongs) => Promise<T>): Promise<T> {
    return this.withStorage(absent, (storage) =>
      op({
        storage,
        host: this.host,
        isOpen: (id) => this.isOpen(id),
        newId: this.newId,
        emit: () => this.emit(),
      }),
    );
  }

  /** Report `message` (when there is one) as an error toast; always false, for a caller's return. */
  private fail(message: string | null): false {
    if (message !== null) this.host.notify(message, 'error');
    return false;
  }

  private async pointAt(storage: SessionStorage, id: string): Promise<void> {
    this.fail(await pointCurrentAt(storage.store, id, this.now()));
  }

  /**
   * Flush the song being left into its record, and anything edited while
   * that ran. Leaving a named song that can't be saved stops the switch,
   * reported, with the song still open. An untitled song's `current` is
   * about to be replaced, so its flush never stops one.
   */
  private async leave(storage: SessionStorage): Promise<boolean> {
    let ok = await storage.autosave.flush();
    while (ok && storage.autosave.pending) ok = await storage.autosave.flush();
    if (ok || this.current.kind === 'untitled') return true;
    const name = metaOf(this.host.model.doc).name || 'this song';
    return this.fail(`${name} stays open: its last changes couldn't be saved`);
  }

  private replace(raw: unknown, amend?: OpenAmend): void {
    this.host.parts.selected = 0;
    this.host.replace(raw, amend);
  }

  /** Store `text` under a new id and make it the open named song; null (reported) when the write failed. */
  private async storeAsNew(storage: SessionStorage, text: string): Promise<string | null> {
    const id = this.newId();
    try {
      await storage.library.write(id, text);
    } catch (error) {
      this.fail(`save failed: ${errorText(error)}`);
      return null;
    }
    const target = namedTarget(storage.library, id, () => this.emit());
    storage.autosave.retarget(target, { written: text });
    this.become({ kind: 'named', id });
    await this.pointAt(storage, id);
    return id;
  }

  /**
   * The open named song stored as a new song under `name` and `tags`, which
   * becomes the open one. Its pending change goes into the copy, never the
   * original; when the copy can't be stored, the original keeps it and stays open.
   */
  private async storeCopy(
    storage: SessionStorage,
    name: string,
    tags: readonly string[],
  ): Promise<string | null> {
    const waiting = storage.autosave.cancel();
    const id = await this.storeAsNew(storage, withMeta(this.host.model.toJson(), { name, tags }));
    if (id === null) {
      if (waiting) storage.autosave.schedule();
      return null;
    }
    this.host.change({ meta: { name, tags } }, SONG_META_LABELS.name);
    return id;
  }
}
