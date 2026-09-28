/**
 * The opening of a song render through the real FM processor (windsor#40):
 * a note at tick 0 must sound in the file's first block.
 *
 * Every `fm-part` here runs the generated worklet (`workletHarness.ts`), and
 * its port behaves as a browser's does: a posted message is a task, handed to
 * the processor only once the page yields to its event loop. An offline
 * context renders straight through until it reaches a suspend, so a note
 * posted before `startRendering()` arrives after the blocks it was meant for.
 * The first test pins that race in this stand-in; the second shows the render
 * never runs into it, because the opening goes to each processor at
 * construction (`ProcessorOptions.events`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeWorkletNode, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { BLOCK } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { FmEngine } from '../synth/fmEngine';
import type { ProcessorOptions } from '../synth/workletMessages';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { renderSong } from './renderSong';

const loaded = loadProcessor();
/** The harness evaluates the worklet at one rate; the render runs at it. */
const RATE = loaded.sampleRate;
/** Far above the plate's anti-denormal offset (~1e-20): a note is sounding. */
const AUDIBLE = 1e-3;

/** An `fm-part` backed by the real processor, its port delivering as a task. */
class ProcessorWorkletNode extends FakeWorkletNode {
  constructor(context: FakeContext, name: string, options: { processorOptions?: unknown } = {}) {
    super(context, name, options);
    if (name !== PROCESSOR_NAME) return;
    // A browser serialises the options at construction; so does this.
    const opts = structuredClone(options.processorOptions) as ProcessorOptions;
    const processor: ProcessorLike = loaded.create(opts.patch, opts.maxVoices, opts.seed ?? null, {
      ...(opts.slideSeconds === undefined ? {} : { slideSeconds: opts.slideSeconds }),
      events: (opts.events ?? []) as ScheduledEvent[],
    });
    this.port.postMessage = (message: unknown): void => {
      this.posted.push(message);
      const copy = structuredClone(message) as ScheduledEvent;
      setTimeout(() => processor.inbox(copy), 0);
    };
    const params: Record<string, Float32Array> = {};
    for (const [key, param] of this.parameters) params[key] = new Float32Array([param.value]);
    // The fake applies the `gain` parameter after the feed.
    params.gain = new Float32Array([1]);
    this.feed = (block, left, right) => {
      loaded.setFrame(block * BLOCK);
      processor.process([], [[left, right]], params);
    };
  }
}

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = ProcessorWorkletNode;
});
afterAll(() => restore());

const peak = (samples: Float32Array): number =>
  samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

describe('the opening of a render, through the real FM processor', () => {
  it('loses a note posted before rendering starts: the race the render avoids', async () => {
    const context = new FakeOfflineContext({
      numberOfChannels: 2,
      length: 4 * BLOCK,
      sampleRate: RATE,
    });
    const engine = new FmEngine(context.asAudioContext());
    await engine.init();
    engine.createPart('probe', { seed: 1 }).noteOn(60, 1, 0);
    const buffer = await context.startRendering();
    expect(peak(buffer.getChannelData(0))).toBe(0);
  });

  it('sounds a tick-0 note in the file’s first block', async () => {
    const oneBar: ArrangementDocument = {
      ...FULL_DOCUMENT,
      transport: { ...FULL_DOCUMENT.transport, bars: 1 },
    };
    const rendered = await renderSong(oneBar, {
      sampleRate: RATE,
      tailSeconds: 0,
      createContext: (init) => new FakeOfflineContext(init),
    });
    // Bar 1 is the file's first sample (the lead-in before tick 0 is
    // trimmed), and the kick is on the downbeat.
    expect(peak(rendered.channels[0]!.subarray(0, BLOCK))).toBeGreaterThan(AUDIBLE);
  });
});
