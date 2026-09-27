/** Real compressor DSP inside the fake graph, including both independent inputs. */
import { FakeContext, FakeWorkletNode } from './fakeAudioContext';
import { BLOCK, FakeNode, FakeParam } from './fakeAudioNodes';
import { compressorParams, loadCompressor } from './compressorHarness';
import { COMPRESSOR_NAME } from '../inserts/compressorConstants';
import { AudioSystem } from '../system/audioSystem';
import { FmEngine } from '../synth/fmEngine';
import { FULL_DOCUMENT } from './fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
export class DetectorNode extends FakeNode {
  readonly kind = 'compressor';
  readonly parameters = new Map<string, FakeParam>();
  readonly dsp = loadCompressor();
  readonly port = Object.assign(new EventTarget(), {
    postMessage: (data: unknown): void => this.dsp.port.onmessage({ data }),
    start(): void {},
    close(): void {},
    onmessage: null,
  });
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 2, 1);
    for (const [key, values] of Object.entries(compressorParams())) {
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? values[0]!));
    }
  }
  protected render(block: number): Float32Array[][] {
    const out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    const params = Object.fromEntries(
      [...this.parameters].map(([key, p]) => [key, new Float32Array([p.value])]),
    );
    this.dsp.process([this.gather(block, 0), this.gather(block, 1)], out, params);
    return out;
  }
}
export function installSidechainWorklet(): () => void {
  const previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = function (
    context: FakeContext,
    name: string,
    options: AudioWorkletNodeOptions,
  ) {
    return name === COMPRESSOR_NAME
      ? new DetectorNode(context, options)
      : new FakeWorkletNode(context, name, options);
  } as unknown as typeof AudioWorkletNode;
  return (): void => {
    globalThis.AudioWorkletNode = previous;
  };
}
export async function sidechainRig(
  doc: ArrangementDocument = FULL_DOCUMENT,
  defer = (run: () => void): void => run(),
): Promise<{ system: AudioSystem; context: FakeContext }> {
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), { defer });
  await system.init();
  system.initMusic(doc);
  return { system, context };
}
