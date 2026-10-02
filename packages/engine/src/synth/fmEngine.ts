/**
 * Owns the `AudioContext`, the worklet module, and the parts built on it.
 *
 * The context is the caller's or the engine's own; every part, bus and
 * return built on the engine shares its clock. The console hands in one
 * context and rebuilds engines on it (`packages/app/src/host.ts`).
 *
 * The last node before the destination is the output stage (windsor#93,
 * `mixer/outputStage.ts`): Windsor's own limiter / soft clip / hard clip /
 * off worklet, which replaced the browser's `DynamicsCompressorNode` with its
 * 6 ms delay and makeup gain. It is a worklet, so it exists from `init()` on;
 * before then the master reaches nothing.
 */
import { PART_MAX_VOICES_DEFAULT, SLIDE_SECONDS_DEFAULT } from '../audioConstants';
import type { AudioBus, BusOptions } from '../mixer/audioBus';
import { createBus } from '../mixer/audioBus';
import {
  PEAK_METER_WORKLET_URL,
  COMPRESSOR_WORKLET_URL,
  RETRO_REVERB_WORKLET_URL,
  PHASER_WORKLET_URL,
  TAPE_WORKLET_URL,
  ADVANCED_DRIVE_WORKLET_URL,
  DELAY_WORKLET_URL,
  EQ_WORKLET_URL,
} from './workletMessages';
import { AudioPart } from './audioPart';
import type { OutputStage } from '../mixer/outputStage';
import { OUTPUT_STAGE_WORKLET_URL, createOutputStage } from '../mixer/outputStage';
import type { Patch } from '../patch/patch';
import { makePatch } from '../patch/patch';
import type { NoteMessage, ProcessorOptions, ScheduledMessage } from './workletMessages';
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
  /**
   * Notes the processor is built holding (`ProcessorOptions.events`). An
   * offline song render hands in its opening this way, because a port
   * message would reach the processor after rendering had begun
   * (windsor#40). Live parts omit it. A slot map among them (windsor#346)
   * becomes the processor's `ProcessorOptions.voiceSlots`, the last one
   * winning, as it would have on the port.
   */
  events?: ScheduledMessage[];
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
  tapeUrl?: string | URL;
  advancedDriveUrl?: string | URL;
  delayUrl?: string | URL;
  outputStageUrl?: string | URL;
  eqUrl?: string | URL;
}

export class FmEngine {
  readonly context: AudioContext;

  /** Everything routes through here, so one fader ducks the whole synth. */
  readonly master: GainNode;

  private stage: OutputStage | null = null;
  private readonly parts = new Map<string, AudioPart>();
  /** What every part created from now on is told (#629); the worklet's own default is off. */
  private liveRetune = false;
  private moduleLoaded = false;

  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext({ latencyHint: 'interactive' });

    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
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
    await this.context.audioWorklet.addModule(urls.tapeUrl ?? TAPE_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.advancedDriveUrl ?? ADVANCED_DRIVE_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.delayUrl ?? DELAY_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.eqUrl ?? EQ_WORKLET_URL);
    await this.context.audioWorklet.addModule(urls.outputStageUrl ?? OUTPUT_STAGE_WORKLET_URL);
    // Catches the sum of many parts peaking together. It starts on the
    // default settings; a song's own reach it through `AudioSystem`.
    this.stage = createOutputStage(this.context);
    this.master.connect(this.stage.node);
    this.stage.node.connect(this.context.destination);
    this.moduleLoaded = true;
  }

  /** The safety output between the master and the destination; null until `init()`. */
  get outputStage(): OutputStage | null {
    return this.stage;
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
    const { notes, voiceSlots } = splitEvents(options.events ?? []);
    if (notes.length) processorOptions.events = notes;
    if (voiceSlots) processorOptions.voiceSlots = voiceSlots;

    const node = new AudioWorkletNode(this.context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions,
    });

    const part = new AudioPart(name, node, patch, voiceSlots);
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
    this.stage?.dispose();
    this.stage = null;
  }
}

function resolvePatch(options: PartOptions): Patch {
  return options.patch ?? makePatch();
}

/** A part's construction events as the processor takes them: the notes, and the last slot map. */
function splitEvents(events: readonly ScheduledMessage[]): {
  notes: NoteMessage[];
  voiceSlots: (string | null)[] | undefined;
} {
  const notes: NoteMessage[] = [];
  let voiceSlots: (string | null)[] | undefined;
  for (const event of events) {
    if (event.type === 'voiceSlots') voiceSlots = event.slots;
    else notes.push(event);
  }
  return { notes, voiceSlots };
}
