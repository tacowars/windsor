import { describe, expect, it } from 'vitest';

import { musicEnabledFromQuery } from './musicOptions';

describe('musicEnabledFromQuery', () => {
  it('is on by default and off only at music=0', () => {
    expect(musicEnabledFromQuery('')).toBe(true);
    expect(musicEnabledFromQuery('?debug=1')).toBe(true);
    expect(musicEnabledFromQuery('?music=1')).toBe(true);
    expect(musicEnabledFromQuery('?music=0')).toBe(false);
    expect(musicEnabledFromQuery('?debug=1&music=0')).toBe(false);
  });
});
