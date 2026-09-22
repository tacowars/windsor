/**
 * The shared rig for the channel-strip tests (#639–#652): a part on a fake
 * context, the helpers that read the graph's edges, and a test insert kind so
 * a strip can be wired without the shipped drive or chorus.
 *
 * Node-only, like the rest of this directory.
 */
import { FakeContext, installFakeAudioWorklet } from './fakeAudioContext';
import type { FakeNode } from './fakeAudioNodes';
import { LOW_CUT_MIN_HZ } from '../audioConstants';
import { AudioPart } from '../audioPart';
import type {
  InsertKind,
  InsertRegistry,
  InsertSpec,
  InsertStage,
} from '../inserts/insertRegistry';
import type { ChannelStrip } from '../mix';
import { makePatch } from '../patch';
import { PROCESSOR_NAME } from '../workletMessages';

/** Point the global `AudioWorkletNode` at the fake for a test file's lifetime. */
export const installWorklet = installFakeAudioWorklet;

export const STRIP: ChannelStrip = {
  level: 1,
  pan: 0.4,
  lowCut: LOW_CUT_MIN_HZ,
  sends: { room: 0.5, echo: 0.25 },
  inserts: [],
};
export const STAGE_GAIN = 0.5;

export const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
export const targets = (node: AudioNode): FakeNode[] => fake(node).outbound.map((c) => c.to);
export const sources = (node: AudioNode): FakeNode[] => fake(node).inbound.map((c) => c.from);

export async function rig(): Promise<{ context: FakeContext; part: AudioPart; dry: AudioNode }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  await context.audioWorklet.addModule('reverb-processor.js');
  const ctx = context.asAudioContext();
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0 });
  const part = new AudioPart('lead', node, makePatch());
  const dry = context.createGain();
  dry.connect(context.destination);
  return { context, part, dry: dry as unknown as AudioNode };
}

interface ScaleSpec {
  readonly kind: 'scale' | 'boost';
  readonly gain: number;
}

/** What the test kinds built, so a test can count creations and disposals. */
export const built: (InsertStage<ScaleSpec> & { disposed: number; sets: number })[] = [];

/** A test insert kind that scales by `gain`: two gains in series, so input and output differ. */
export function scaleKind(kind: ScaleSpec['kind']): InsertKind<ScaleSpec> {
  return {
    fields: ['kind', 'gain'],
    defaults: { kind, gain: 1 },
    normalise: (raw) => ({ kind, gain: Number(raw.gain) }),
    create(context, spec) {
      const input = context.createGain();
      const output = context.createGain();
      output.gain.value = spec.gain;
      input.connect(output);
      const stage = {
        kind,
        input,
        output,
        disposed: 0,
        sets: 0,
        set(next: ScaleSpec): void {
          stage.sets++;
          output.gain.value = next.gain;
        },
        dispose(): void {
          stage.disposed++;
          input.disconnect();
        },
      };
      built.push(stage);
      return stage;
    },
  };
}

/** Runs the strip's deferred re-wire at once, so a test sees the settled graph. */
export const NOW = (run: () => void): void => run();

export const TEST_KINDS = {
  scale: scaleKind('scale'),
  boost: scaleKind('boost'),
} as unknown as InsertRegistry;
export const scale = (gain: number): InsertSpec =>
  ({ kind: 'scale', gain }) as unknown as InsertSpec;
export const boost = (gain: number): InsertSpec =>
  ({ kind: 'boost', gain }) as unknown as InsertSpec;
