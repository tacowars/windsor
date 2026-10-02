import { describe, expect, it } from 'vitest';
import type { SongRow } from './songListModel';
import type { RowActions } from './songRowMenu';
import { liveRowButton, menuItems } from './songRowMenu';

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

describe('the ⋯ button a closing row dialog focuses', () => {
  class Button {
    focused = 0;
    readonly dataset: { songId?: string };
    constructor(
      songId: string,
      public isConnected: boolean,
    ) {
      this.dataset = { songId };
    }
    focus(): void {
      this.focused++;
    }
  }

  it('is the opener while it is still in the page', () => {
    const opener = new Button('a', true);
    expect(liveRowButton(opener, [new Button('a', true)])).toBe(opener);
  });

  it('is the same song’s new button when the clock’s redraw detached the opener', () => {
    // Rename… stayed open through the 10-second refresh, which replaced every row.
    const opener = new Button('b', false);
    const redrawn = [new Button('a', true), new Button('b', true), new Button('c', true)];
    expect(liveRowButton(opener, redrawn)).toBe(redrawn[1]);
  });

  it('is nothing when the song is gone from the table', () => {
    expect(liveRowButton(new Button('b', false), [new Button('a', true)])).toBeNull();
  });
});
