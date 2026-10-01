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
import type { KnobTarget } from '../automation/automationHandles';
import type { FieldHandles } from './insertFieldHandles';
import { fieldHandles } from './insertFieldHandles';
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

/** What `set` writes: each voice's params and the two mix gains. */
interface ChorusParams {
  readonly voices: readonly Voice[];
  readonly wet: AudioParam;
  readonly dry: AudioParam;
}

const voiceRate = (rate: number, i: number): number => rate * (CHORUS_VOICE_RATIOS[i] ?? 1);
const swingOf = (depth: number): number => depth / MS_PER_SECOND;
/** The right side's LFO gain: `1 − 2·spread` of the left's. */
const rightSwing = (depth: number, spread: number): number => swingOf(depth) * (1 - 2 * spread);
/** The voices sum into the merger, so each carries its share of the wet level. */
const mixGains = (spec: ChorusSpec, mix: number, voices: number): [number, number] => {
  const heard = spec.enabled ? mix : 0;
  return [heard / voices, 1 - heard];
};

/**
 * Each knob's lane (windsor#345): Rate on every voice's LFO, Depth on the
 * left side's swing, Mix on the wet and dry gains. The right side's swing
 * (the depth times the spread's share) follows Depth and Spread both, from
 * each one's own value at every breakpoint either has.
 */
function chorusHandles(p: ChorusParams, spec: () => ChorusSpec, now: () => number): FieldHandles {
  const { voices } = p;
  const each = (value: number): number[] => voices.map(() => value);
  const rights = {
    params: voices.map((v) => v.depthR.gain),
    fields: ['depth', 'spread'] as const,
    value: rightSwing,
  };
  const target = (field: string): KnobTarget | undefined => {
    const resting = (): number => spec()[field as 'rate' | 'depth' | 'spread' | 'mix'];
    if (field === 'rate') {
      const write = (v: number) => voices.map((_, i) => voiceRate(v, i));
      return { params: voices.map((v) => v.lfo.frequency), write, resting };
    }
    if (field === 'depth') {
      const write = (v: number) => each(swingOf(v));
      return { params: voices.map((v) => v.depthL.gain), write, resting };
    }
    // Spread writes only the right side's swing, which it shares with Depth.
    if (field === 'spread') return { params: [], write: () => [], resting };
    if (field !== 'mix') return undefined;
    const write = (v: number) => mixGains(spec(), v, voices.length);
    return { params: [p.wet, p.dry], write, resting };
  };
  return fieldHandles(target, { params: [rights], now });
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

  let current = spec;
  const knobs = chorusHandles(
    { voices, wet: wet.gain, dry: dry.gain },
    () => current,
    () => context.currentTime,
  );
  const set = (next: ChorusSpec): void => {
    current = next;
    const lane = (field: string): boolean => knobs.automated(field);
    voices.forEach((v, i) => {
      if (!lane('rate')) v.lfo.frequency.value = voiceRate(next.rate, i);
      if (!lane('depth')) v.depthL.gain.value = swingOf(next.depth);
      if (!lane('depth') && !lane('spread')) {
        v.depthR.gain.value = rightSwing(next.depth, next.spread);
      }
    });
    if (lane('mix')) return;
    [wet.gain.value, dry.gain.value] = mixGains(next, next.mix, voices.length);
  };
  set(spec);

  return {
    kind: 'chorus',
    input,
    output,
    set,
    param: (field) => knobs.param(field),
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
