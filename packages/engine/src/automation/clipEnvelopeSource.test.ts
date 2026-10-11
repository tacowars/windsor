/**
 * Where a part's clip envelopes are at a transport tick (windsor#702): the
 * region's own local tick and its roll's loop tick, as the roll's performer
 * reads them, for a part of regions and for the free-running ∞ region; and
 * no source for a part whose regions play no envelope.
 */
import { describe, expect, it } from 'vitest';

import {
  ENVELOPE_SONG_TICKS,
  envPoint,
  envelope,
  rollPart,
  rollPattern,
} from '../__fixtures__/clipEnvelopeRig';
import { clipEnvelopeSource, emptyClipEnvelopeFrame } from './clipEnvelopeSource';

const RISE = envelope('filter.cutoff', [envPoint(0, -1), envPoint(95, 1)]);

describe('clipEnvelopeSource', () => {
  it('reads a region’s local tick mod its roll’s loop, on every pass of the song', () => {
    const part = rollPart([
      { start: 96, duration: 192, pattern: rollPattern(48, [RISE]) },
      { start: 288, duration: 96, pattern: rollPattern(96, []) },
    ]);
    const source = clipEnvelopeSource(part, ENVELOPE_SONG_TICKS)!;
    const frame = emptyClipEnvelopeFrame();
    expect(source.frameAt(95, frame)).toBe(false);
    expect(source.frameAt(96 + 100, frame)).toBe(true);
    expect(frame).toEqual({
      envelopes: [RISE],
      loopTicks: 48,
      entryTick: 96,
      localTick: 100,
      loopTick: 4,
    });
    // The song's second pass enters the region again, at its own tick 0.
    expect(source.frameAt(ENVELOPE_SONG_TICKS + 96, frame)).toBe(true);
    expect(frame).toMatchObject({ entryTick: ENVELOPE_SONG_TICKS + 96, localTick: 0, loopTick: 0 });
    // A region whose roll has no envelope plays none.
    expect(source.frameAt(300, frame)).toBe(false);
  });

  it('free-runs the ∞ region on the transport tick, as the roll does', () => {
    const part = rollPart([
      { start: 0, duration: ENVELOPE_SONG_TICKS, pattern: rollPattern(100, [RISE]) },
    ]);
    const frame = emptyClipEnvelopeFrame();
    expect(
      clipEnvelopeSource(part, ENVELOPE_SONG_TICKS)!.frameAt(ENVELOPE_SONG_TICKS + 5, frame),
    ).toBe(true);
    expect(frame).toMatchObject({
      entryTick: 0,
      localTick: ENVELOPE_SONG_TICKS + 5,
      loopTick: (ENVELOPE_SONG_TICKS + 5) % 100,
    });
  });

  it('is null for a part none of whose regions plays an envelope', () => {
    const silent = [
      envelope('filter.cutoff', [], true),
      envelope('lfo.amount', [envPoint(0, 1)], false),
    ];
    const part = rollPart([{ start: 0, duration: 96, pattern: rollPattern(96, silent) }]);
    expect(clipEnvelopeSource(part, ENVELOPE_SONG_TICKS)).toBeNull();
    const grid = { regions: [{ start: 0, duration: 96 }], sequencer: { kind: 'none' as const } };
    expect(clipEnvelopeSource(grid, ENVELOPE_SONG_TICKS)).toBeNull();
  });
});
