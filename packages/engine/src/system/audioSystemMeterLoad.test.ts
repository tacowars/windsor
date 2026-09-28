/**
 * The `meterLoad` option (windsor#51 decision 6): the live system turns the
 * load sampler on in every part, return and worklet insert (#445); the
 * offline render's system turns it on nowhere, so no processor samples its
 * own timing during an export.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FakeContext,
  FakeWorkletNode,
  installFakeAudioWorklet,
} from '../__fixtures__/fakeAudioContext';
import { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { compressorParams } from '../__fixtures__/compressorHarness';
import { COMPRESSOR_NAME } from '../inserts/compressorConstants';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import { PRESETS } from '../patch/presets';
import { FmEngine } from '../synth/fmEngine';
import type { AudioSystemOptions } from './audioSystem';
import { AudioSystem } from './audioSystem';

/** A compressor processor the graph stand-in can build: its parameters and a port. */
class CompressorNode extends FakeNode {
  readonly kind = 'compressor';
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  readonly port = Object.assign(new EventTarget(), {
    postMessage: (data: unknown): void => {
      this.posted.push(data);
    },
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null,
  });
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 2, 1);
    for (const [key, values] of Object.entries(compressorParams())) {
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? values[0]!));
    }
  }
  protected render(block: number): Float32Array[][] {
    return [this.gather(block)];
  }
}

let restore: () => void = () => {};
afterEach(() => {
  vi.unstubAllGlobals();
  restore();
});

/** A system with one part carrying a compressor, and how many of its nodes were asked to report load. */
async function meteredRig(
  options: AudioSystemOptions,
): Promise<{ system: AudioSystem; reporting: number }> {
  restore = installFakeAudioWorklet();
  vi.stubGlobal(
    'AudioWorkletNode',
    function (context: FakeContext, name: string, init: AudioWorkletNodeOptions) {
      return name === COMPRESSOR_NAME
        ? new CompressorNode(context, init)
        : new FakeWorkletNode(context, name, init);
    },
  );
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), {
    ...options,
    defer: (run) => run(),
  });
  await system.init();
  system.createMusicPart('drone', PRESETS['pad-drift']!);
  system.strip('drone')!.setInserts([DEFAULT_COMPRESSOR]);
  const reporting = context.nodes.filter((node) =>
    ((node as Partial<{ posted: unknown[] }>).posted ?? []).some(
      (message) => (message as { type?: string }).type === 'reportLoad',
    ),
  ).length;
  return { system, reporting };
}

describe('load metering', () => {
  it('meters the parts, the returns and the inserts of the live system', async () => {
    const { system, reporting } = await meteredRig({});
    // The part, the plate return and the compressor, at least.
    expect(system.meteredProcessors).toBeGreaterThanOrEqual(3);
    expect(reporting).toBe(system.meteredProcessors);
  });

  it('attaches no load meter anywhere with meterLoad: false', async () => {
    const { system, reporting } = await meteredRig({ meterLoad: false });
    expect(system.meteredProcessors).toBe(0);
    expect(reporting).toBe(0);
  });
});
