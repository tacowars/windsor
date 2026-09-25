/**
 * The context half of the headless graph stand-in: node factories, the worklet
 * module registry, a global `AudioWorkletNode` that builds the real reverb
 * processor or a test-fed source, and the block loop that renders it all.
 *
 * `FmEngine` and `AudioSystem` are handed a `FakeContext` in place of an
 * `AudioContext`; nothing in them notices. The plate return runs the real
 * plate (`worklet/reverb/`, bundled to `worklet/generated/reverb-processor.js`)
 * through `reverbHarness.ts`; an `fm-part` node plays whatever `Feed` the test
 * assigns, multiplied by its `gain` param the way the worklet's fader is, so
 * post-fader taps behave as they do live.
 *
 * Node-only, by design: excluded from the client's tsc build.
 */
import { PROCESSOR_NAME, REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import type { FakeHost } from './fakeAudioNodes';
import { FakeConstantSource, FakeOscillator, FakePeriodicWave } from './fakeOscillator';
import { FakeWaveShaper } from './fakeWaveShaper';
import {
  BLOCK,
  FakeBiquad,
  FakeCompressor,
  FakeDelay,
  FakeDestination,
  FakeGain,
  FakeMerger,
  FakeNode,
  FakeParam,
  FakeSplitter,
} from './fakeAudioNodes';
import type { Feed, LoadedReverb, ReverbProcessorLike } from './reverbHarness';
import { loadReverb } from './reverbHarness';

export const SAMPLE_RATE = 48000;

let reverbModule: LoadedReverb | null = null;

export class FakeContext implements FakeHost {
  readonly sampleRate = SAMPLE_RATE;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly nodes: FakeNode[] = [];
  readonly workletNodes: FakeWorkletNode[] = [];
  readonly delays: FakeDelay[] = [];
  /** Every URL handed to `addModule`, as a string, in order. */
  readonly modules: string[] = [];
  private readonly registered = new Set<string>();
  readonly destination: FakeDestination;

  readonly audioWorklet = {
    addModule: async (url: string | URL): Promise<void> => {
      const text = String(url);
      this.modules.push(text);
      if (text.includes('fm-processor')) this.registered.add(PROCESSOR_NAME);
      if (text.includes('reverb-processor')) this.registered.add(REVERB_PROCESSOR_NAME);
    },
  };

  constructor() {
    this.destination = new FakeDestination(this);
  }

  register(node: FakeNode): void {
    this.nodes.push(node);
    if (node instanceof FakeDelay) this.delays.push(node);
    if (node instanceof FakeWorkletNode) this.workletNodes.push(node);
  }

  isRegistered(processorName: string): boolean {
    return this.registered.has(processorName);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }

  createChannelSplitter(outputs = 6): FakeSplitter {
    return new FakeSplitter(this, outputs);
  }

  createChannelMerger(inputs = 6): FakeMerger {
    return new FakeMerger(this, inputs);
  }

  createDelay(maxDelayTime = 1): FakeDelay {
    return new FakeDelay(this, maxDelayTime);
  }

  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createConstantSource(): FakeConstantSource {
    return new FakeConstantSource(this);
  }

  createPeriodicWave(
    real: Float32Array | number[],
    imag: Float32Array | number[],
    constraints?: PeriodicWaveConstraints,
  ): FakePeriodicWave {
    if (real.length !== imag.length || real.length < 2) {
      throw new Error('createPeriodicWave: real and imag must match, with at least two terms');
    }
    return new FakePeriodicWave(
      Float32Array.from(real),
      Float32Array.from(imag),
      constraints?.disableNormalization ?? false,
    );
  }

  createWaveShaper(): FakeWaveShaper {
    return new FakeWaveShaper(this);
  }

  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }

  /** Cast for handing to code typed against the real API. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

interface WorkletOptions {
  numberOfInputs?: number;
  numberOfOutputs?: number;
  processorOptions?: unknown;
}

export class FakeWorkletNode extends FakeNode {
  readonly kind = 'worklet';
  readonly name: string;
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  readonly port = {
    postMessage: (message: unknown): void => {
      this.posted.push(message);
    },
    onmessage: null,
  };
  /** For an `fm-part` node: what it plays. Silence until a test assigns one. */
  feed: Feed | null = null;
  private readonly processor: ReverbProcessorLike | null = null;
  private readonly values: Record<string, Float32Array> = {};

  constructor(context: FakeContext, name: string, options: WorkletOptions = {}) {
    super(context, options.numberOfInputs ?? 1, options.numberOfOutputs ?? 1);
    this.name = name;
    if (!context.isRegistered(name)) {
      throw new Error(`AudioWorkletNode: processor "${name}" not registered (addModule first)`);
    }
    if (name === REVERB_PROCESSOR_NAME) {
      reverbModule ??= loadReverb();
      this.processor = reverbModule.create();
      for (const d of reverbModule.descriptors) {
        this.parameters.set(d.name, new FakeParam(d.defaultValue, d.minValue, d.maxValue));
        this.values[d.name] = new Float32Array([d.defaultValue]);
      }
    } else if (name === PROCESSOR_NAME) {
      this.parameters.set('pitchBend', new FakeParam(0, -24, 24));
      this.parameters.set('modWheel', new FakeParam(0, 0, 1));
      this.parameters.set('cutoffMod', new FakeParam(0, -1, 1));
      this.parameters.set('gain', new FakeParam(1, 0, 4));
    } else {
      throw new Error(`fake AudioWorkletNode does not model processor "${name}"`);
    }
  }

  protected render(block: number): Float32Array[][] {
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    if (this.processor) {
      const channels = this.gather(block);
      const inL = channels[0] ?? new Float32Array(BLOCK);
      const inR = channels[1] ?? inL;
      for (const [name, param] of this.parameters) {
        const slot = this.values[name];
        if (slot) slot[0] = param.value;
      }
      this.processor.process([[inL, inR]], [[left, right]], this.values);
      return [[left, right]];
    }
    this.feed?.(block, left, right);
    const gain = this.parameters.get('gain')?.value ?? 1;
    for (let i = 0; i < BLOCK; i++) {
      left[i] = (left[i] ?? 0) * gain;
      right[i] = (right[i] ?? 0) * gain;
    }
    return [[left, right]];
  }
}

/** Point the global `AudioWorkletNode` at the fake. Returns the undo. */
export function installFakeAudioWorklet(): () => void {
  const scope = globalThis as { AudioWorkletNode?: unknown };
  const previous = scope.AudioWorkletNode;
  scope.AudioWorkletNode = FakeWorkletNode;
  return () => {
    if (previous === undefined) delete scope.AudioWorkletNode;
    else scope.AudioWorkletNode = previous;
  };
}

/** The `fm-part` node behind a part, to give it something to play. */
export function sourceOf(part: { node: AudioWorkletNode }): FakeWorkletNode {
  const node = part.node as unknown as FakeWorkletNode;
  if (!(node instanceof FakeWorkletNode) || node.name !== PROCESSOR_NAME) {
    throw new Error('part is not backed by a fake fm-part node');
  }
  return node;
}

export interface Capture {
  left: Float32Array;
  right: Float32Array;
}

/**
 * Render `seconds` of the graph. Every tap's output is captured; the
 * destination is always pulled, so anything reachable from it advances whether
 * or not a tap names it. `onBlock` runs before each block renders -- the
 * seam for changing a parameter mid-render.
 */
export function renderGraph(
  context: FakeContext,
  seconds: number,
  taps: readonly FakeNode[] = [],
  onBlock?: (block: number, time: number) => void,
): Capture[] {
  const blocks = Math.round((seconds * context.sampleRate) / BLOCK);
  const captures = taps.map(() => ({
    left: new Float32Array(blocks * BLOCK),
    right: new Float32Array(blocks * BLOCK),
  }));

  for (let b = 0; b < blocks; b++) {
    context.currentTime = (b * BLOCK) / context.sampleRate;
    onBlock?.(b, context.currentTime);
    for (const delay of context.delays) delay.pull(b);
    taps.forEach((tap, t) => {
      const channels = tap.pull(b);
      const l = channels[0] ?? new Float32Array(BLOCK);
      const r = channels[1] ?? l;
      captures[t]?.left.set(l, b * BLOCK);
      captures[t]?.right.set(r, b * BLOCK);
    });
    context.destination.pull(b);
    for (const delay of context.delays) delay.commit(b);
  }
  return captures;
}
