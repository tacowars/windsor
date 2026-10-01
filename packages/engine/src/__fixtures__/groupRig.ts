/**
 * The group bus rig (windsor#285): the live system on the fake graph with
 * the shipped compressor and tape processors running inside it, and a song
 * with a Drums group (Compressor → Tape) holding the kick and a snare, and
 * a bass on Master. The fixture's hat stands in for the snare and its arp
 * for the bass; each part plays a steady tone of its own.
 *
 * Node-only, like the rest of this directory.
 */
import { FakeContext, FakeWorkletNode, sourceOf } from './fakeAudioContext';
import { BLOCK, FakeNode, FakeParam } from './fakeAudioNodes';
import { DetectorNode } from './sidechainRig';
import { FULL_DOCUMENT, FULL_SLOT } from './fullArrangement';
import { loadTape, tapeParams } from './tapeHarness';
import type { TapeProcessorLike } from './tapeHarness';
import { COMPRESSOR_NAME } from '../inserts/compressorConstants';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import { TAPE_NAME } from '../inserts/tapeConstants';
import { DEFAULT_TAPE } from '../inserts/tapeSpec';
import type { GroupSpec } from '../mixer/mix';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { AudioSystem } from '../system/audioSystem';
import { FmEngine } from '../synth/fmEngine';

/** The shipped tape processor inside the fake graph. */
export class TapeNode extends FakeNode {
  readonly kind = 'tape';
  readonly parameters = new Map<string, FakeParam>();
  readonly dsp: TapeProcessorLike;
  readonly port = Object.assign(new EventTarget(), {
    postMessage: (data: unknown): void =>
      (this.dsp.port.onmessage as ((event: { data: unknown }) => void) | null)?.({ data }),
    start(): void {},
    close(): void {},
    onmessage: null,
  });
  constructor(context: FakeContext, options: AudioWorkletNodeOptions) {
    super(context, 1, 1);
    const defaults = tapeParams();
    for (const [key, values] of Object.entries(defaults)) {
      this.parameters.set(key, new FakeParam(options.parameterData?.[key] ?? values[0]!));
    }
    this.dsp = loadTape(
      context.sampleRate,
      Object.fromEntries(
        [...this.parameters].map(([key, p]) => [key, new Float32Array([p.value])]),
      ),
    );
  }
  protected render(block: number): Float32Array[][] {
    const out = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    const params = Object.fromEntries(
      [...this.parameters].map(([key, p]) => [key, new Float32Array([p.value])]),
    );
    const channels = this.gather(block);
    const left = channels[0] ?? new Float32Array(BLOCK);
    this.dsp.process([[left, channels[1] ?? left]], out, params);
    return out;
  }
}

/** Point `AudioWorkletNode` at the real compressor and tape, and the fakes for the rest. Returns the undo. */
export function installGroupWorklets(): () => void {
  const previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = function (
    context: FakeContext,
    name: string,
    options: AudioWorkletNodeOptions,
  ) {
    if (name === COMPRESSOR_NAME) return new DetectorNode(context, options);
    if (name === TAPE_NAME) return new TapeNode(context, options);
    return new FakeWorkletNode(context, name, options);
  } as unknown as typeof AudioWorkletNode;
  return (): void => {
    globalThis.AudioWorkletNode = previous;
  };
}

export const DRUMS_ID = 4;
/** The slots: the kick and the snare in Drums, the bass on Master. */
export const KICK = FULL_SLOT.kick;
export const SNARE = FULL_SLOT.hat;
export const BASS = FULL_SLOT.arp;

/** Hard enough to hear: the summed drums sit far over the threshold. */
export const DRUM_COMPRESSOR = { ...DEFAULT_COMPRESSOR, threshold: -30, ratio: 20, attack: 1 };

export const DRUMS: GroupSpec = {
  id: DRUMS_ID,
  name: 'Drums',
  level: 1,
  pan: 0,
  inserts: [DRUM_COMPRESSOR, DEFAULT_TAPE],
};

/** Three parts, sends off, the kick and snare on `group` when it is given. */
export function drumSong(group?: GroupSpec): ArrangementDocument {
  const parts = FULL_DOCUMENT.parts
    .filter((part) => part.slot !== FULL_SLOT.drone)
    .map((part) => {
      const grouped = group !== undefined && part.slot !== BASS;
      const strip = { ...part.strip, pan: 0, sends: {}, inserts: [] };
      return { ...part, strip: grouped ? { ...strip, output: { group: group.id } } : strip };
    });
  return { ...FULL_DOCUMENT, parts, ...(group ? { groups: [group] } : {}) };
}

/** A steady tone per slot, so every part is playing whether or not a note is. */
export const TONE_RATE: Readonly<Record<number, number>> = {
  [KICK]: 0.01,
  [SNARE]: 0.07,
  [BASS]: 0.03,
  [FULL_SLOT.drone]: 0.05,
};

export function playTone(system: AudioSystem, slot: number, amplitude = 0.4): void {
  const rate = TONE_RATE[slot] ?? 0.02;
  sourceOf(system.strip(musicPartName(slot))!.part).feed = (b, l, r) => {
    for (let i = 0; i < l.length; i++)
      l[i] = r[i] = amplitude * Math.sin((b * l.length + i) * rate);
  };
}

/** The live system on `doc`, every part playing its tone. `defer` runs a fade's wait. */
export async function groupRig(
  doc: ArrangementDocument,
  defer: (run: () => void, seconds: number) => void = (run) => run(),
): Promise<{ system: AudioSystem; context: FakeContext }> {
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), { defer });
  await system.init();
  system.initMusic(doc);
  for (const part of doc.parts) playTone(system, part.slot);
  return { system, context };
}
