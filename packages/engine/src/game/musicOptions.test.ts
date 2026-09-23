import { describe, expect, it } from 'vitest';

import { musicDocumentFromQuery, musicEnabledFromQuery } from './musicOptions';

describe('musicEnabledFromQuery', () => {
  it('is on by default and off only at music=0', () => {
    expect(musicEnabledFromQuery('')).toBe(true);
    expect(musicEnabledFromQuery('?debug=1')).toBe(true);
    expect(musicEnabledFromQuery('?music=1')).toBe(true);
    expect(musicEnabledFromQuery('?music=0')).toBe(false);
    expect(musicEnabledFromQuery('?debug=1&music=0')).toBe(false);
  });
});

describe('musicDocumentFromQuery', () => {
  it('is the default (null) when absent, empty, 0 or 1', () => {
    expect(musicDocumentFromQuery('')).toBeNull();
    expect(musicDocumentFromQuery('?music=')).toBeNull();
    expect(musicDocumentFromQuery('?music=0')).toBeNull();
    expect(musicDocumentFromQuery('?music=1')).toBeNull();
  });

  it('names the committed document to play otherwise', () => {
    expect(musicDocumentFromQuery('?music=bed-02')).toBe('bed-02');
    expect(musicDocumentFromQuery('?debug=1&music=night')).toBe('night');
  });
});
