/**
 * Wiring one part through its channel strip.
 *
 *   part.output ─▶ [low cut] ─▶ [insert …] ─▶ tail ─┬─ [rotate θ] ─▶ dry destination (the music bus, a group, or the aux fader)
 *                                                   ├─ send ─▶ Send A
 *                                                   └─ send ─▶ Send B   … one send per bus, at 0 unless the strip names it
 *
 * The fader is not here: `MIX.level` sets the part's k-rate `gain` param, a
 * multiply per block inside the worklet, so no `GainNode` sits in the dry path
 * for it (record §3). The stages are the strip's own processing, in order;
 * the rotation and the sends both hang off the chain's tail (#639). So the
 * sends are post-fader by construction, post-stage so a room hears what the
 * dry path hears, and, because the rotation is in the dry path only, pre-pan
 * by choice: fading a part out fades its tail with it, and every part arrives
 * at the room centred (record §7, amended by
 * docs/log/2026-09-22-639-sends-tap-the-strip-tail.md). The low cut is
 * always the first stage (#640, `lowCutStage.ts`); the strip's inserts follow
 * it in list order (#641, `inserts/`).
 *
 * The strip's peak meter (windsor#155) taps the rotation's output, the
 * signal the dry destination hears, and only while something has made it
 * active.
 *
 * A part's Output picks the dry destination (windsor#285): Master is the
 * music bus, `{ group: id }` that group's input. Moving between them moves
 * the one dry edge inside a gate fade (`createDryMover`); Sidechain only
 * closes the gate and leaves the edge where it was.
 *
 * The part must have been created unrouted (`destination: null`); connecting it
 * to the master as well would sum it twice.
 */
import type { AudioPart } from '../synth/audioPart';
import { MS_PER_SECOND } from '../audioConstants';
import { createInsertChain, createInsertUpdater } from './insertChain';
import type { InsertRegistry, InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import type { LowCutStage } from './lowCutStage';
import { createLowCutStage } from './lowCutStage';
import type { ChannelStrip } from './mix';
import { isGroupOutput } from './mix';
import type { PeakMeter } from './peakMeter';
import { createPeakMeter } from './peakMeter';
import type { ReturnBus } from './returnBus';
import { createDryMover, createTap } from './stripTap';
import type { StereoRotate } from './stereoRotate';

/**
 * One piece of a strip's processing between the part and the tap (#639): a
 * node chain entered at `input` and left at `output`. The strip makes and
 * removes the edges into `input` and out of `output`; `dispose` releases only
 * what the stage built between them, and stops any source it started.
 */
export interface StripStage {
  readonly input: AudioNode;
  readonly output: AudioNode;
  dispose(): void;
}

export interface PartStrip {
  readonly part: AudioPart;
  readonly insertSpecs: readonly InsertSpec[];
  /** The Output as it is set now (windsor#285): absent or Master, Sidechain, or a group. */
  readonly output: ChannelStrip['output'];
  /**
   * Master or a group moves the dry edge there inside a gate fade, and
   * Sidechain only closes the gate. False when `output` names a group the
   * song lacks: the strip plays on Master instead, and the caller reports it.
   */
  setOutput(output: ChannelStrip['output']): boolean;
  /** Where the dry edge connects now: the music bus, a group's input, or the aux fader. */
  readonly destination: AudioNode;
  /** Mute (windsor#154): the audible gate closes, cutting the dry path and every send. */
  readonly mute: boolean;
  setMute(mute: boolean): void;
  /**
   * This strip's own solo flag (windsor#154). It changes nothing here: the
   * roster reads every music strip's flag and sets `soloedOut` on the rest
   * (`MusicRoster.resolveSolo`).
   */
  readonly solo: boolean;
  setSolo(solo: boolean): void;
  /**
   * Silenced by the solo rule (windsor#154) or by its group's mute or solo
   * (windsor#285): the audible gate closes, as for mute.
   */
  readonly soloedOut: boolean;
  /** `seconds` is the ramp, the insert fade by default; 0 sets it at once. */
  setSoloedOut(soloedOut: boolean, seconds?: number): void;
  /** The strip's stages, in signal order: the low cut, then the inserts. */
  readonly stages: readonly StripStage[];
  /** The first stage (#640). */
  readonly lowCut: LowCutStage;
  /** The live inserts, in list order (#641). */
  readonly inserts: readonly InsertStage<InsertSpec>[];
  /** Where the rotation and the sends connect: the last stage's output. */
  readonly tail: AudioNode;
  readonly rotation: StereoRotate;
  /**
   * The gain every tapped path passes through (#652): the rotation and every
   * send hang off it, and it ramps down and up around a structural insert
   * edit. Not the fader — that is the part's k-rate `gain`.
   */
  readonly head: GainNode;
  /** One send per return, by return name. */
  readonly sends: ReadonlyMap<string, GainNode>;
  /**
   * The strip's sample-peak meter (windsor#155), on the rotation's output:
   * what the part puts into the mix, post-fader, post-gate and post-pan, so
   * a muted or soloed-out part reads silence. The sends and the sidechain
   * key are not metered. Lazy: nothing is built until `setActive(true)`,
   * and the strip's `dispose` disposes it.
   */
  readonly meter: PeakMeter;
  setLevel(level: number): void;
  setPan(pan: number): void;
  /** Hz; the caller clamps. */
  setLowCut(hz: number): void;
  /**
   * The strip's inserts, normalised (#641). The same kinds in the same order
   * are param writes on the live stages; any other list rebuilds this strip's
   * insert chain and nothing else.
   */
  setInserts(specs: readonly InsertSpec[]): void;
  /** Throws for a return that does not exist; a typo must not be silent. */
  setSend(returnName: string, amount: number): void;
  dispose(): void;
}

/**
 * Where a music strip's dry edge may go (windsor#285): the music bus for
 * Master, and a group's input by id, undefined for a group the song lacks.
 * An aux strip is handed its one node, and has no groups.
 */
export interface DryTargets {
  readonly master: AudioNode;
  group(id: number): AudioNode | undefined;
}

const NO_GROUPS = (): undefined => undefined;

/**
 * What a strip is built with beyond the mix data: the insert kinds it may
 * build (a test injects its own), and how it waits out the fade around a
 * structural insert edit (#652) — `setTimeout` in the browser, something
 * immediate in a test.
 */
export interface RouteOptions {
  registry?: InsertRegistry;
  changed?: () => void;
  defer?: (run: () => void, seconds: number) => void;
}

const laterByTimeout = (run: () => void, seconds: number): void => {
  setTimeout(run, seconds * MS_PER_SECOND);
};

// eslint-disable-next-line max-lines-per-function -- one strip graph and its lifetime; detector metadata, output, mute, solo and the meter share the same owned tap
export function routePart(
  part: AudioPart,
  strip: ChannelStrip,
  returns: Readonly<Record<string, ReturnBus>>,
  dry: AudioNode | DryTargets,
  options: RouteOptions = {},
): PartStrip {
  const registry = options.registry ?? INSERT_KINDS;
  const later = options.defer ?? laterByTimeout;
  const context = part.context;
  for (const name of Object.keys(strip.sends)) {
    if (!(name in returns)) {
      throw new Error(`part "${part.name}" sends to unknown return "${name}"`);
    }
  }

  part.gain.value = strip.level;

  const lowCut = createLowCutStage(context, strip.lowCut);
  part.output.connect(lowCut.input);
  const inserts = createInsertChain(context, lowCut.output, strip.inserts, registry, part.name);
  const targets: DryTargets = 'master' in dry ? dry : { master: dry, group: NO_GROUPS };
  const first = destinationOf(targets, strip.output);
  let output = first.output;
  const tap = createTap(context, strip, returns, first.node, inserts.tail);
  const updates = createInsertUpdater(inserts, tap, later, options.changed);
  const mover = createDryMover(tap, later);
  const { rotation, sends, gate } = tap;
  const meter = createPeakMeter(context, rotation.output);
  let solo = strip.solo === true;

  return {
    part,
    get insertSpecs(): readonly InsertSpec[] {
      return inserts.specs;
    },
    get output(): ChannelStrip['output'] {
      return output;
    },
    setOutput(next): boolean {
      const target = destinationOf(targets, next);
      output = target.output;
      gate.setOutput(output);
      if (output !== 'sidechain') mover.move(target.node);
      return output === next;
    },
    get destination(): AudioNode {
      return tap.destination;
    },
    get mute(): boolean {
      return gate.mute;
    },
    setMute: (mute) => gate.setMute(mute),
    get solo(): boolean {
      return solo;
    },
    setSolo(next: boolean): void {
      solo = next;
    },
    get soloedOut(): boolean {
      return gate.soloedOut;
    },
    setSoloedOut: (soloedOut, seconds) => gate.setSoloedOut(soloedOut, seconds),
    get stages(): readonly StripStage[] {
      return [lowCut, ...inserts.stages];
    },
    lowCut,
    get inserts(): readonly InsertStage<InsertSpec>[] {
      return inserts.stages;
    },
    get tail(): AudioNode {
      return tap.tail;
    },
    rotation,
    head: tap.head,
    sends,
    meter,
    setLevel(level: number): void {
      part.gain.value = level;
    },
    setPan(pan: number): void {
      rotation.setPan(pan);
    },
    setLowCut(hz: number): void {
      lowCut.setFrequency(hz);
    },
    setInserts: (specs) => updates.set(specs),
    setSend(returnName: string, amount: number): void {
      const send = sends.get(returnName);
      if (!send) throw new Error(`part "${part.name}" has no send to return "${returnName}"`);
      send.gain.value = amount;
    },
    dispose(): void {
      // Before the graph goes, so a fade still waiting cannot re-wire it (#652).
      updates.cancel();
      mover.cancel();
      // Before the tap, whose rotation output the meter's edge leaves from.
      meter.dispose();
      tap.dispose();
      inserts.dispose();
      part.output.disconnect(lowCut.input);
      lowCut.dispose();
    },
  };
}

/**
 * The dry destination for `output`, and the Output that reaches it: a group
 * `targets` lacks plays on Master. Sidechain names the music bus, the
 * destination a strip built on Sidechain starts at.
 */
function destinationOf(
  targets: DryTargets,
  output: ChannelStrip['output'],
): { output: ChannelStrip['output']; node: AudioNode } {
  if (!isGroupOutput(output)) return { output, node: targets.master };
  const node = targets.group(output.group);
  return node ? { output, node } : { output: 'master', node: targets.master };
}
