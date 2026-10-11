/**
 * The clip envelopes' rig (windsor#702): a real `AudioPart` on the fake
 * worklet, the automation player on a hand-driven `TickTransport` with the
 * live resolver over that part, and helpers that build a roll's regions and
 * envelopes and read a voice slot's timeline. A stop's deferred slot
 * release is kept for the test to run. Node-only, like the rest of this
 * directory; the test file installs the fake worklet (`installWorklet`).
 */
import type { AutomationLane } from '../automation/automationLane';
import { partOwner } from '../automation/automationOwner';
import { AutomationPlayer } from '../automation/automationPlayer';
import { clipEnvelopeSource } from '../automation/clipEnvelopeSource';
import type { PartStrip } from '../mixer/channelStrip';
import type { Patch } from '../patch/patch';
import type { Region } from '../sequencing/regionClock';
import type { RollEnvelope, RollEnvelopePoint } from '../sequencing/rollEnvelope';
import { envelopeValueAt } from '../sequencing/rollEnvelopeValue';
import type { RollNote } from '../sequencing/rollSequencer';
import { PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import type { MusicPart, PartRegion, RegionPattern } from '../song/arrangement';
import type { AudioPart } from '../synth/audioPart';
import { automationResolver } from '../system/automationResolver';
import { VOICE_TARGET_SPAN, voiceTargetCode } from '../worklet/fm/voiceTargetTables';
import type { FakeWorkletNode } from './fakeAudioContext';
import type { FakeParam } from './fakeAudioNodes';
import { RIG_BPM, RIG_START } from './automationRig';
import { rig as stripRig } from './stripRig';

/** The rig's part. */
export const ENVELOPE_OWNER = partOwner(0);
/** A four-bar song, as the automation rig's. */
export const ENVELOPE_SONG_TICKS = 4 * TICKS_PER_BAR;
/** One tick at the rig's 120 BPM. */
export const ENVELOPE_TICK = 60 / RIG_BPM / PPQ;

export const envPoint = (tick: number, value: number, bend = 0): RollEnvelopePoint => ({
  tick,
  value,
  bend,
});

export const envelope = (
  target: RollEnvelope['target'],
  points: RollEnvelopePoint[],
  on = true,
): RollEnvelope => ({ target, on, points });

/** A roll pattern of `loopTicks` with `envelopes`, and its notes. */
export const rollPattern = (
  loopTicks: number,
  envelopes: readonly RollEnvelope[],
  notes: readonly RollNote[] = [],
): RegionPattern => ({ kind: 'roll', loopTicks, notes, envelopes });

/** A part's regions over a roll: the first region's pattern is the part's own sequencer. */
export function rollPart(
  regions: readonly (Region & { pattern: RegionPattern })[],
): Pick<MusicPart, 'regions' | 'sequencer'> {
  const own = regions[0]!.pattern;
  if (own.kind !== 'roll') throw new Error('rollPart: a roll pattern');
  return { regions: regions as readonly PartRegion[], sequencer: own };
}

/** The offset `envelope` writes at loop tick `tick`: its value times the row's span. */
export function envelopeOffsetAt(env: RollEnvelope, tick: number, loopTicks: number): number {
  return VOICE_TARGET_SPAN[voiceTargetCode(env.target)]! * envelopeValueAt(env, tick, loopTicks);
}

export interface ClipEnvelopeRig {
  readonly transport: TickTransport;
  readonly player: AutomationPlayer;
  readonly part: AudioPart;
  /** The audio clock's now, as the player reads it. */
  now: number;
  /** Stops' deferred slot releases, not yet run. */
  readonly deferred: (() => void)[];
  /** Issue `ticks` ticks, each at `RIG_START` plus the transport's seconds; returns their times. */
  run(ticks: number): number[];
  /** The param of the slot `path` holds now; throws when it holds none. */
  slot(path: string): FakeParam;
  /** Whether `path` holds a slot now. */
  holds(path: string): boolean;
  /** The voice slot map the processor was last told. */
  lastSlotMap(): unknown;
}

export interface ClipEnvelopeRigOptions {
  readonly restTick?: number;
  readonly lanes?: readonly AutomationLane[];
  readonly patch?: Patch;
}

export async function clipEnvelopeRig(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  options: ClipEnvelopeRigOptions = {},
): Promise<ClipEnvelopeRig> {
  const { part: audio } = await stripRig();
  if (options.patch) audio.setPatch(options.patch);
  const strip = { part: audio } as unknown as PartStrip;
  const transport = new TickTransport(RIG_BPM);
  const restTick = options.restTick ?? 0;
  transport.reset(restTick);
  const deferred: (() => void)[] = [];
  const node = audio.node as unknown as FakeWorkletNode;
  const rig: ClipEnvelopeRig = {
    transport,
    part: audio,
    now: 0,
    deferred,
    player: new AutomationPlayer({
      transport,
      now: () => rig.now,
      resolve: automationResolver(() => strip),
      songTicks: ENVELOPE_SONG_TICKS,
      restTick,
      defer: (run) => deferred.push(run),
    }),
    run(ticks: number): number[] {
      const times: number[] = [];
      for (let i = 0; i < ticks; i++) {
        const time = RIG_START + transport.transportSeconds;
        times.push(time);
        transport.advance(time);
      }
      return times;
    },
    slot(path: string): FakeParam {
      const index = audio.voiceSlotOf(path);
      if (index === undefined) throw new Error(`no slot holds ${path}`);
      return audio.voiceSlotParams[index] as unknown as FakeParam;
    },
    holds: (path) => audio.voiceSlotOf(path) !== undefined,
    lastSlotMap: () =>
      node.posted.filter((m) => (m as { type?: string }).type === 'voiceSlots').at(-1),
  };
  rig.player.setLanes(ENVELOPE_OWNER, options.lanes ?? []);
  rig.player.setEnvelopes(ENVELOPE_OWNER, clipEnvelopeSource(part, ENVELOPE_SONG_TICKS));
  return rig;
}
