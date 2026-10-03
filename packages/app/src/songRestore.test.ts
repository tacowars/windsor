/**
 * Restoring the last session (`2026-09-27-user-library-in-indexeddb`,
 * decision 1): asked first, opened through `importDoc` like a file, and a
 * record that will not open is reported and left alone.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ARRANGEMENT_VERSION } from '@windsor/engine';
import { FULL_ARRANGEMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import { addPartLive } from './partEdits';
import type { ConfirmRequest } from './metadataModal';
import type { SessionRecord, StoredSong } from './songAutosave';
import {
  bootSong,
  importRefusedText,
  offerRestore,
  restoreRequest,
  songRefusal,
  touchWatch,
} from './songRestore';

beforeAll(() => loadBuiltIns());

/** A real console with no IndexedDB, on its third part; `messages` are its toasts, as `tone: message`. */
function context(): AppCtx & { messages: string[] } {
  const c = openSessionConsole(false);
  addPartLive(c.ctx);
  addPartLive(c.ctx);
  c.toasts.length = 0;
  return Object.assign(c.ctx, { messages: c.toasts });
}

const saved = (document: string): StoredSong => ({ updated: '2026-09-28T11:58:00.000Z', document });
const song = (): string =>
  new DocumentModel({ version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT }).toJson();

describe('offerRestore', () => {
  it('asks nothing when no song was saved', async () => {
    const asked: ConfirmRequest[] = [];
    const ctx = context();
    const answer = (request: ConfirmRequest): Promise<boolean> => {
      asked.push(request);
      return Promise.resolve(true);
    };
    expect(await offerRestore(ctx, null, answer)).toBe(false);
    expect(asked).toEqual([]);
  });

  it('opens the saved song on yes, exactly as exported, on the first part', async () => {
    const ctx = context();
    const text = song();
    expect(await offerRestore(ctx, saved(text), () => Promise.resolve(true))).toBe(true);
    expect(JSON.parse(ctx.model.toJson())).toEqual(JSON.parse(text));
    expect(ctx.parts.selected).toBe(0);
    expect(ctx.model.changed).toBe(false);
  });

  it('leaves the new song on no', async () => {
    const ctx = context();
    const fresh = ctx.model.toJson();
    expect(await offerRestore(ctx, saved(song()), () => Promise.resolve(false))).toBe(false);
    expect(ctx.model.toJson()).toBe(fresh);
  });

  it('reports a record that will not open', async () => {
    const ctx = context();
    expect(await offerRestore(ctx, saved('{not json'), () => Promise.resolve(true))).toBe(false);
    expect(ctx.messages[0]).toMatch(/^error: restore failed: /);
  });

  it('says when the song was saved, and that declining keeps it', () => {
    const request = restoreRequest(saved('{}'));
    expect(request.ok).toBe('Restore');
    expect(request.body).toContain('2026');
    expect(request.body).toContain('kept until your first edit');
    expect(restoreRequest({ updated: 'yesterday', document: '{}' }).body).toContain('yesterday');
  });

  describe('a song in a format this build cannot read', () => {
    /** The exported song with its version bumped, spacing and all. */
    const future = (): string =>
      song().replace(`"version": ${ARRANGEMENT_VERSION},`, '"version": 99,');

    it('asks to download it or start fresh, naming both formats, and never opens it', async () => {
      const ctx = context();
      const fresh = ctx.model.toJson();
      const asked: ConfirmRequest[] = [];
      const downloads: string[] = [];
      const text = future();
      const answer = (request: ConfirmRequest): Promise<boolean> => {
        asked.push(request);
        return Promise.resolve(true);
      };
      const restored = await offerRestore(ctx, saved(text), answer, (body) => downloads.push(body));
      expect(restored).toBe(false);
      expect(asked).toHaveLength(1);
      expect(asked[0]?.ok).toBe('Download the old song');
      expect(asked[0]?.cancel).toBe('Start fresh');
      expect(asked[0]?.body).toContain(
        `saved with song format 99, this build reads ${ARRANGEMENT_VERSION}`,
      );
      expect(asked[0]?.body).toContain('kept until your first edit');
      expect(downloads).toEqual([text]);
      expect(ctx.model.toJson()).toBe(fresh);
      expect(ctx.messages).toEqual([]);
    });

    it('downloads nothing on Start fresh', async () => {
      const ctx = context();
      const downloads: string[] = [];
      const restored = await offerRestore(
        ctx,
        saved(future()),
        () => Promise.resolve(false),
        (body) => downloads.push(body),
      );
      expect(restored).toBe(false);
      expect(downloads).toEqual([]);
    });

    it('is refused whole when a patch in its snapshot is unreadable', () => {
      const doc = JSON.parse(song()) as { patches: Record<string, Record<string, unknown>> };
      const [id] = Object.keys(doc.patches);
      doc.patches[id!] = { ...doc.patches[id!], format: 99 };
      const refusal = songRefusal(JSON.stringify(doc));
      expect(refusal?.patch).toBe(id);
      expect(refusal?.message).toBe(
        `saved with patch format 99 in patch "${id}", this build reads 3`,
      );
    });

    it('refuses an import with the same words, and leaves the readable and the unparsable alone', () => {
      const refusal = songRefusal(future());
      expect(refusal).not.toBeNull();
      expect(importRefusedText('song.json', refusal!)).toBe(
        `import refused: song.json was saved with song format 99, this build reads ${ARRANGEMENT_VERSION}. The file is unchanged.`,
      );
      expect(songRefusal(song())).toBeNull();
      expect(songRefusal('{not json')).toBeNull();
    });
  });
});

describe('bootSong, the reload (windsor#433 decision 9)', () => {
  const STAMP = '2026-10-02T08:00:00.000Z';
  const never = (): Promise<boolean> => {
    throw new Error('asked a question');
  };

  it('reopens an openable named song with no question, and says so', async () => {
    const c = openSessionConsole();
    const text = songText({ name: 'Night Drive', tags: [] }, { bpm: 128 });
    await c.library.write('n', text);
    const asked = vi.fn(never);
    expect(await bootSong(c.ctx, { updated: STAMP, songId: 'n' }, asked)).toBe('opened');
    expect(asked).not.toHaveBeenCalled();
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: 'n' });
    expect(c.ctx.model.toJson()).toBe(text);
    expect(c.toasts).toEqual(['success: reopened Night Drive']);
  });

  it('starts a new song, and says why, when the named song is missing', async () => {
    const c = openSessionConsole();
    const fresh = c.ctx.model.toJson();
    const asked = vi.fn(never);
    expect(await bootSong(c.ctx, { updated: STAMP, songId: 'gone' }, asked)).toBe('new');
    expect(asked).not.toHaveBeenCalled();
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(c.ctx.model.toJson()).toBe(fresh);
    expect(c.toasts).toEqual([
      'warning: your last song is no longer in your songs — this is a new song',
    ]);
  });

  it('starts a new song, and says why, when the named song is in a newer format', async () => {
    const c = openSessionConsole();
    const future = JSON.stringify({ version: 99, meta: { name: 'Later', tags: [] } });
    await c.library.write('later', future);
    expect(await bootSong(c.ctx, { updated: STAMP, songId: 'later' }, never)).toBe('new');
    expect(c.toasts[0]).toMatch(/^warning: your last song, Later, was saved with song format 99/);
    expect(c.records.docMap.get('later')).toBe(future);
  });

  it('offers an untitled record as before', async () => {
    const ctx = context();
    const asked: ConfirmRequest[] = [];
    const answer = (request: ConfirmRequest): Promise<boolean> => {
      asked.push(request);
      return Promise.resolve(true);
    };
    expect(await bootSong(ctx, saved(song()), answer)).toBe('opened');
    expect(asked.map((request) => request.ok)).toEqual(['Restore']);
  });

  describe('a boot delayed behind the database (an older tab blocking the upgrade)', () => {
    it('neither reopens nor asks once the user has edited, and says where the last song is', async () => {
      const c = openSessionConsole();
      await c.library.write('n', songText({ name: 'Night Drive', tags: [] }));
      const touched = touchWatch(c.ctx);
      let resolve: (record: SessionRecord) => void = () => {};
      const load = new Promise<SessionRecord>((done) => (resolve = done));
      c.ctx.change({ transport: { bpm: 141 } });
      const edited = c.ctx.model.toJson();
      resolve({ updated: STAMP, songId: 'n' });
      const asked = vi.fn(never);
      expect(await bootSong(c.ctx, await load, asked, { touched })).toBe('kept');
      expect(asked).not.toHaveBeenCalled();
      expect(c.ctx.model.toJson()).toBe(edited);
      expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
      expect(c.toasts).toEqual(['info: your last song is in your songs — this song stays open']);
    });

    it('asks nothing about an untitled record once the document was replaced (Import)', async () => {
      const c = openSessionConsole();
      const touched = touchWatch(c.ctx);
      await c.ctx.importDoc(JSON.parse(songText({ name: 'Imported', tags: [] })));
      expect(c.ctx.model.changed).toBe(false);
      const asked = vi.fn(never);
      expect(await bootSong(c.ctx, saved(song()), asked, { touched })).toBe('kept');
      expect(asked).not.toHaveBeenCalled();
      expect(c.ctx.model.doc.meta?.name).toBe('Imported');
      expect(c.toasts).toEqual([
        'info: your last session is kept until your first edit — this song stays open',
      ]);
    });

    it('replaces nothing when the user edits while the named song is being read', async () => {
      const c = openSessionConsole();
      await c.library.write('n', songText({ name: 'Night Drive', tags: [] }));
      const touched = touchWatch(c.ctx);
      const doc = c.records.doc;
      let reached: () => void = () => {};
      const reading = new Promise<void>((done) => (reached = done));
      let release: () => void = () => {};
      c.records.doc = (id) => {
        reached();
        return new Promise((done) => (release = (): void => void doc(id).then(done)));
      };
      const booting = bootSong(c.ctx, { updated: STAMP, songId: 'n' }, never, { touched });
      await reading;
      c.ctx.change({ transport: { bpm: 142 } });
      const edited = c.ctx.model.toJson();
      release();
      expect(await booting).toBe('kept');
      expect(c.ctx.model.toJson()).toBe(edited);
      expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
      expect(c.toasts).toEqual(['info: your last song is in your songs — this song stays open']);
    });

    it('boots as usual when nothing was touched', async () => {
      const c = openSessionConsole();
      await c.library.write('n', songText({ name: 'Night Drive', tags: [] }));
      const touched = touchWatch(c.ctx);
      expect(await bootSong(c.ctx, { updated: STAMP, songId: 'n' }, never, { touched })).toBe(
        'opened',
      );
    });
  });
});
