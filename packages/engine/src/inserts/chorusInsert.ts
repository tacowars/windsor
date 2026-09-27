/**
 * The chorus insert (#641's second kind, #642): LFO-modulated delay voices,
 * all native nodes, modulated at audio rate on the audio thread.
 *
 *   input ─▶ splitter ─┬─ L ─▶ delay L₁ … delay Lₙ ─▶ merger 0 ─┐
 *                      └─ R ─▶ delay R₁ … delay Rₙ ─▶ merger 1 ─┴─▶ wet ─┬─▶ output
 *   input ─▶ dry ────────────────────────────────────────────────────────┘
 *
 *   voice v:  lfoᵥ (sine, Rate·ratioᵥ) ─┬─▶ depth L ─▶ delay Lᵥ.delayTime
 *                                        └─▶ depth R ─▶ delay Rᵥ.delayTime
 *
 * Each delay sits at its voice's centre and the LFO swings it by ±Depth, so
 * the pitch wobbles; `DelayNode` interpolates the fractional delay. Spread
 * sets the right side's LFO gain to `1 − 2·spread` of the left's, which moves
 * the two sides apart instead of panning them. The LFOs run free, unsynced to
 * the transport, as a chorus's should.
 *
 * `enabled` false is Mix 0 (#695), so a switched-off chain is the dry signal.
 *
 * `set` is param writes only: the voice count is the kind's, so no setting
 * re-wires. `dispose` stops every oscillator — a running source keeps its
 * subgraph alive — and disconnects what the stage built.
 */
import { MS_PER_SECOND } from '../audioConstants';
import type { FieldNormaliser } from '../song/arrangementFields';
import {
  CHORUS_DELAY_MAX_SECONDS,
  CHORUS_DEPTH_DEFAULT_MS,
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_ENABLED_DEFAULT,
  CHORUS_MIX_DEFAULT,
  CHORUS_RATE_DEFAULT_HZ,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  CHORUS_SPREAD_DEFAULT,
  CHORUS_VOICE_CENTRES_MS,
  CHORUS_VOICE_RATIOS,
} from './insertConstants';
import type { InsertKind, InsertStage } from './insertKind';

export interface ChorusSpec {
  readonly kind: 'chorus';
  /** Hz: the first voice's LFO. */
  readonly rate: number;
  /** ms: how far each delay swings either side of its centre. */
  readonly depth: number;
  /** 0 narrow .. 1 wide. */
  readonly spread: number;
  /** 0 dry .. 1 wet. */
  readonly mix: number;
  /** Off is the dry signal exactly, so a chain can sit in a strip for an A/B (#695). */
  readonly enabled: boolean;
}

export const DEFAULT_CHORUS: ChorusSpec = {
  kind: 'chorus',
  rate: CHORUS_RATE_DEFAULT_HZ,
  depth: CHORUS_DEPTH_DEFAULT_MS,
  spread: CHORUS_SPREAD_DEFAULT,
  mix: CHORUS_MIX_DEFAULT,
  enabled: CHORUS_ENABLED_DEFAULT,
};

const FIELDS = ['kind', 'rate', 'depth', 'spread', 'mix', 'enabled'] as const;

function normalise(raw: Record<string, unknown>, path: string, n: FieldNormaliser): ChorusSpec {
  n.dropUnknown(raw, FIELDS, path);
  const base = DEFAULT_CHORUS;
  return {
    kind: 'chorus',
    rate: n.num(raw.rate, base.rate, CHORUS_RATE_MIN_HZ, CHORUS_RATE_MAX_HZ, `${path}.rate`),
    depth: n.num(raw.depth, base.depth, CHORUS_DEPTH_MIN_MS, CHORUS_DEPTH_MAX_MS, `${path}.depth`),
    spread: n.num(raw.spread, base.spread, 0, 1, `${path}.spread`),
    mix: n.num(raw.mix, base.mix, 0, 1, `${path}.mix`),
    enabled: n.bool(raw.enabled, base.enabled, `${path}.enabled`),
  };
}

interface Voice {
  readonly lfo: OscillatorNode;
  readonly depthL: GainNode;
  readonly depthR: GainNode;
  readonly delayL: DelayNode;
  readonly delayR: DelayNode;
}

function voice(
  context: BaseAudioContext,
  centreMs: number,
  split: ChannelSplitterNode,
  merge: ChannelMergerNode,
): Voice {
  const lfo = context.createOscillator();
  const depthL = context.createGain();
  const depthR = context.createGain();
  const delayL = context.createDelay(CHORUS_DELAY_MAX_SECONDS);
  const delayR = context.createDelay(CHORUS_DELAY_MAX_SECONDS);
  lfo.type = 'sine';
  delayL.delayTime.value = centreMs / MS_PER_SECOND;
  delayR.delayTime.value = centreMs / MS_PER_SECOND;
  split.connect(delayL, 0);
  split.connect(delayR, 1);
  delayL.connect(merge, 0, 0);
  delayR.connect(merge, 0, 1);
  lfo.connect(depthL);
  lfo.connect(depthR);
  depthL.connect(delayL.delayTime);
  depthR.connect(delayR.delayTime);
  lfo.start();
  return { lfo, depthL, depthR, delayL, delayR };
}

function create(context: BaseAudioContext, spec: ChorusSpec): InsertStage<ChorusSpec> {
  const input = context.createGain();
  const split = context.createChannelSplitter(2);
  const merge = context.createChannelMerger(2);
  const wet = context.createGain();
  const dry = context.createGain();
  const output = context.createGain();

  input.connect(split);
  const voices = CHORUS_VOICE_CENTRES_MS.map((centre) => voice(context, centre, split, merge));
  merge.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  const set = (next: ChorusSpec): void => {
    const swing = next.depth / MS_PER_SECOND;
    voices.forEach((v, i) => {
      v.lfo.frequency.value = next.rate * (CHORUS_VOICE_RATIOS[i] ?? 1);
      v.depthL.gain.value = swing;
      v.depthR.gain.value = swing * (1 - 2 * next.spread);
    });
    // The voices sum into the merger, so each carries its share of the wet level.
    const mix = next.enabled ? next.mix : 0;
    wet.gain.value = mix / voices.length;
    dry.gain.value = 1 - mix;
  };
  set(spec);

  return {
    kind: 'chorus',
    input,
    output,
    set,
    dispose(): void {
      for (const v of voices) {
        v.lfo.stop();
        for (const node of [v.lfo, v.depthL, v.depthR, v.delayL, v.delayR]) node.disconnect();
      }
      for (const node of [input, split, merge, wet, dry]) node.disconnect();
    },
  };
}

export const CHORUS_INSERT: InsertKind<ChorusSpec> = {
  fields: FIELDS,
  defaults: DEFAULT_CHORUS,
  normalise,
  create,
};
