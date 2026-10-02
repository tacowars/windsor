/**
 * A song's own name and tags (windsor#440): the `meta` section normalises,
 * cuts and reports by path, is absent when it holds nothing, and round-trips
 * through `makeArrangement` and serialisation unchanged.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from './arrangementDocument';
import { FieldNormaliser } from './arrangementFields';
import { normaliseSongMeta } from './songMetaNormalise';
import { SONG_META_LIMITS, TEMPLATE_TAG } from './songMetaTables';

const read = (raw: unknown, limits = SONG_META_LIMITS) => {
  const n = new FieldNormaliser();
  return { meta: normaliseSongMeta(raw, n, limits), corrections: n.corrections };
};

const exported = (document: unknown): string => JSON.stringify(makeArrangement(document).document);

describe('normaliseSongMeta', () => {
  it('trims the name, lowercases and dedupes the tags, and reports only the non-string', () => {
    const { meta, corrections } = read({
      name: '  Acid sketch 3 ',
      tags: ['Techno', 'acid', 'techno', '', 7],
    });
    expect(meta).toEqual({ name: 'Acid sketch 3', tags: ['techno', 'acid'] });
    expect(corrections).toEqual(['meta.tags[4]: 7 is not a tag — dropped']);
  });

  it('is absent when the name is empty and there are no tags', () => {
    expect(read(undefined)).toEqual({ meta: undefined, corrections: [] });
    expect(read({ name: '   ', tags: [' ', ''] })).toEqual({ meta: undefined, corrections: [] });
    expect(read({})).toEqual({ meta: undefined, corrections: [] });
  });

  it('keeps a name with no tags and tags with no name', () => {
    expect(read({ name: 'Untagged' }).meta).toEqual({ name: 'Untagged', tags: [] });
    expect(read({ tags: [TEMPLATE_TAG] }).meta).toEqual({ name: '', tags: ['template'] });
  });

  it('replaces a junk name with an empty one, reported', () => {
    const { meta, corrections } = read({ name: 42, tags: ['dub'] });
    expect(meta).toEqual({ name: '', tags: ['dub'] });
    expect(corrections).toEqual(['meta.name: 42 is not a name — using ""']);
  });

  it('drops a junk section and a junk tag list, reported', () => {
    expect(read('Acid')).toEqual({
      meta: undefined,
      corrections: ['meta: "Acid" is not an object — dropped'],
    });
    expect(read({ name: 'x', tags: 'acid' })).toEqual({
      meta: { name: 'x', tags: [] },
      corrections: ['meta.tags: "acid" is not a list of tags — dropped'],
    });
  });

  it('drops unknown keys, reported', () => {
    const { meta, corrections } = read({ name: 'x', tags: [], id: 'abc', created: 1 });
    expect(meta).toEqual({ name: 'x', tags: [] });
    expect(corrections).toEqual([
      'meta.id: unknown key dropped',
      'meta.created: unknown key dropped',
    ]);
  });

  it('cuts a long name, reported', () => {
    const { meta, corrections } = read({ name: 'a'.repeat(SONG_META_LIMITS.nameLength + 5) });
    expect(meta?.name).toBe('a'.repeat(SONG_META_LIMITS.nameLength));
    expect(corrections).toEqual([
      `meta.name: longer than ${SONG_META_LIMITS.nameLength} characters — cut`,
    ]);
  });

  it('cuts by code point, never splitting a surrogate pair', () => {
    const limits = { ...SONG_META_LIMITS, nameLength: 2 };
    expect(read({ name: '🎹🎹🎹' }, limits).meta?.name).toBe('🎹🎹');
  });

  it('cuts a long tag, then drops the repeat it becomes, reported once', () => {
    const limits = { ...SONG_META_LIMITS, tagLength: 4 };
    const { meta, corrections } = read({ tags: ['acid', 'ACIDHOUSE'] }, limits);
    expect(meta?.tags).toEqual(['acid']);
    expect(corrections).toEqual(['meta.tags[1]: longer than 4 characters — cut']);
  });

  it('keeps the first tags up to the count limit, reported', () => {
    const tags = Array.from({ length: SONG_META_LIMITS.tagCount + 3 }, (_, i) => `t${i}`);
    const { meta, corrections } = read({ tags });
    expect(meta?.tags).toEqual(tags.slice(0, SONG_META_LIMITS.tagCount));
    expect(corrections).toEqual([
      `meta.tags: ${tags.length} tags — only the first ${SONG_META_LIMITS.tagCount} are kept`,
    ]);
  });
});

describe('meta in the document', () => {
  it('carries a normalised meta through makeArrangement', () => {
    const result = makeArrangement(song([KICK], { meta: { name: ' Acid ', tags: ['Acid'] } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.meta).toEqual({ name: 'Acid', tags: ['acid'] });
  });

  it('round-trips a document with meta unchanged', () => {
    const first = makeArrangement(song([KICK], { meta: { name: 'Acid', tags: ['acid', 'dub'] } }));
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toEqual(first.document);
    expect(JSON.stringify(second.document)).toBe(JSON.stringify(first.document));
  });

  it('writes no meta for an empty one: the export is byte-identical to one without', () => {
    const without = exported(song([KICK]));
    expect(without).not.toContain('"meta"');
    expect(exported(song([KICK], { meta: { name: '', tags: [] } }))).toBe(without);
  });

  it('reports a bad meta by path without refusing the song', () => {
    const result = makeArrangement(song([KICK], { meta: { name: 'x', colour: 'red' } }));
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual(['meta.colour: unknown key dropped']);
    expect(result.document.meta).toEqual({ name: 'x', tags: [] });
  });
});
