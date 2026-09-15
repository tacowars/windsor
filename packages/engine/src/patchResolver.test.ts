/**
 * `PatchResolver` (#562): the one place a song's part presets resolve, in its
 * two modes — the game's (the document alone) and the editor's open path (the
 * document, then the library, recorded as a fill).
 *
 * Both modes are the same object with one option, which is the point: the
 * rule the game enforces and the rule the editor relaxes cannot drift apart
 * into two resolvers.
 */
import { describe, expect, it } from 'vitest';

import { PatchResolver } from './arrangementValidate';
import { makePatch } from './patch';

const embedded = makePatch({ name: 'Embedded', volume: 0.11 });
const library = { lead: makePatch({ name: 'Library Lead', volume: 0.99 }) };

describe('the game mode: no library fill', () => {
  const resolver = (): PatchResolver => new PatchResolver({ lead: embedded });

  it('resolves a name the document embeds', () => {
    expect(resolver().lookup('lead')).toBe(embedded);
    expect(resolver().require('arp', 'lead')).toBe(embedded);
  });

  it('resolves nothing the document does not embed, library or not', () => {
    const r = new PatchResolver({});
    expect(r.lookup('lead')).toBeUndefined();
    expect(library.lead).toBeDefined();
    expect(() => r.require('arp', 'lead')).toThrow(
      /^arp: the song document defines no patch "lead"/,
    );
    expect(r.filled).toEqual([]);
  });

  it('never resolves an inherited name', () => {
    const r = new PatchResolver({});
    expect(r.lookup('toString')).toBeUndefined();
    expect(r.lookup('constructor')).toBeUndefined();
  });

  it('reports no fill and a table equal to the document', () => {
    const r = resolver();
    r.lookup('lead');
    expect(r.filled).toEqual([]);
    expect(r.table()).toEqual({ lead: embedded });
  });
});

describe('the editor mode: an explicit library fill', () => {
  const resolver = (document: Record<string, ReturnType<typeof makePatch>> = {}): PatchResolver =>
    new PatchResolver(document, { libraryFill: library });

  it('takes the document over the library where both have the id', () => {
    const r = resolver({ lead: embedded });
    expect(r.lookup('lead')).toBe(embedded);
    // Resolved from the document, so nothing was filled.
    expect(r.filled).toEqual([]);
  });

  it('fills from the library and records the id', () => {
    const r = resolver();
    expect(r.lookup('lead')).toBe(library.lead);
    expect(r.filled).toEqual(['lead']);
    expect(r.table()).toEqual({ lead: library.lead });
  });

  it('records a repeated fill once', () => {
    const r = resolver();
    r.lookup('lead');
    r.lookup('lead');
    expect(r.filled).toEqual(['lead']);
  });

  it('still fails on a name neither has', () => {
    const r = resolver();
    expect(r.lookup('nope')).toBeUndefined();
    expect(() => r.require('drone', 'nope')).toThrow(/drone: .*no patch "nope"/);
    expect(r.filled).toEqual([]);
  });
});
