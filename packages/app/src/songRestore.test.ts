/**
 * Restoring the last session (`2026-09-27-user-library-in-indexeddb`,
 * decision 1): asked first, opened through `importDoc` like a file, and a
 * record that will not open is reported and left alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '@windsor/engine';
import { FULL_ARRANGEMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import type { ConfirmRequest } from './metadataModal';
import type { StoredSong } from './songAutosave';
import { importRefusedText, offerRestore, restoreRequest, songRefusal } from './songRestore';
import { newSong } from './songParts';

beforeAll(() => loadBuiltIns());

function context(): AppCtx & { messages: string[] } {
  const model = new DocumentModel(newSong());
  const messages: string[] = [];
  return {
    model,
    messages,
    parts: { selected: 2 },
    importDoc: (raw: unknown) => model.open(raw),
    notify: (message: string) => messages.push(message),
  } as unknown as AppCtx & { messages: string[] };
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
    expect(ctx.messages[0]).toMatch(/^restore failed: /);
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
        `saved with patch format 99 in patch "${id}", this build reads 2`,
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
