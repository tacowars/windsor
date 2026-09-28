/**
 * Restoring the last session (`2026-09-27-user-library-in-indexeddb`,
 * decision 1): asked first, opened through `importDoc` like a file, and a
 * record that will not open is reported and left alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import type { ConfirmRequest } from './metadataModal';
import type { StoredSong } from './songAutosave';
import { offerRestore, restoreRequest } from './songRestore';
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
const song = (): string => new DocumentModel({ version: 3, ...FULL_ARRANGEMENT }).toJson();

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
});
