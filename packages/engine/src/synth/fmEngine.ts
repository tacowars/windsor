/**
 * Owns the `AudioContext`, the worklet module, and the parts built on it.
 *
 * The context is the caller's or the engine's own; every part, bus and
 * return built on the engine shares its clock. The console hands in one
 * context and rebuilds engines on it (`packages/app/src/host.ts`).
 */
import { PART_MAX_VOICES_DEFAULT, SLIDE_SECONDS_DEFAULT } from '../audioConstants';
import type { AudioBus, BusOptions } from '../mixer/audioBus';
import { createBus } from '../mixer/audioBus';
import {
  PEAK_METER_WORKLET_URL,
  COMPRESSOR_WORKLET_URL,
  RETRO_REVERB_WORKLET_URL,
  PHASER_WORKLET_URL,
  ADVANCED_DRIVE_WORKLET_URL,
  DELAY_WORKLET_URL,
} from './workletMessages';
import { AudioPart } from './audioPart';
import type { Patch } from '../patch/patch';
import { makePatch } from '../patch/patch';
import type { ProcessorOptions } from './workletMessages';
import { PROCESSOR_NAME, REVERB_WORKLET_URL, WORKLET_URL } from './workletMessages';

export interface PartOptions {
  /**
   * The patch this part plays. The engine resolves no names (#562): a song's
   * patch comes from its document and any other from its caller, so the
   * whole-bank table is not a runtime import.
   */
  patch?: Patch;
  /** Sounding voice limit. The pool holds a few more, for steal fade-outs. */
  maxVoices?: number;
  /** Defaults to the engine master. Pass `null` to leave the part unrouted. */
  destination?: AudioNode | null;
  /**
   * Pins the processor's random source (`ProcessorOptions.seed`). Live parts
   * omit it; an offline song render (`render/renderSong.ts`) passes one per
   * part so two renders are bit-identical (windsor#40).
   */
  seed?: number;
}

/**
 * Where to load the DSP from. The defaults are `new URL(…, import.meta.url)`,
 * which Vite resolves in the dev server and the build; a standalone page such
 * as the arrangement console (#70) has no such URL and passes its own.
 */
export interface WorkletUrls {
  fmUrl?: string | URL;
  reverbUrl?: string | URL;
  compressorUrl?: string | URL;
  meterUrl?: string | URL;
  retroReverbUrl?: string | URL;
  phaserUrl?: string | URL;
  advancedDriveUrl?: string | URL;
  delayUrl?: string | URL;
}

export class FmEngine {
  readonly context: AudioContext;

  /** Everything routes through here, so one fader ducks the whole synth. */
  readonly master: GainNode;

  private readonly limiter: DynamicsCompressorNode;
  private readonly parts = new Map<string, AudioPart>();
  /** What every part created from now on is told (#629); the worklet's own default is off. */
  private liveRetune = false;
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

  /** Load the DSP modules. Must be awaited before `createPart` or a reverb return. */
  async init(urls: WorkletUrls = {}): Promise<void> {
    if (this.moduleLoaded) return;
    await this.context.audioWorklet.addModule(urls.fmUrl ?? WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.reverbUrl ?? REVERB_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.compressorUrl ?? COMPRESSOR_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.meterUrl ?? PEAK_METER_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.retroReverbUrl ?? RETRO_REVERB_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.phaserUrl ?? PHASER_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.advancedDriveUrl ?? ADVANCED_DRIVE_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.delayUrl ?? DELAY_WORKLET_URL);
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
    const maxVoices = options.maxVoices ?? PART_MAX_VOICES_DEFAULT;
    const processorOptions: ProcessorOptions = {
      maxVoices,
      patch: structuredClone(patch),
      slideSeconds: SLIDE_SECONDS_DEFAULT,
    };
    if (options.seed !== undefined) processorOptions.seed = options.seed;

    const node = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });

    const part = new AudioPart(name, node, patch);
    if (this.liveRetune) part.setLiveRetune(true);
    const destination = options.destination === undefined ? this.master : options.destination;
    if (destination) part.connect(destination);

    this.parts.set(name, part);
    return part;
  }

  getPart(name: string): AudioPart | undefined {
    return this.parts.get(name);
  }

  /** Dispose one part and forget its name, so the name can be created again (#629). No-op for an unknown name. */
  disposePart(name: string): void {
    const part = this.parts.get(name);
    if (!part) return;
    part.dispose();
    this.parts.delete(name);
  }

  /** A dry bus into `destination` (the master by default). Native nodes only. */
  createBus(options: BusOptions = {}, destination?: AudioNode): AudioBus {
    const bus = createBus(this.context, options);
    bus.output.connect(destination ?? this.master);
    return bus;
  }

  allNotesOff(): void {
    for (const part of this.parts.values()) part.allNotesOff();
  }

  /**
   * Every part's `setLiveRetune`: the console's one-call opt-in after a build.
   * Remembered, so a part created later — a live add (#629) — inherits it
   * instead of the worklet's default (#629 review, passes 1 and 2).
   */
  setLiveRetune(enabled: boolean): void {
    this.liveRetune = enabled;
    for (const part of this.parts.values()) part.setLiveRetune(enabled);
  }

  dispose(): void {
    for (const part of this.parts.values()) part.dispose();
    this.parts.clear();
    this.master.disconnect();
    this.limiter.disconnect();
  }
}

function resolvePatch(options: PartOptions): Patch {
  return options.patch ?? makePatch();
}
