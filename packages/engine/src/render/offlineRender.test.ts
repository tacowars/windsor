/**
 * `renderPatchToBuffer`'s option plumbing (#563): the editor's loudness check
 * renders through this with a seed, sixteen voices and an inlined worklet
 * URL. Web Audio is stubbed — what is under test is what reaches the
 * processor, not the DSP (that is `packages/app/lib/loudnessRender.test.mjs`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPatchToBuffer } from './offlineRender';
import { makePatch } from '../patch/patch';
import type { ProcessorOptions } from '../synth/workletMessages';
import { PROCESSOR_NAME, WORKLET_URL } from '../synth/workletMessages';

interface Captured {
  url: string | URL | undefined;
  name: string | undefined;
  options: ProcessorOptions | undefined;
  frames: number;
  sampleRate: number;
}

function stubWebAudio(): Captured {
  const captured: Captured = {
    url: undefined,
    name: undefined,
    options: undefined,
    frames: 0,
    sampleRate: 0,
  };
  class FakeOfflineAudioContext {
    destination = {};
    audioWorklet = {
      addModule: (url: string | URL): Promise<void> => {
        captured.url = url;
        return Promise.resolve();
      },
    };
    constructor(_channels: number, frames: number, sampleRate: number) {
      captured.frames = frames;
      captured.sampleRate = sampleRate;
    }
    startRendering(): Promise<string> {
      return Promise.resolve('buffer');
    }
  }
  class FakeAudioWorkletNode {
    constructor(_context: unknown, name: string, init: { processorOptions: ProcessorOptions }) {
      captured.name = name;
      captured.options = init.processorOptions;
    }
    connect(): void {}
  }
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe('renderPatchToBuffer', () => {
  it('keeps the game defaults: four voices, no seed, the module beside the source', async () => {
    const captured = stubWebAudio();
    await renderPatchToBuffer(makePatch());
    expect(captured.url).toBe(WORKLET_URL);
    expect(captured.name).toBe(PROCESSOR_NAME);
    expect(captured.options?.maxVoices).toBe(4);
    expect(captured.options?.seed).toBeUndefined();
    expect('seed' in (captured.options ?? {})).toBe(false);
  });

  it('hands a seed, the voice count and the worklet URL to the processor', async () => {
    const captured = stubWebAudio();
    const patch = makePatch({ name: 'probe' });
    const sampleRate = 48000;
    const duration = 12000 / sampleRate;
    const tail = (400 * 128 - 12000) / sampleRate;
    await renderPatchToBuffer(patch, {
      note: 60,
      velocity: 0.9,
      duration,
      tail,
      sampleRate,
      maxVoices: 16,
      seed: 7,
      workletUrl: 'data:application/javascript,',
    });
    expect(captured.url).toBe('data:application/javascript,');
    expect(captured.sampleRate).toBe(sampleRate);
    expect(captured.frames).toBe(400 * 128);
    expect(captured.options).toEqual({
      maxVoices: 16,
      patch,
      events: [
        { type: 'noteOn', id: 1, note: 60, velocity: 0.9, frame: 0 },
        { type: 'noteOff', id: 1, frame: 12000 },
      ],
      seed: 7,
    });
    // A clone, so the caller's patch is not shared with the processor.
    expect(captured.options?.patch).not.toBe(patch);
  });
});
