import { describe, expect, it } from 'vitest';
import type { SongRow } from './songListModel';
import type { RowActions } from './songRowMenu';
import { menuItems } from './songRowMenu';

const row = (over: Partial<SongRow> = {}): SongRow => ({
  id: 'a',
  name: 'Warehouse 0400',
  tags: ['techno'],
  bpm: '128',
  meter: '4/4',
  bars: '64',
  key: 'F naturalMinor',
  edited: 'yesterday 23:41',
  open: false,
  template: false,
  refusal: null,
  ...over,
});

const labels = (r: SongRow): string[] => {
  const { items, danger } = menuItems(r);
  return [...items.map((item) => item.label), danger.label];
};

describe('a row menu', () => {
  it('offers Open, Rename…, Edit tags…, Duplicate, Export .json, then Delete…', () => {
    expect(labels(row())).toEqual([
      'Open',
      'Rename…',
      'Edit tags…',
      'Duplicate',
      'Export .json',
      'Delete…',
    ]);
  });

  it('has no Open on the open song', () => {
    expect(labels(row({ open: true }))).not.toContain('Open');
  });

  it('keeps only Export .json and Delete… for a song this build cannot open', () => {
    expect(labels(row({ refusal: 'saved with song format 99, this build reads 6' }))).toEqual([
      'Export .json',
      'Delete…',
    ]);
  });
});

describe('a row menu item that opens a dialog', () => {
  it('hands the dialog the row’s ⋯ button as its opener, since the item itself is removed', () => {
    const more = { label: '⋯' } as unknown as HTMLElement;
    const seen: Record<string, HTMLElement | undefined> = {};
    const record =
      (name: string) =>
      (_row: SongRow, opener?: HTMLElement): void => {
        seen[name] = opener;
      };
    const actions: RowActions = {
      open: record('open'),
      newFrom: record('newFrom'),
      rename: record('rename'),
      editTags: record('editTags'),
      duplicate: record('duplicate'),
      exportJson: record('exportJson'),
      remove: record('remove'),
    };
    const { items, danger } = menuItems(row());
    for (const item of [...items, danger]) item.run(actions, row(), more);
    expect(seen.rename).toBe(more);
    expect(seen.editTags).toBe(more);
    expect(seen.remove).toBe(more);
  });
});
