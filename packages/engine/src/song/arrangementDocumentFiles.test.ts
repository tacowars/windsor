/**
 * The JSON test songs under `__fixtures__/arrangementDocuments/` do what
 * their names say. A current-format file is stamped with this build's
 * version as it loads (record `2026-10-01-retire-song-version-3`), so a
 * format bump never has to rewrite the files.
 */
import { describe, expect, it } from 'vitest';

import {
  type CurrentDocumentFile,
  currentDocument,
  rawDocument,
} from '../__fixtures__/arrangementDocumentFiles';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { isShippable, makeArrangement } from './arrangementDocument';

const CURRENT: readonly CurrentDocumentFile[] = [
  'dangling-preset',
  'dangling-return',
  'figure-part',
  'nothing-usable',
  'silent-song',
];

describe('the JSON test songs', () => {
  it("stamps each current-format file with this build's version, and none is refused", () => {
    for (const name of CURRENT) {
      expect(rawDocument(name), name).not.toHaveProperty('version');
      const document = currentDocument(name);
      expect(document['version'], name).toBe(ARRANGEMENT_VERSION);
      expect(makeArrangement(document).refused, name).toBeUndefined();
    }
  });

  it('plays a silent song, which is usable but not shippable', () => {
    const result = makeArrangement(currentDocument('silent-song'));
    expect(result.usable).toBe(true);
    expect(isShippable(result)).toBe(false);
  });

  it('reports the preset a part names but the song does not embed as dangling', () => {
    const result = makeArrangement(currentDocument('dangling-preset'));
    expect(result.usable).toBe(true);
    expect(result.dangling.join('\n')).toMatch(/kick-2/);
  });

  it('reports a send to a bus the code does not define', () => {
    const result = makeArrangement(currentDocument('dangling-return'));
    expect(result.usable).toBe(true);
    expect([...result.dangling, ...result.corrections].join('\n')).toMatch(/cave/);
  });

  it('falls back when nothing usable survives', () => {
    expect(makeArrangement(currentDocument('nothing-usable')).usable).toBe(false);
  });

  it('names the retired four-slot shape, which has no version to refuse', () => {
    const result = makeArrangement(rawDocument('retired-four-slot'));
    expect(result.usable).toBe(false);
    expect(result.refused).toBeUndefined();
    expect(result.corrections[0]).toMatch(/retired four-slot format/);
  });
});
