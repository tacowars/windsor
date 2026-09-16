/**
 * Part-list operations on a song document (#597): removing a part prunes its
 * embedded patch only when no remaining part plays the same preset.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from './__fixtures__/fullArrangement';
import { makeArrangement } from './arrangementDocument';
import { musicPartName, partAt, removePart } from './documentParts';

const { kick, hat, arp, drone } = FULL_SLOT;

describe('removePart', () => {
  it('drops the part and the patch only it played', () => {
    const next = removePart(FULL_DOCUMENT, arp);
    expect(next.parts.map((p) => p.slot)).toEqual([kick, hat, drone]);
    expect(Object.keys(next.patches ?? {}).sort()).toEqual(['drone-sqr', 'hat', 'kick']);
    // The input is untouched.
    expect(FULL_DOCUMENT.parts).toHaveLength(4);
    expect(FULL_DOCUMENT.patches['saw-arp']).toBeDefined();
    // And the result is still a clean document.
    const renormalised = makeArrangement(JSON.parse(JSON.stringify(next)));
    expect(renormalised.corrections).toEqual([]);
    expect(renormalised.dangling).toEqual([]);
  });

  it('keeps a patch another part still plays', () => {
    const shared = withDocumentPart(FULL_DOCUMENT, 'drone', { preset: 'saw-arp' });
    const withoutArp = removePart(shared, arp);
    expect(withoutArp.patches?.['saw-arp']).toBeDefined();
    // Removing its last user drops it.
    const withoutBoth = removePart(withoutArp, drone);
    expect(withoutBoth.patches?.['saw-arp']).toBeUndefined();
    expect(withoutBoth.parts.map((p) => p.slot)).toEqual([kick, hat]);
  });

  it('keeps a patch the document embeds under another id untouched', () => {
    const next = removePart(FULL_DOCUMENT, kick);
    expect(next.patches?.hat).toBe(FULL_DOCUMENT.patches.hat);
  });

  it('never removes the last part, and ignores a slot the song does not hold', () => {
    const one = { ...FULL_DOCUMENT, parts: FULL_DOCUMENT.parts.slice(0, 1) };
    expect(removePart(one, kick)).toBe(one);
    expect(removePart(FULL_DOCUMENT, 6)).toBe(FULL_DOCUMENT);
  });

  it('drops the patches section when nothing is left in it', () => {
    const hatPatch = FULL_DOCUMENT.patches.hat;
    if (!hatPatch) throw new Error('the fixture embeds hat');
    const two = {
      ...FULL_DOCUMENT,
      parts: FULL_DOCUMENT.parts.slice(0, 2),
      patches: { hat: hatPatch },
    };
    const lone = removePart(two, hat);
    expect(lone.patches).toBeUndefined();
  });
});

describe('slot addressing', () => {
  it('finds a part by slot and names its engine part by slot, never by label', () => {
    expect(partAt(FULL_DOCUMENT, drone)?.name).toBe('drone');
    expect(partAt(FULL_DOCUMENT, 7)).toBeUndefined();
    expect(musicPartName(drone)).toBe('music-3');
  });
});
