import { describe, expect, it } from 'vitest';
import type { SongListEntry } from './songLibrary';
import type { SongFilter, SongListView } from './songListModel';
import {
  ALL_SONGS,
  activeFilter,
  addTags,
  filterChips,
  initialTags,
  keyLabel,
  relativeTime,
  songList,
  tagSuggestions,
  withOpenFacts,
} from './songListModel';

const NOW = new Date(2026, 9, 2, 12, 0, 0);
const at = (...parts: [number, number, number, number?, number?, number?]): string =>
  new Date(...(parts as [number, number, number, number, number, number])).toISOString();

const song = (id: string, over: Partial<SongListEntry> = {}): SongListEntry => ({
  id,
  version: 6,
  name: id,
  tags: [],
  bpm: 120,
  meter: '4/4',
  bars: 16,
  key: { root: 0, scale: 'major' },
  created: at(2026, 8, 1),
  updated: at(2026, 8, 1),
  revision: 1,
  refusal: null,
  ...over,
});

/** The mockup's seven songs. */
const SONGS: SongListEntry[] = [
  song('acid', {
    name: 'Acid sketch 3',
    tags: ['techno', 'acid'],
    bpm: 132,
    key: { root: 9, scale: 'naturalMinor' },
    created: at(2026, 8, 25),
    updated: at(2026, 9, 2, 11, 59, 48),
  }),
  song('warehouse', {
    name: 'Warehouse 0400',
    tags: ['techno'],
    bars: 64,
    created: at(2026, 8, 24),
    updated: at(2026, 9, 1, 23, 41),
  }),
  song('kick', {
    name: 'Kick study',
    meter: '7/8',
    created: at(2026, 8, 28),
    updated: at(2026, 8, 28),
  }),
  song('dub', {
    name: 'dub chords',
    tags: ['dub', 'ambient'],
    created: at(2026, 8, 20),
    updated: at(2026, 8, 27),
  }),
  song('tide', {
    name: 'Slow tide',
    tags: ['ambient'],
    created: at(2026, 8, 22),
    updated: at(2026, 8, 22),
  }),
  song('starter', {
    name: 'Techno starter',
    tags: ['template', 'techno'],
    updated: at(2026, 8, 20),
  }),
  song('bed', { name: 'Ambient bed', tags: ['template', 'ambient'], updated: at(2026, 8, 19) }),
];

const view = (over: Partial<SongListView> = {}): SongListView => ({
  query: '',
  filter: ALL_SONGS,
  sort: 'edited',
  ...over,
});
const ids = (over: Partial<SongListView> = {}): string[] =>
  songList(SONGS, view(over), { openId: null, now: NOW }).rows.map((row) => row.id);
const tag = (name: string): SongFilter => ({ kind: 'tag', tag: name });

describe('the filter chips', () => {
  it('reads all, each tag in use sorted, ★ template, untagged', () => {
    expect(filterChips(SONGS).map((chip) => chip.label)).toEqual([
      'all',
      'acid',
      'ambient',
      'dub',
      'techno',
      '★ template',
      'untagged',
    ]);
    expect(filterChips(SONGS).filter((chip) => chip.template)).toHaveLength(1);
  });

  it('keeps all, ★ template and untagged on an empty library', () => {
    expect(filterChips([]).map((chip) => chip.label)).toEqual(['all', '★ template', 'untagged']);
  });

  it('falls back to all when the filter tag is no longer in use', () => {
    expect(activeFilter(SONGS, tag('house'))).toEqual(ALL_SONGS);
    expect(activeFilter(SONGS, tag('dub'))).toEqual(tag('dub'));
  });
});

describe('filtering and search', () => {
  it('shows every song under all', () => {
    expect(ids()).toHaveLength(SONGS.length);
  });

  it('shows the songs carrying a tag', () => {
    expect(ids({ filter: tag('ambient'), sort: 'name' })).toEqual(['bed', 'dub', 'tide']);
  });

  it('shows the templates under template', () => {
    expect(ids({ filter: tag('template'), sort: 'name' })).toEqual(['bed', 'starter']);
  });

  it('shows the songs with no tag under untagged', () => {
    expect(ids({ filter: { kind: 'untagged' } })).toEqual(['kick']);
  });

  it('searches the name, ignoring case', () => {
    expect(ids({ query: 'TECHNO', sort: 'name' })).toEqual(['starter']);
    expect(ids({ query: '  dub ' })).toEqual(['dub']);
    expect(ids({ query: 'study', filter: tag('techno') })).toEqual([]);
  });

  it('counts the shown rows against every song', () => {
    const list = songList(SONGS, view({ filter: tag('techno') }), { openId: null, now: NOW });
    expect([list.shown, list.total]).toEqual([3, 7]);
    expect(songList([], view(), { openId: null, now: NOW })).toEqual({
      rows: [],
      shown: 0,
      total: 0,
    });
  });
});

describe('the sorts', () => {
  it('orders by last edited, newest first', () => {
    expect(ids()).toEqual(['acid', 'warehouse', 'kick', 'dub', 'tide', 'starter', 'bed']);
  });

  it('orders by name, A to Z ignoring case', () => {
    expect(ids({ sort: 'name' })).toEqual([
      'acid',
      'bed',
      'dub',
      'kick',
      'tide',
      'starter',
      'warehouse',
    ]);
  });

  it('orders by created, newest first, then by name', () => {
    expect(ids({ sort: 'created' })).toEqual([
      'kick',
      'acid',
      'warehouse',
      'tide',
      'dub',
      'bed',
      'starter',
    ]);
  });
});

describe('the rows', () => {
  const rows = songList(SONGS, view({ sort: 'name' }), { openId: 'acid', now: NOW }).rows;
  const byId = (id: string) => rows.find((row) => row.id === id)!;

  it('marks the open song and the templates', () => {
    expect(rows.filter((row) => row.open).map((row) => row.id)).toEqual(['acid']);
    expect(rows.filter((row) => row.template).map((row) => row.id)).toEqual(['bed', 'starter']);
  });

  it('reads the cells as the mockup does', () => {
    expect(byId('acid')).toMatchObject({
      bpm: '132',
      meter: '4/4',
      bars: '16',
      key: 'A naturalMinor',
      edited: '12 s ago',
    });
    expect(byId('kick').meter).toBe('7/8');
    expect(byId('warehouse').edited).toBe('yesterday 23:41');
    expect(byId('kick').edited).toBe('28 Sep');
  });

  it('carries the refusal of a song this build cannot read', () => {
    const refusal = {
      format: 'song' as const,
      found: 99,
      reads: 6,
      message: 'saved with song format 99, this build reads 6',
    };
    const [row] = songList([song('old', { refusal, bpm: null, key: null })], view(), {
      openId: null,
      now: NOW,
    }).rows;
    expect(row).toMatchObject({ refusal: refusal.message, bpm: '—', key: '—' });
  });

  it('names a song with no name Untitled', () => {
    expect(
      songList([song('x', { name: '' })], view(), { openId: null, now: NOW }).rows[0]?.name,
    ).toBe('Untitled');
  });

  it('shows the open song as the document has it before the index catches up', () => {
    const facts = {
      version: 6,
      name: 'Acid sketch 4',
      tags: ['acid'],
      bpm: 140,
      meter: '4/4',
      bars: 16,
      key: null,
    };
    const patched = withOpenFacts(SONGS, 'acid', facts);
    expect(patched[0]).toMatchObject({
      id: 'acid',
      name: 'Acid sketch 4',
      tags: ['acid'],
      bpm: 140,
    });
    expect(patched[1]).toBe(SONGS[1]);
  });
});

describe('relative times', () => {
  it('reads seconds, minutes, today, yesterday, a date, and another year', () => {
    expect(relativeTime(at(2026, 9, 2, 11, 59, 48), NOW)).toBe('12 s ago');
    expect(relativeTime(at(2026, 9, 2, 11, 55), NOW)).toBe('5 min ago');
    expect(relativeTime(at(2026, 9, 2, 9, 12), NOW)).toBe('today 09:12');
    expect(relativeTime(at(2026, 9, 1, 23, 41), NOW)).toBe('yesterday 23:41');
    expect(relativeTime(at(2026, 8, 28), NOW)).toBe('28 Sep');
    expect(relativeTime(at(2025, 11, 31), NOW)).toBe('31 Dec 2025');
  });

  it('reads a time in the future as now, and a non-date as written', () => {
    expect(relativeTime(at(2026, 9, 2, 12, 0, 30), NOW)).toBe('0 s ago');
    expect(relativeTime('whenever', NOW)).toBe('whenever');
  });

  it('spells a key with the console names', () => {
    expect(keyLabel({ root: 3, scale: 'dorian' })).toBe('D# dorian');
    expect(keyLabel(null)).toBe('—');
  });
});

describe('tags in Save as…', () => {
  it('suggests the tags in use, sorted, with template always last', () => {
    expect(tagSuggestions(SONGS, [])).toEqual(['acid', 'ambient', 'dub', 'techno', 'template']);
    expect(tagSuggestions([], [])).toEqual(['template']);
  });

  it('leaves out the tags already chosen', () => {
    expect(tagSuggestions(SONGS, ['techno', 'template'])).toEqual(['acid', 'ambient', 'dub']);
  });

  it('preselects the tag filter that is on', () => {
    expect(initialTags(['acid'], SONGS, tag('techno'))).toEqual(['acid', 'techno']);
    expect(initialTags(['acid'], SONGS, tag('acid'))).toEqual(['acid']);
    expect(initialTags([], SONGS, tag('template'))).toEqual(['template']);
    expect(initialTags(['acid'], SONGS, ALL_SONGS)).toEqual(['acid']);
    expect(initialTags(['acid'], SONGS, { kind: 'untagged' })).toEqual(['acid']);
  });

  it('never preselects a tag the last song carrying it has lost', () => {
    // The filter still names `house`, but no song carries it: the chips fall
    // back to `all`, and Save as… must not quietly bring the tag back.
    const stale = tag('house');
    expect(activeFilter(SONGS, stale)).toEqual(ALL_SONGS);
    expect(initialTags(['acid'], SONGS, stale)).toEqual(['acid']);
    expect(initialTags([], SONGS, stale)).toEqual([]);
  });

  it('adds typed tags trimmed, lowercased, once each, a comma parting several', () => {
    expect(addTags(['dub'], ' Techno , dub,,Acid ')).toEqual(['dub', 'techno', 'acid']);
    expect(addTags([], '   ')).toEqual([]);
  });
});
