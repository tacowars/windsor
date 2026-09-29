/**
 * Which stems a song exports and how they split into passes (windsor#41):
 * parts by slot with the "Sidechain only" ones left out unless asked for,
 * the returns an audible part sends to, and passes as wide as the channel
 * limit and the pass budget allow.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { RENDER_STEM_CHANNELS_MAX, RENDER_STEM_PASS_MAX_SAMPLES } from './renderConstants';
import { passChannels, planStemPasses, stemSources } from './stemPlan';

/** FULL_DOCUMENT with one part's strip changed. */
function withStrip(slot: number, strip: object): ArrangementDocument {
  return {
    ...FULL_DOCUMENT,
    parts: FULL_DOCUMENT.parts.map((part) =>
      part.slot === slot ? { ...part, strip: { ...part.strip, ...strip } } : part,
    ),
  };
}

describe('stemSources', () => {
  it('lists every part by slot, then the returns a part sends to', () => {
    expect(stemSources(FULL_DOCUMENT)).toEqual([
      { kind: 'part', slot: 0, name: 'kick', muted: false },
      { kind: 'part', slot: 1, name: 'hat', muted: false },
      { kind: 'part', slot: 2, name: 'arp', muted: false },
      { kind: 'part', slot: 3, name: 'drone', muted: false },
      { kind: 'return', name: 'room' },
      { kind: 'return', name: 'echo' },
    ]);
  });

  it('orders parts by slot whatever the document order', () => {
    const reversed = { ...FULL_DOCUMENT, parts: [...FULL_DOCUMENT.parts].reverse() };
    expect(stemSources(reversed).map((s) => (s.kind === 'part' ? s.slot : s.name))).toEqual([
      0,
      1,
      2,
      3,
      'room',
      'echo',
    ]);
  });

  it('skips a "Sidechain only" part unless asked, and its sends feed no return', () => {
    // The hat is the only part sending to the echo.
    const song = withStrip(FULL_SLOT.hat, { output: 'sidechain' });
    const names = (choice = {}): string[] => stemSources(song, choice).map((s) => s.name);
    expect(names()).toEqual(['kick', 'arp', 'drone', 'room']);
    expect(names({ includeMuted: true })).toEqual(['kick', 'hat', 'arp', 'drone', 'room']);
    expect(stemSources(song, { includeMuted: true })[1]).toMatchObject({ muted: true });
  });

  it('leaves out a return nobody sends to', () => {
    const song = withStrip(FULL_SLOT.hat, { sends: { echo: 0 } });
    expect(stemSources(song).filter((s) => s.kind === 'return')).toEqual([
      { kind: 'return', name: 'room' },
    ]);
  });
});

describe('planStemPasses', () => {
  it('renders up to 15 stems beside the master in one 32-channel pass', () => {
    expect(RENDER_STEM_CHANNELS_MAX).toBe(32);
    expect(planStemPasses(10, 48000)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(planStemPasses(15, 48000)).toHaveLength(1);
    expect(planStemPasses(16, 48000)).toEqual([Array.from({ length: 15 }, (_, i) => i), [15]]);
    expect(passChannels(15)).toBe(32);
  });

  it('renders the master alone when there is no stem', () => {
    expect(planStemPasses(0, 48000)).toEqual([[]]);
  });

  it('narrows the passes for a long song, within the budget', () => {
    // A 4-minute song at 48 kHz: 22 channels would pass the budget.
    const frames = 4 * 60 * 48000;
    const passes = planStemPasses(10, frames);
    expect(passes.length).toBeGreaterThan(1);
    const widest = Math.max(...passes.map((p) => passChannels(p.length)));
    expect(widest * frames).toBeLessThanOrEqual(RENDER_STEM_PASS_MAX_SAMPLES);
    expect(passes.flat()).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  it('refuses when not even one stem fits beside the master', () => {
    expect(() => planStemPasses(1, 100, { maxChannels: 3, maxSamples: 1e9 })).toThrow(RangeError);
    expect(() => planStemPasses(1, 100, { maxChannels: 32, maxSamples: 399 })).toThrow(RangeError);
    expect(planStemPasses(1, 100, { maxChannels: 32, maxSamples: 400 })).toEqual([[0]]);
  });
});
