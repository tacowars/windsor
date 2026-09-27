/**
 * The card registry covers the engine's kinds (#619 decision 3). The tab looks
 * a part's card up by kind instead of branching, so a kind added to
 * `SEQUENCER_KINDS` without a card would render an empty section on whatever
 * document happens to use it. That fails here instead — and the registry
 * carries no entry the engine does not declare, so a retired kind leaves no
 * dead card behind.
 */
import { describe, expect, it } from 'vitest';

import { SEQUENCER_KINDS } from '../../../packages/client/src/audio/index-for-editor';
import { SEQUENCER_CARDS } from './sequencerCards';
import { KIND_LABELS } from './sequencerConstants';

describe('SEQUENCER_CARDS', () => {
  it('has a card factory for every sequencer kind the engine declares', () => {
    for (const kind of SEQUENCER_KINDS) {
      expect(typeof SEQUENCER_CARDS[kind], kind).toBe('function');
    }
  });

  it('carries no card for a kind the engine does not declare', () => {
    expect(Object.keys(SEQUENCER_CARDS).sort()).toEqual([...SEQUENCER_KINDS].sort());
  });

  it('draws every kind the tab can label, so no section can be headed and left blank', () => {
    expect(Object.keys(SEQUENCER_CARDS).sort()).toEqual(Object.keys(KIND_LABELS).sort());
  });
});
