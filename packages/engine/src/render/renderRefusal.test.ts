/**
 * The render's frame caps (windsor#822 decision 3): `RENDER_MAX_FRAMES` for
 * the in-memory exports, and `RENDER_STREAM_MAX_FRAMES` for the streamed
 * Save as, which must hold the longest song the format holds at 48 kHz with
 * the longest tail. Pure checks over `renderRefusal` and the frame plan; the
 * refusal of the in-memory cap itself is `renderSong.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { BARS_MAX, BPM_MIN } from '../audioConstants';
import { DEFAULT_MASTER } from '../mixer/masterSpec';
import { OUTPUT_STAGE_MODES } from '../mixer/outputStageConstants';
import { METERS } from '../sequencing/meterTables';
import type { ArrangementDocument } from '../song/arrangementDocument';
import {
  RENDER_MAX_FRAMES,
  RENDER_STREAM_MAX_FRAMES,
  RENDER_TAIL_SECONDS,
} from './renderConstants';
import { planFor, renderRefusal, renderSong, songSeconds } from './renderSong';

describe('the frame caps', () => {
  const longest: ArrangementDocument = {
    ...FULL_DOCUMENT,
    transport: { ...FULL_DOCUMENT.transport, bpm: BPM_MIN, bars: BARS_MAX },
  };

  it('the stream cap holds the longest song the format holds, at 48 kHz with the longest tail', () => {
    // The longest meter by songSeconds, then that song in every output stage mode.
    const inMeter = (meter: (typeof METERS)[number]): ArrangementDocument => ({
      ...longest,
      transport: { ...longest.transport, meter },
    });
    const longestMeter = [...METERS].sort(
      (a, b) => songSeconds(inMeter(b)) - songSeconds(inMeter(a)),
    )[0]!;
    expect(longestMeter).toBe('12/8');
    expect(songSeconds(inMeter(longestMeter)) / 60).toBeCloseTo(76.8, 6);
    const options = { sampleRate: 48000, tailSeconds: RENDER_TAIL_SECONDS.max };
    for (const mode of OUTPUT_STAGE_MODES) {
      for (const lookahead of [false, true]) {
        const song: ArrangementDocument = {
          ...inMeter(longestMeter),
          master: {
            ...DEFAULT_MASTER,
            ...longest.master,
            output: { mode, ceilingDb: -1, lookahead },
          },
        };
        expect(renderRefusal(song, options, RENDER_STREAM_MAX_FRAMES)).toBeNull();
        // Within two seconds of the cap: the cap is that song's length, not a round guess.
        const frames = planFor(song, options).totalFrames;
        expect(RENDER_STREAM_MAX_FRAMES - frames).toBeLessThan(2 * 48000);
      }
    }
    expect(RENDER_STREAM_MAX_FRAMES).toBe(48000 * 60 * 77);
  });

  it('refuses past the cap it is given, and says what to change', () => {
    const thirty: ArrangementDocument = {
      ...FULL_DOCUMENT,
      transport: { ...FULL_DOCUMENT.transport, bpm: 30, bars: 225 },
    };
    const options = { sampleRate: 48000, tailSeconds: 2 };
    expect(renderRefusal(thirty, options, RENDER_STREAM_MAX_FRAMES)).toBeNull();
    expect(renderRefusal(thirty, options)).toBe(
      'the song and its tail run 30.0 minutes, longer than the 15.0 minutes this export can ' +
        'hold at this sample rate — choose a lower sample rate, a shorter tail, fewer bars or a ' +
        'faster tempo',
    );
    expect(renderRefusal(thirty, options, RENDER_MAX_FRAMES, 'use Save as…')).toMatch(
      / — use Save as…$/,
    );
  });

  it('renderSong refuses past the cap it is given, before any context is built', async () => {
    const contexts: unknown[] = [];
    const render = renderSong(
      FULL_DOCUMENT,
      {
        sampleRate: 8000,
        createContext: (init) => {
          contexts.push(init);
          return new FakeOfflineContext(init);
        },
      },
      1000,
    );
    await expect(render).rejects.toThrow(/this export can hold/);
    expect(contexts).toHaveLength(0);
  });
});
