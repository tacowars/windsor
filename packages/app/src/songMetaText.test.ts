/**
 * A song's name and tags as text edits (windsor#433): a stored song's `meta`
 * replaced with the rest of its text kept, a template's copy, and the name
 * an imported file offers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import { fileNameAmend, nameFromFile, templateCopy, withMeta } from './songMetaText';

beforeAll(() => loadBuiltIns());

describe('withMeta', () => {
  it('normalises the new meta as the engine does, and keeps the rest of the text', () => {
    const text = songText({ name: 'Old', tags: ['a'] });
    const next = withMeta(text, { name: '  New  ', tags: ['Techno', 'techno', ' '] });
    expect(JSON.parse(next).meta).toEqual({ name: 'New', tags: ['techno'] });
    expect(next).toBe(text.replace('"name": "Old"', '"name": "New"').replace('"a"', '"techno"'));
  });

  it('drops meta when it holds nothing, as the normaliser does', () => {
    const next = withMeta(songText({ name: 'Old', tags: [] }), { name: '', tags: [] });
    expect(JSON.parse(next).meta).toBeUndefined();
    expect(next).toBe(songText());
  });
});

describe('templateCopy', () => {
  it('empties the name and drops only the template tag', () => {
    const raw = JSON.parse(songText({ name: 'Kit', tags: ['template', 'techno'] }));
    expect((templateCopy(raw) as { meta: unknown }).meta).toEqual({ name: '', tags: ['techno'] });
  });
});

describe('the imported file name', () => {
  it('drops .json, in any case', () => {
    expect(nameFromFile('Warehouse Jam.json')).toBe('Warehouse Jam');
    expect(nameFromFile('LOOP.JSON')).toBe('LOOP');
    expect(nameFromFile('notes.txt')).toBe('notes.txt');
  });

  it('names only a song without a name, keeping its tags', () => {
    const unnamed = new DocumentModel(JSON.parse(songText({ name: '', tags: ['x'] }))).doc;
    expect(fileNameAmend('a.json')(unnamed)).toEqual({ meta: { name: 'a', tags: ['x'] } });
    const named = new DocumentModel(JSON.parse(songText({ name: 'Mine', tags: [] }))).doc;
    expect(fileNameAmend('a.json')(named)).toBeNull();
    expect(fileNameAmend('.json')(unnamed)).toBeNull();
  });
});
