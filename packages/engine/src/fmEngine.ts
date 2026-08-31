/**
 * Owns the `AudioContext`, the worklet module, and the parts built on it.
 *
 * There is exactly one `AudioContext` in the client. Babylon's audio engine is
 * handed this one rather than creating its own -- see `babylonBridge.ts`.
 */
import type { AudioBus, BusOptions } from './audioBus';
import { createBus } from './audioBus';
import { AudioPart } from './audioPart';
import type { Patch } from './patch';
import { clonePatch, makePatch } from './patch';
import { PRESETS } from './presets';
import type { ProcessorOptions } from './workletMessages';
import { PROCESSOR_NAME, WORKLET_URL } from './workletMessages';

export interface PartOptions {
  patch?: Patch;
  /** Name from `PRESETS`. Ignored when `patch` is given. */
  preset?: string;
  /** Sounding voice limit. The pool holds a few more, for steal fade-outs. */
  maxVoices?: number;
  /** Defaults to the engine master. Pass `null` to leave the part unrouted. */
  destination?: AudioNode | null;
}

export class FmEngine {
  readonly context: AudioContext;

  /** Everything routes through here, so one fader ducks the whole synth. */
  readonly master: GainNode;

  private readonly limiter: DynamicsCompressorNode;
  private readonly parts = new Map<string, AudioPart>();
  private moduleLoaded = false;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' });

    this.master = this.context.createGain();
    this.master.gain.value = 0.9;

    // Catches the sum of many parts peaking together; individual presets are
    // already level-matched so this should rarely engage.
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    this.master.connect(this.limiter);
    this.limiter.connect(this.context.destination);
  }

  get isReady(): boolean {
    return this.moduleLoaded;
  }

  /** Load the DSP module. Must be awaited before `createPart`. */
  async init(): Promise<void> {
    if (this.moduleLoaded) return;
    await this.context.audioWorklet.addModule(WORKLET_URL);
    this.moduleLoaded = true;
  }

  /** Browsers start contexts suspended; call from a click or key handler. */
  async unlock(): Promise<AudioContextState> {
    if (this.context.state !== 'running') await this.context.resume();
    return this.context.state;
  }

  createPart(name: string, options: PartOptions = {}): AudioPart {
    if (!this.moduleLoaded) {
      throw new Error('FmEngine.init() must be awaited before createPart()');
    }
    if (this.parts.has(name)) {
      throw new Error(`audio part "${name}" already exists`);
    }

    const patch = resolvePatch(options);
    const processorOptions: ProcessorOptions = {
      maxVoices: options.maxVoices ?? 16,
      patch: structuredClone(patch),
    };

    const node = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });

    const part = new AudioPart(name, node, patch);
    const destination = options.destination === undefined ? this.master : options.destination;
    if (destination) part.connect(destination);

    this.parts.set(name, part);
    return part;
  }

  getPart(name: string): AudioPart | undefined {
    return this.parts.get(name);
  }

  createBus(options: BusOptions = {}, destination?: AudioNode): AudioBus {
    const bus = createBus(this.context, options);
    bus.output.connect(destination ?? this.master);
    return bus;
  }

  allNotesOff(): void {
    for (const part of this.parts.values()) part.allNotesOff();
  }

  dispose(): void {
    for (const part of this.parts.values()) part.dispose();
    this.parts.clear();
    this.master.disconnect();
    this.limiter.disconnect();
  }
}

function resolvePatch(options: PartOptions): Patch {
  if (options.patch) return options.patch;
  if (options.preset) {
    const preset = PRESETS[options.preset];
    if (!preset) throw new Error(`unknown audio preset "${options.preset}"`);
    return clonePatch(preset);
  }
  return makePatch();
}
