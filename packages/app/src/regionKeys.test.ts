/** The Song view's region keys (record `2026-10-06-song-region-move-copy-paste`). */
import { describe, expect, it } from 'vitest';

import type { RegionKeyFacts } from './regionKeys';
import { regionKeyAction } from './regionKeys';

const facts = (over: Partial<RegionKeyFacts>): RegionKeyFacts => ({
  key: '',
  command: false,
  shift: false,
  alt: false,
  editing: false,
  inDialog: false,
  ...over,
});

describe('the region keys', () => {
  it('copies, cuts, pastes and duplicates with Cmd or Ctrl', () => {
    expect(regionKeyAction(facts({ key: 'c', command: true }))).toBe('copy');
    expect(regionKeyAction(facts({ key: 'X', command: true }))).toBe('cut');
    expect(regionKeyAction(facts({ key: 'v', command: true }))).toBe('paste');
    expect(regionKeyAction(facts({ key: 'd', command: true }))).toBe('duplicate');
    expect(regionKeyAction(facts({ key: 'z', command: true }))).toBeNull();
    expect(regionKeyAction(facts({ key: 'c' }))).toBeNull();
  });

  it('deletes with Delete or Backspace alone', () => {
    expect(regionKeyAction(facts({ key: 'Delete' }))).toBe('delete');
    expect(regionKeyAction(facts({ key: 'Backspace' }))).toBe('delete');
    expect(regionKeyAction(facts({ key: 'Backspace', command: true }))).toBeNull();
  });

  it('leaves text fields, dialogs and Shift or Alt chords alone', () => {
    expect(regionKeyAction(facts({ key: 'c', command: true, editing: true }))).toBeNull();
    expect(regionKeyAction(facts({ key: 'Delete', inDialog: true }))).toBeNull();
    expect(regionKeyAction(facts({ key: 'v', command: true, shift: true }))).toBeNull();
    expect(regionKeyAction(facts({ key: 'd', command: true, alt: true }))).toBeNull();
  });
});
