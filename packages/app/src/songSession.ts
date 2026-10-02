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
 * untitled.
 *
 * **One switch.** Every replacement of the open document goes through
 * `switchTo`, awaited, one operation at a time: Open, New from, New song,
 * Import (`ctx.importDoc` too), the boot's reopen and restore. It drains the
 * song being left into its record, stops and reports when that fails (the
 * song stays open with its edits), and only then replaces. Nothing else
 * replaces the document or points the autosave elsewhere around it.
 * Deleting the open song drains the same way first. Opening a stored song
 * writes nothing back until the first edit, unless the open was clean and
 * renamed a part (`saveOpenIfClean`).
 *
 * Storage reads and writes are `songSessionStorage.ts`; the edits to stored
 * songs by id are `songSessionStored.ts`.
 */
import type { ApplyResult, ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import type { DocumentModel } from './documentModel';
import type { AutosaveTarget } from './songAutosave';
import { sessionTarget } from './songAutosave';
import type { SongListEntry } from './songLibrary';
import { NEW_SONG, StaleSongError } from './songLibrary';
import { fileNameAmend, metaOf, templateCopy, withMeta } from './songMetaText';
import { newSong } from './songParts';
import { importRefusedText, songRefusal } from './songRestore';
import type { OpenProblem, OpenRecord, SessionStorage, StoredReadable } from './songSessionStorage';
import {
  STALE_SONG_TEXT,
  errorText,
  landedTarget,
  namedTarget,
  pointCurrentAt,
  problemText,
  readStored,
} from './songSessionStorage';
import type { SeenRevisions } from './songSessionRevisions';
import { seenRevisions } from './songSessionRevisions';
import type { StoredSongs } from './songSessionStored';
import { duplicateSong, editMeta, exportSong, removeSong } from './songSessionStored';
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

/**
 * Where an untitled song comes from: an imported file's name (a song with
 * no name takes it), the template it was made from, and, for the boot,
 * `unless` (asked immediately before replacing; true leaves the document
 * alone) and `quiet` (a restore writes nothing back until the first edit).
 */
export interface UntitledSource {
  readonly fileName?: string;
  readonly origin?: string;
  readonly unless?: () => boolean;
  readonly quiet?: boolean;
}

/** How a switch went: done, stopped because the song being left couldn't be saved, or left alone (`unless`). */
type Switched = 'done' | 'unsaved' | 'touched';

/** The open named song: its record and the autosave target writing it. */
interface NamedOpen {
  readonly record: OpenRecord;
  readonly target: AutosaveTarget;
}

/** The undo steps the session's own edits are named. */
export const SONG_META_LABELS = { name: 'Song name', tags: 'Song tags' } as const;

export class SongSession {
  private readonly host: SessionHost;
  private storage: SessionStorage | null = null;
  private seen: SeenRevisions | null = null;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly ready: () => Promise<unknown>;
  private current: SongSessionState = { kind: 'untitled' };
  private named: NamedOpen | null = null;
  private readonly listeners = new Set<() => void>();
  /** The session's operations, one after another, so two switches never interleave. */
  private chain: Promise<unknown> = Promise.resolve();
  /** How many times the document has been replaced, for a boot that must not replace a touched one. */
  private replaced = 0;
  /** The text right after the session's last replacement, any open-time amend included (windsor#455). */
  private openedText: string | null = null;
  /**
   * A named song whose `current` still holds the recovery copy of an edit
   * owed to it (windsor#452): `current` names the song once that edit has
   * landed in its record, never before.
   */
  private repoint: string | null = null;

  constructor(host: SessionHost, options: SessionOptions = {}) {
    this.host = host;
    this.now = options.now ?? ((): Date => new Date());
    this.newId = options.newId ?? ((): string => crypto.randomUUID());
    this.ready = options.ready ?? loadBuiltIns;
  }

  /** Give the session the browser's storage (at boot, once IndexedDB has opened). */
  attach(storage: SessionStorage): void {
    this.seen = seenRevisions(storage.library);
    this.storage = { ...storage, library: this.seen.library };
    this.emit();
  }

  /** False where the browser offers no IndexedDB: the library is unavailable, Document works as before. */
  get available(): boolean {
    return this.storage !== null;
  }

  /** How many times the session has replaced the document (an open, New song, Import, a restore). */
  get replacements(): number {
    return this.replaced;
  }

  get state(): SongSessionState {
    return this.current;
  }

  /** True once another tab saved the open named song: its autosave is refused, and Save as copy… keeps the edits. */
  get stale(): boolean {
    return this.named?.record.stale ?? false;
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

  /**
   * True only when leaving would lose something: the open song is untitled
   * and the user has edited it. An open-time amend (an import's file name)
   * is not the user's edit, so the text is compared with the text right
   * after the session's replacement (windsor#455).
   */
  leaveNeedsConfirm(): boolean {
    const { model } = this.host;
    return this.current.kind === 'untitled' && model.changed && model.toJson() !== this.openedText;
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
   * untitled song this is `saveAs`. It is also the way out of a stale song.
   */
  saveAsCopy(name: string, tags: readonly string[]): Promise<string | null> {
    return this.saveAs(name, tags);
  }

  /** Open stored song `id` as the named song; a problem is reported. */
  async open(id: string): Promise<boolean> {
    const outcome = await this.openSong(id);
    return outcome.ok || this.fail(problemText(outcome));
  }

  /**
   * Open stored song `id`, reporting nothing: the reload says it its own
   * way. `unless` is the boot's: asked immediately before the document is
   * replaced, and true leaves it alone (`touched`).
   */
  openSong(id: string, options: { unless?: () => boolean } = {}): Promise<OpenOutcome> {
    return this.withStorage<OpenOutcome>({ ok: false, problem: 'unavailable' }, async (storage) => {
      if (this.isOpen(id)) return { ok: true, name: metaOf(this.host.model.doc).name };
      const song = await readStored(storage.library, id);
      if (!song.ok) return song;
      const switched = await this.switchTo(() => this.openNamed(storage, id, song), options.unless);
      if (switched !== 'done') return { ok: false, problem: switched };
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
      return this.adoptNow(templateCopy(song.raw), { origin: song.name });
    });
  }

  /** New song; false when the song being left couldn't be saved (reported) and stayed open. */
  newSong(): Promise<boolean> {
    return this.run(() => this.adoptNow(newSong()));
  }

  /** Import a file's text as an untitled song; false when it was refused or the song being left stayed open. */
  importText(text: string, fileName: string): Promise<boolean> {
    return this.run(() => {
      const refusal = songRefusal(text);
      if (refusal) return Promise.resolve(this.fail(importRefusedText(fileName, refusal)));
      return this.adoptNow(JSON.parse(text) as unknown, { fileName });
    });
  }

  /**
   * Replace the document with `raw` as an untitled song, through the one
   * switch: `ctx.importDoc`'s path and the boot's restore. Resolves false
   * when the switch stopped (reported) or `unless` held.
   */
  adopt(raw: unknown, source: UntitledSource = {}): Promise<boolean> {
    return this.run(() => this.adoptNow(raw, source));
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
   * Delete stored song `id`, refused when another tab saved it since this
   * tab saw it (windsor#452). Deleting the open song leaves it open and
   * playing, now untitled: see `removeOpen`. Another song's delete is based
   * on `revision`, the one the caller's list showed, or by default on the
   * one this session last listed or wrote (`removeSong`).
   */
  remove(id: string, revision?: number): Promise<boolean> {
    return this.withStored(false, (songs) =>
      this.named && this.isOpen(id)
        ? this.removeOpen(songs.storage, this.named)
        : removeSong(songs, id, revision),
    );
  }

  private isOpen(id: string): boolean {
    return this.current.kind === 'named' && this.current.id === id;
  }

  private become(state: SongSessionState): void {
    this.current = state;
    this.repoint = null;
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
        seen: (id) => this.seen?.revision(id),
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
   * The one switch (record `2026-10-02-song-library`, "One switch"), run
   * inside `run`. The built-ins arrive first. Then the song being left is
   * drained, and a failure stops the switch, reported, with that song still
   * open. Then `unless` is asked, and `replace` runs at once: nothing is
   * awaited between the drain, the check and the replacement, so no edit
   * can fall between them. The storage is read after the wait, so a switch
   * queued before the boot attached it drains with it.
   */
  private async switchTo(
    replace: (storage: SessionStorage | null) => void,
    unless?: () => boolean,
  ): Promise<Switched> {
    await this.ready();
    const storage = this.storage;
    if (storage && !(await this.leave(storage))) return 'unsaved';
    if (unless?.()) return 'touched';
    replace(storage);
    return 'done';
  }

  /**
   * Flush the song being left into its record, and anything edited while
   * that ran, until nothing is waiting. Leaving a named song that can't be
   * saved stops the switch, reported. An untitled song's `current` is about
   * to be replaced, so its flush never stops one.
   */
  private async leave(storage: SessionStorage): Promise<boolean> {
    let ok = await storage.autosave.flush();
    while (ok && storage.autosave.pending) ok = await storage.autosave.flush();
    if (ok || this.current.kind === 'untitled') return true;
    if (this.stale) return this.fail(STALE_SONG_TEXT);
    const name = metaOf(this.host.model.doc).name || 'this song';
    return this.fail(`${name} stays open: its last changes couldn't be saved`);
  }

  /** The switch to `raw` as an untitled song; `current` takes its text at once when a named song was left. */
  private async adoptNow(raw: unknown, source: UntitledSource = {}): Promise<boolean> {
    const leftNamed = this.current.kind === 'named';
    const switched = await this.switchTo(
      (storage) => this.openUntitled(storage, raw, source),
      source.unless,
    );
    if (switched !== 'done') return false;
    // `current` still names the song just left: it takes this one's text now.
    if (leftNamed && this.storage) await this.storage.autosave.flush();
    return true;
  }

  /** The replacement of an untitled switch; what was owed was the left song's, and the drain wrote it. */
  private openUntitled(storage: SessionStorage | null, raw: unknown, source: UntitledSource): void {
    const leftNamed = this.current.kind === 'named';
    storage?.autosave.retarget(sessionTarget(storage.store), { owed: leftNamed });
    this.named = null;
    const amend = source.fileName === undefined ? undefined : fileNameAmend(source.fileName);
    const replace = (): void => this.replace(raw, amend);
    if (storage && source.quiet) storage.autosave.quietly(replace);
    else replace();
    this.openedText = this.host.model.toJson();
    const { origin } = source;
    this.become(origin === undefined ? { kind: 'untitled' } : { kind: 'untitled', origin });
  }

  /** The replacement of an open: stored song `id`, quietly, its record already holding its text. */
  private openNamed(storage: SessionStorage, id: string, song: StoredReadable): void {
    storage.autosave.quietly(() => this.replace(song.raw));
    const target = this.openRecord(storage, id, song.revision);
    storage.autosave.retarget(target, { owed: false, written: song.text });
    this.become({ kind: 'named', id });
  }

  /** Make named song `id`, at `revision`, the open record; resolves the target its autosave writes. */
  private openRecord(storage: SessionStorage, id: string, revision: number): AutosaveTarget {
    const record: OpenRecord = { id, revision, stale: false, gone: false };
    const target = namedTarget(storage.library, record, {
      written: async () => {
        this.emit();
        if (this.repoint !== id) return;
        this.repoint = null;
        await this.pointAt(storage, id);
      },
      stale: () => {
        this.host.notify(STALE_SONG_TEXT, 'error');
        this.emit();
      },
    });
    this.named = { record, target };
    return target;
  }

  /**
   * Delete the open song, which stays open and playing as untitled. The
   * switch's drain runs first, so its pending change is in it (a failure
   * stops the delete, reported). Then one transaction deletes its records
   * and writes its text into `current`, so a committed copy survives either
   * way; it is based on the revision the open text is, and refused when
   * another tab saved the song since. While it runs the autosave writes to
   * `current`; when it fails, `keepOpen` puts the song back.
   */
  private async removeOpen(storage: SessionStorage, open: NamedOpen): Promise<boolean> {
    if (!(await this.leave(storage))) return false;
    const session = sessionTarget(storage.store);
    const away = landedTarget(session);
    storage.autosave.retarget(away.target);
    const document = this.host.model.toJson();
    const current = { updated: this.now().toISOString(), document };
    try {
      await storage.library.removeOpen(open.record.id, current, open.record.revision);
    } catch (error) {
      return this.keepOpen(storage, open, { document, landed: away.landed }, error);
    }
    open.record.gone = true;
    this.named = null;
    storage.autosave.retarget(session, { written: document });
    this.become({ kind: 'untitled' });
    return true;
  }

  /**
   * The open song's delete failed or was refused (windsor#452 decision 4):
   * its own record is the autosave's target again. An edit made since the
   * drain is owed to it, whether it waits or went to `current`, and the next
   * flush stores it there. When one of those writes landed in `current`,
   * `current` keeps that recovery copy until the owed write has landed in
   * the song's record, and only then names the song again (`repoint`); with
   * nothing owed, it names the song at once.
   */
  private async keepOpen(
    storage: SessionStorage,
    open: NamedOpen,
    away: { readonly document: string; landed(): boolean },
    error: unknown,
  ): Promise<false> {
    const stale = error instanceof StaleSongError;
    if (stale) open.record.stale = true;
    const owed = this.host.model.toJson() !== away.document;
    // Set before the settle, so an owed write that lands while it waits repoints `current`.
    if (owed) this.repoint = open.record.id;
    storage.autosave.retarget(open.target, { owed });
    await storage.autosave.settle();
    if (!away.landed()) this.repoint = null;
    else if (!owed) await this.pointAt(storage, open.record.id);
    if (stale) this.emit();
    return this.fail(stale ? STALE_SONG_TEXT : `delete failed: ${errorText(error)}`);
  }

  private replace(raw: unknown, amend?: OpenAmend): void {
    this.replaced++;
    this.host.parts.selected = 0;
    this.host.replace(raw, amend);
    // An untitled switch takes the text right after it; any other replacement compares as `changed` does.
    this.openedText = null;
  }

  /** Store `text` under a new id and make it the open named song; null (reported) when the write failed. */
  private async storeAsNew(storage: SessionStorage, text: string): Promise<string | null> {
    const id = this.newId();
    let revision: number;
    try {
      revision = (await storage.library.write(id, text, NEW_SONG)).revision;
    } catch (error) {
      this.fail(`save failed: ${errorText(error)}`);
      return null;
    }
    storage.autosave.retarget(this.openRecord(storage, id, revision), { written: text });
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
