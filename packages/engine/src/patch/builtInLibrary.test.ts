import { describe, expect, it } from 'vitest';

import { loadBuiltInLibrary } from './builtInLibrary';
import { PATCH_LIBRARY } from './presets';

describe('loadBuiltInLibrary', () => {
  it('resolves to the whole-bank table', async () => {
    expect(await loadBuiltInLibrary()).toBe(PATCH_LIBRARY);
  });
});
