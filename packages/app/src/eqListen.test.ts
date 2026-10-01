import { describe, expect, it } from 'vitest';
import { DEFAULT_EQ, EQ_LISTEN } from '@windsor/engine';
import type { EqSpec } from '@windsor/engine';
import { eqPlot, pointAt } from './eqCurveModel';
import type { ListenFrame } from './eqListen';
import { listenEnds, listenStarts } from './eqListen';
import { eqListenLabel } from './eqTables';

const RATE = 48000;
const plot = eqPlot(12, RATE);
const spec: EqSpec = {
  ...DEFAULT_EQ,
  bands: DEFAULT_EQ.bands.map((b, i) => (i === 3 ? { ...b, type: 'notch', freq: 1240, q: 8 } : b)),
};
const host = (enabled: boolean) => ({
  enabled: () => enabled,
  spec: () => spec,
  plot: () => plot,
  sampleRate: () => RATE,
});

describe('where a listen starts', () => {
  const at = pointAt(spec, 3, plot, RATE);

  it('is a primary press on a point with the switch on', () => {
    expect(listenStarts(host(true), { ...at, button: 0 })).toBe(3);
  });

  it('is nowhere with the switch off, off a point, or with another button', () => {
    expect(listenStarts(host(false), { ...at, button: 0 })).toBe(EQ_LISTEN.off);
    expect(listenStarts(host(true), { x: at.x, y: at.y + 40, button: 0 })).toBe(EQ_LISTEN.off);
    expect(listenStarts(host(true), { ...at, button: 2 })).toBe(EQ_LISTEN.off);
  });
});

describe('when a listen ends', () => {
  const held: ListenFrame = { attached: true, shown: true, began: 'playing', now: 'playing' };

  it('holds while the card is on screen and the transport does not stop', () => {
    expect(listenEnds(held)).toBe(false);
    expect(listenEnds({ ...held, began: 'idle', now: 'idle' }), 'the audition').toBe(false);
    expect(listenEnds({ ...held, began: 'idle', now: 'playing' }), 'play under it').toBe(false);
  });

  it('ends when the card leaves the page or its tab hides', () => {
    expect(listenEnds({ ...held, attached: false })).toBe(true);
    expect(listenEnds({ ...held, shown: false })).toBe(true);
  });

  it('ends when the transport stops or pauses under it', () => {
    expect(listenEnds({ ...held, now: 'idle' })).toBe(true);
    expect(listenEnds({ ...held, now: 'paused' })).toBe(true);
    expect(listenEnds({ ...held, began: 'paused', now: 'idle' })).toBe(true);
  });
});

describe('the pill', () => {
  it('names the band from 1 and its frequency', () => {
    expect(eqListenLabel(3, 1240)).toBe('Listening · band 4 · 1.24kHz');
    expect(eqListenLabel(0, 30)).toBe('Listening · band 1 · 30Hz');
  });
});
