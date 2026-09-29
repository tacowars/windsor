/**
 * The offline render through the output stage (windsor#93 decision 9): the
 * master WAV starts on bar 1 in every mode, whatever the stage delays it by,
 * and the stems line up with it at offset 0.
 *
 * The headless graph runs the real generated stage. The fake `fm-part` plays
 * a tone per part while its notes sound (`noteFeeds.ts`), as in
 * `renderStems.test.ts`. A quiet song passes every mode untouched, so its
 * master must be the same in all of them, frame for frame, and equal to the
 * stems' sum; a hot one must stay under the ceiling from its first block.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { noteToneFeed } from '../__fixtures__/noteFeeds';
import type { OutputStageSettings } from '../mixer/outputStageSpec';
import { dbToGain, outputStageLatency } from '../mixer/outputStageDsp';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { RENDER_QUANTUM_FRAMES } from './renderConstants';
import { planFor, renderSong, songSeconds } from './renderSong';
import { renderStems } from './renderStems';

const partsBuilt = new WeakMap<object, number>();

class TonePart extends FakeWorkletNode {
  constructor(context: FakeContext, name: string, options: { processorOptions?: unknown } = {}) {
    super(context, name, options);
    const probe = (context as Partial<FakeOfflineContext>).length === RENDER_QUANTUM_FRAMES;
    if (name !== PROCESSOR_NAME || probe) return;
    const index = partsBuilt.get(context) ?? 0;
    partsBuilt.set(context, index + 1);
    this.feed = noteToneFeed(this, 180 + 211 * index, 0.3);
  }
}

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = TonePart;
});
afterAll(() => restore());

const RATE = 8000;
const TAIL = 0.25;
const create = (init: ConstructorParameters<typeof FakeOfflineContext>[0]) =>
  new FakeOfflineContext(init);

const SETTINGS: OutputStageSettings[] = [
  { mode: 'limiter', ceilingDb: -1, lookahead: false },
  { mode: 'limiter', ceilingDb: -1, lookahead: true },
  { mode: 'soft', ceilingDb: -1, lookahead: false },
  { mode: 'hard', ceilingDb: -1, lookahead: false },
  { mode: 'off', ceilingDb: -1, lookahead: false },
];

const song = (level: number, output: OutputStageSettings): ArrangementDocument => ({
  ...FULL_DOCUMENT,
  master: { level, inserts: [], output },
});

const peak = (channel: Float32Array): number =>
  channel.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

describe('the render through the output stage', () => {
  it('plans the stage latency on top of the song, and reads the master past it', () => {
    for (const output of SETTINGS) {
      const plan = planFor(song(1, output), { sampleRate: RATE, tailSeconds: TAIL });
      expect(plan.latencyFrames).toBe(outputStageLatency(output, RATE));
      expect(plan.masterStart).toBe(plan.leadFrames + plan.latencyFrames);
      expect(plan.totalFrames).toBe(plan.masterStart + plan.outputFrames);
    }
    expect(outputStageLatency(SETTINGS[1]!, RATE)).toBe(12);
    expect(outputStageLatency(SETTINGS[2]!, RATE)).toBe(15);
  });

  it('starts the master on bar 1 in every mode: a quiet song comes out the same in all of them', async () => {
    const quiet = 0.35;
    const renders = [];
    for (const output of SETTINGS) {
      renders.push(
        await renderSong(song(quiet, output), {
          sampleRate: RATE,
          tailSeconds: TAIL,
          createContext: create,
        }),
      );
    }
    const frames = Math.round(songSeconds(FULL_DOCUMENT) * RATE) + Math.round(TAIL * RATE);
    const [reference] = renders;
    expect(peak(reference!.channels[0]!)).toBeGreaterThan(0.1);
    expect(peak(reference!.channels[0]!.subarray(0, RENDER_QUANTUM_FRAMES))).toBeGreaterThan(1e-3);
    for (const render of renders) {
      for (const channel of render.channels) expect(channel).toHaveLength(frames);
      expect(render.channels).toEqual(reference!.channels);
    }
  }, 30_000);

  it('lines the stems up with the master at offset 0 in every mode', async () => {
    for (const output of SETTINGS) {
      const handed: Float32Array[][] = [];
      await renderStems(
        song(0.35, output),
        { sampleRate: RATE, tailSeconds: TAIL, createContext: create },
        async ({ channels }) => void handed.push(channels.map((c) => c.slice())),
      );
      const [master, ...stems] = handed;
      let error = 0;
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < master![c]!.length; i++) {
          let sum = 0;
          for (const stem of stems) sum += stem[c]![i]!;
          error = Math.max(error, Math.abs(sum - master![c]![i]!));
        }
      }
      expect(error, `${output.mode} lookahead ${output.lookahead}`).toBeLessThan(1e-6);
    }
  }, 30_000);

  it('keeps a hot song under the ceiling from its first block, but for Off', async () => {
    for (const output of SETTINGS) {
      const render = await renderSong(song(4, output), {
        sampleRate: RATE,
        tailSeconds: TAIL,
        createContext: create,
      });
      const [left] = render.channels;
      expect(peak(left!.subarray(0, RENDER_QUANTUM_FRAMES))).toBeGreaterThan(1e-3);
      if (output.mode === 'off') expect(peak(left!)).toBeGreaterThan(1);
      else expect(peak(left!)).toBeLessThanOrEqual(Math.fround(dbToGain(output.ceilingDb)));
    }
  }, 30_000);
});
