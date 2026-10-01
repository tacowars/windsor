/**
 * A group bus (windsor#285; record `2026-10-01-group-buses` decisions 1–4):
 * the parts whose Output names it play their dry signal here instead of to
 * the music bus, and the group plays into the music bus through its own
 * chain.
 *
 *   members' pans ─▶ input ─▶ [insert …] ─▶ fade ─▶ [rotate θ] ─▶ level ─▶ gate ─▶ music bus input
 *                                                                                └─▶ peak meter (lazy)
 *
 * It is built as a send bus is (`returnBus.ts`): the chain is a strip's
 * (`insertChain.ts`), from the same registry and `RouteOptions`, so a
 * tempo-aware insert follows the song and a worklet insert is metered. A
 * settings-only chain change is param writes; any other list re-wires
 * inside the fade, and the level never moves. A compressor keys from the
 * group's own input, as on a send bus.
 *
 * The destination is the music bus's input, so a group gets the 30 Hz
 * highpass an ungrouped part gets. The gate closes when the group isn't
 * open under mute and solo (`MusicRoster.resolveSolo`); the meter reads
 * after it, post-level, post-pan and post-gate, as a part strip's does.
 */
import { MS_PER_SECOND } from '../audioConstants';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { holdAt } from './audibleGate';
import type { RouteOptions } from './channelStrip';
import { createInsertChain, createInsertUpdater } from './insertChain';
import type { GroupSpec } from './mix';
import type { PeakMeter } from './peakMeter';
import { createPeakMeter } from './peakMeter';
import { createStereoRotate } from './stereoRotate';

export interface GroupBus {
  readonly id: number;
  /** The group as it is set now: what the document's entry for it holds. */
  readonly spec: GroupSpec;
  /** Members' dry edges connect here. */
  readonly input: GainNode;
  /** The gate, the last node: what the music bus hears. */
  readonly output: GainNode;
  /** The live inserts, in chain order. */
  readonly inserts: readonly InsertStage<InsertSpec>[];
  /** The group's sample-peak meter, after the gate. Lazy, as a strip's is. */
  readonly meter: PeakMeter;
  /** Whether the gate is open: the group isn't muted, and isn't soloed out. */
  readonly open: boolean;
  setName(name: string): void;
  /** The group fader; the caller clamps. */
  setLevel(level: number): void;
  /** -1..1; the caller clamps. */
  setPan(pan: number): void;
  /** The group's mute flag. It changes nothing here: the roster resolves the gates. */
  setMute(mute: boolean): void;
  /** The group's solo flag, resolved by the roster as mute is. */
  setSolo(solo: boolean): void;
  /**
   * The chain, normalised. The same kinds in the same order are param
   * writes on the live stages; any other list re-wires inside a fade.
   */
  setInserts(specs: readonly InsertSpec[]): void;
  /** Ramp the gate over `seconds`, the insert fade by default; 0 sets it at once. Only a change schedules anything. */
  setOpen(open: boolean, seconds?: number): void;
  dispose(): void;
}

const laterByTimeout = (run: () => void, seconds: number): void => {
  setTimeout(run, seconds * MS_PER_SECOND);
};

/**
 * Build one group into `destination`, the music bus's input. `options` are
 * a strip's: the insert registry, the change hook and the fade's wait. The
 * gate starts open; the roster closes it when the group isn't heard.
 */
// eslint-disable-next-line max-lines-per-function -- one bus graph and its lifetime, as `createReturn`: the setters share its nodes
export function createGroupBus(
  context: BaseAudioContext,
  spec: GroupSpec,
  destination: AudioNode,
  options: RouteOptions = {},
): GroupBus {
  const input = context.createGain();
  const fade = context.createGain();
  const rotation = createStereoRotate(context, spec.pan);
  const level = context.createGain();
  const gate = context.createGain();
  level.gain.value = spec.level;
  fade.connect(rotation.input);
  rotation.output.connect(level);
  level.connect(gate);
  gate.connect(destination);
  const registry = options.registry ?? INSERT_KINDS;
  const chain = createInsertChain(context, input, spec.inserts, registry, `group ${spec.id}`);
  let tail = chain.tail;
  tail.connect(fade);
  const tap = {
    move(next: AudioNode): void {
      tail.disconnect(fade);
      tail = next;
      tail.connect(fade);
    },
    fadeTo(to: number, seconds: number): void {
      const now = context.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(to, now + seconds);
    },
  };
  const updates = createInsertUpdater(chain, tap, options.defer ?? laterByTimeout, options.changed);
  const meter = createPeakMeter(context, gate);
  let { name, pan, mute, solo } = spec;
  let open = true;
  return {
    id: spec.id,
    get spec(): GroupSpec {
      return {
        id: spec.id,
        name,
        level: level.gain.value,
        pan,
        ...(mute === undefined ? {} : { mute }),
        ...(solo === undefined ? {} : { solo }),
        inserts: chain.specs,
      };
    },
    input,
    output: gate,
    get inserts(): readonly InsertStage<InsertSpec>[] {
      return chain.stages;
    },
    meter,
    get open(): boolean {
      return open;
    },
    setName(next: string): void {
      name = next;
    },
    setLevel(next: number): void {
      level.gain.value = next;
    },
    setPan(next: number): void {
      pan = next;
      rotation.setPan(next);
    },
    setMute(next: boolean): void {
      mute = next;
    },
    setSolo(next: boolean): void {
      solo = next;
    },
    setInserts: (specs) => updates.set(specs),
    setOpen(next: boolean, seconds = INSERT_FADE_SECONDS): void {
      if (next === open) return;
      open = next;
      rampGate(gate.gain, open ? 1 : 0, context.currentTime, seconds);
    },
    dispose(): void {
      // Before the graph goes, so a fade still waiting cannot re-wire it (#652).
      updates.cancel();
      meter.dispose();
      tail.disconnect(fade);
      chain.dispose();
      input.disconnect();
      fade.disconnect();
      rotation.dispose();
      level.disconnect();
      gate.disconnect();
    },
  };
}

/** The gate to `to`: from where it has got to over `seconds`, or at once for 0, as a strip's gate moves. */
function rampGate(param: AudioParam, to: number, now: number, seconds: number): void {
  if (seconds <= 0) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(to, now);
    return;
  }
  holdAt(param, now);
  param.linearRampToValueAtTime(to, now + seconds);
}
