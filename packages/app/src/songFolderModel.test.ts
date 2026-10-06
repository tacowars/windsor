/**
 * The Song tab's folder tracks (windsor#615 decision 1): the row order, the
 * fold, and the outline a group header's lane draws; and when the lane
 * toolbar shows, now that a group's own lanes fold open (windsor#616).
 */
import { describe, expect, it } from 'vitest';

import type { ChannelStrip } from '@windsor/engine';
import {
  type FolderDoc,
  type SongRow,
  refreshFolds,
  refreshGroupFolds,
  lanesOpen,
  memberCountLabel,
  outlineSpans,
  songRows,
  visibleRows,
} from './songFolderModel';

const part = (slot: number, output: ChannelStrip['output'] = 'master') => ({
  slot,
  strip: { output },
});

/** A row as a short string: `A` for group A's header, `1` for slot 1, `A:1` for slot 1 inside A. */
const NAMES = ['A', 'B', 'C', 'D'];
const short = (rows: readonly SongRow[]): string[] =>
  rows.map((row) =>
    row.kind === 'group'
      ? (NAMES[row.id] ?? `g${row.id}`)
      : `${row.group === null ? '' : `${NAMES[row.group]}:`}${row.slot}`,
  );

describe('songRows', () => {
  it('with no groups is every part in slot order', () => {
    const doc: FolderDoc = { parts: [part(2), part(0), part(1)] };
    expect(short(songRows(doc))).toEqual(['0', '1', '2']);
  });

  it('puts a group’s header in its lowest member’s place, its members under it', () => {
    // Parts 1, 3 and 5 to group A (id 0), 2 and 4 to Master: A, (1, 3, 5), 2, 4.
    const doc: FolderDoc = {
      parts: [1, 2, 3, 4, 5].map((slot) => part(slot, slot % 2 ? { group: 0 } : 'master')),
      groups: [{ id: 0 }],
    };
    expect(short(songRows(doc))).toEqual(['A', 'A:1', 'A:3', 'A:5', '2', '4']);
    expect(songRows(doc)[0]).toEqual({ kind: 'group', id: 0, members: [1, 3, 5] });
  });

  it('moves a part routed back to Master into its slot place', () => {
    const doc: FolderDoc = {
      parts: [1, 2, 3, 4, 5].map((slot) =>
        part(slot, slot === 1 || slot === 5 ? { group: 0 } : 'master'),
      ),
      groups: [{ id: 0 }],
    };
    expect(short(songRows(doc))).toEqual(['A', 'A:1', 'A:5', '2', '3', '4']);
  });

  it('puts every part under one header when all play through one group', () => {
    const doc: FolderDoc = {
      parts: [part(0, { group: 1 }), part(1, { group: 1 }), part(2, { group: 1 })],
      groups: [{ id: 1 }],
    };
    expect(short(songRows(doc))).toEqual(['B', 'B:0', 'B:1', 'B:2']);
  });

  it('puts groups no part plays through after every part, in id order', () => {
    const doc: FolderDoc = {
      parts: [part(0), part(1, { group: 2 })],
      groups: [{ id: 3 }, { id: 2 }, { id: 0 }],
    };
    expect(short(songRows(doc))).toEqual(['0', 'C', 'C:1', 'A', 'D']);
    expect(songRows(doc).at(-1)).toEqual({ kind: 'group', id: 3, members: [] });
  });

  it('keeps Sidechain parts with the ungrouped ones, in slot order', () => {
    const doc: FolderDoc = {
      parts: [part(0, 'sidechain'), part(1, { group: 0 }), part(2, 'sidechain'), part(3)],
      groups: [{ id: 0 }],
    };
    expect(short(songRows(doc))).toEqual(['0', 'A', 'A:1', '2', '3']);
  });

  it('follows slots, not places, across gaps', () => {
    const doc: FolderDoc = {
      parts: [part(9, { group: 0 }), part(0), part(4, { group: 1 }), part(6, { group: 0 })],
      groups: [{ id: 0 }, { id: 1 }],
    };
    expect(short(songRows(doc))).toEqual(['0', 'B', 'B:4', 'A', 'A:6', 'A:9']);
  });

  it('treats an Output naming no group as ungrouped', () => {
    const doc: FolderDoc = { parts: [part(0, { group: 5 }), part(1)] };
    expect(short(songRows(doc))).toEqual(['0', '1']);
  });
});

describe('visibleRows', () => {
  const doc: FolderDoc = {
    parts: [part(0, { group: 0 }), part(1), part(2, { group: 0 }), part(3, { group: 1 })],
    groups: [{ id: 0 }, { id: 1 }],
  };

  it('hides a closed group’s members and keeps its header', () => {
    expect(short(visibleRows(songRows(doc), new Set([0])))).toEqual(['A', '1', 'B', 'B:3']);
  });

  it('shows everything while no group is closed', () => {
    expect(visibleRows(songRows(doc), new Set())).toEqual(songRows(doc));
  });
});

describe('outlineSpans', () => {
  it('merges overlapping and touching regions across members into one span', () => {
    const spans = outlineSpans(
      [
        [
          { start: 0, duration: 96 },
          { start: 384, duration: 96 },
        ],
        [{ start: 48, duration: 96 }],
        [{ start: 480, duration: 48 }],
      ],
      1536,
    );
    expect(spans).toEqual([
      { start: 0, duration: 144 },
      { start: 384, duration: 144 },
    ]);
  });

  it('clips to the song and drops what falls outside it', () => {
    expect(
      outlineSpans(
        [
          [
            { start: 0, duration: 4000 },
            { start: 2000, duration: 10 },
          ],
        ],
        1536,
      ),
    ).toEqual([{ start: 0, duration: 1536 }]);
  });

  it('is empty for a group with no members or no regions', () => {
    expect(outlineSpans([], 1536)).toEqual([]);
    expect(outlineSpans([[], []], 1536)).toEqual([]);
  });
});

describe('the header’s count and the fold’s memory', () => {
  it('counts members in words', () => {
    expect([0, 1, 3].map(memberCountLabel)).toEqual(['no parts', '1 part', '3 parts']);
  });

  it('forgets a removed group, so a new one reusing its id starts open', () => {
    const closed = new Set([0, 2]);
    refreshGroupFolds(closed, [{ id: 2 }], false);
    expect([...closed]).toEqual([2]);
  });

  it('forgets every group when another song opens, even one at a kept id', () => {
    const closed = new Set([0, 2]);
    refreshGroupFolds(closed, [{ id: 0 }, { id: 2 }], true);
    expect([...closed]).toEqual([]);
  });
});

describe('the part lane folds (windsor#620)', () => {
  it('forgets a removed part’s slot, so a new part there starts folded', () => {
    const open = new Set([0, 2]);
    refreshFolds(open, [0, 1], false);
    expect([...open]).toEqual([0]);
  });

  it('forgets every part when another song opens, even one at a kept slot', () => {
    const open = new Set([0, 2]);
    refreshFolds(open, [0, 1, 2], true);
    expect([...open]).toEqual([]);
  });
});

describe('the lane toolbar (windsor#616 decision 5)', () => {
  // Group A (id 0) holds parts 1 and 2; part 0 plays to Master; group B (id 1) is empty.
  const doc: FolderDoc = {
    parts: [part(0), part(1, { group: 0 }), part(2, { group: 0 })],
    groups: [{ id: 0 }, { id: 1 }],
  };
  const rows = songRows(doc);
  const none = new Set<number>();

  it('hides while no part’s or group’s lanes are open', () => {
    expect(lanesOpen(rows, { parts: none, groups: none })).toBe(false);
  });

  it('shows while a part’s lanes are open, or a group’s, even an empty group’s', () => {
    expect(lanesOpen(rows, { parts: new Set([2]), groups: none })).toBe(true);
    expect(lanesOpen(rows, { parts: none, groups: new Set([0]) })).toBe(true);
    expect(lanesOpen(rows, { parts: none, groups: new Set([1]) })).toBe(true);
  });

  it('counts a group’s open lanes while its members are folded, not a hidden part’s', () => {
    const folded = visibleRows(rows, new Set([0]));
    expect(lanesOpen(folded, { parts: none, groups: new Set([0]) })).toBe(true);
    expect(lanesOpen(folded, { parts: new Set([1]), groups: none })).toBe(false);
  });

  it('keeps the two folds apart: folding the members leaves the header and its lanes', () => {
    const folded = visibleRows(rows, new Set([0]));
    expect(short(folded)).toEqual(['0', 'A', 'B']);
  });

  it('forgets a removed group’s open lanes too, so a new one reusing its id starts folded', () => {
    const open = new Set([0, 1]);
    refreshGroupFolds(open, [{ id: 0 }], false);
    expect([...open]).toEqual([0]);
  });
});
