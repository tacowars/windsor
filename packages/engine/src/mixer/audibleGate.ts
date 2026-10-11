/**
 * The strip's audible gate: the one gain after the tap's head that the dry
 * path and every send pass through (#667, windsor#154). It is open only
 * while the part's Output isn't Sidechain, it is not muted, it is not
 * soloed out (or silenced by its group, windsor#285) and its dry edge is not
 * moving, so each of those cuts the dry signal and the sends together,
 * post-fader. The sidechain key is tapped at the head, before the gate, so
 * none of them changes what a detector hears.
 *
 * A change ramps over `INSERT_FADE_SECONDS`, as the output switch always
 * has, so it never clicks. A caller building a system that has not played
 * yet may ask for no ramp, so a render's first block is already right. A
 * change ramps from the value the gate has now (`holdAt`): mid-fade it
 * reverses from where the fade has got to, and after seconds at rest it
 * ramps from that rest, never stepping to what a cancelled or long-finished
 * ramp implies.
 */
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { ChannelStrip } from './mix';

export interface AudibleGate {
  readonly node: GainNode;
  readonly mute: boolean;
  readonly soloedOut: boolean;
  setOutput(output: ChannelStrip['output']): void;
  setMute(mute: boolean): void;
  /** `seconds` is the ramp; 0 sets the gain at once. */
  setSoloedOut(soloedOut: boolean, seconds?: number): void;
  /**
   * Held shut while the strip's dry edge moves to another destination
   * (windsor#285): true ramps down, false ramps back to whatever the other
   * flags say.
   */
  setMoving(moving: boolean): void;
}

export function createAudibleGate(context: BaseAudioContext, strip: ChannelStrip): AudibleGate {
  const node = context.createGain();
  let sidechain = strip.output === 'sidechain';
  let mute = strip.mute === true;
  let soloedOut = false;
  let moving = false;
  const target = (): number => (sidechain || mute || soloedOut || moving ? 0 : 1);
  node.gain.value = target();
  const ramp = (seconds: number): void => {
    const now = context.currentTime;
    if (seconds <= 0) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(target(), now);
      return;
    }
    holdAt(node.gain, now);
    node.gain.linearRampToValueAtTime(target(), now + seconds);
  };
  return {
    node,
    get mute(): boolean {
      return mute;
    },
    get soloedOut(): boolean {
      return soloedOut;
    },
    // Always ramps, as it did before mute and solo: a repeated switch is harmless.
    setOutput(output): void {
      sidechain = output === 'sidechain';
      ramp(INSERT_FADE_SECONDS);
    },
    setMute(next): void {
      if (next === mute) return;
      mute = next;
      ramp(INSERT_FADE_SECONDS);
    },
    // Only a change schedules anything: the roster re-resolves solo after every live edit.
    setSoloedOut(next, seconds = INSERT_FADE_SECONDS): void {
      if (next === soloedOut) return;
      soloedOut = next;
      ramp(seconds);
    },
    setMoving(next): void {
      if (next === moving) return;
      moving = next;
      ramp(INSERT_FADE_SECONDS);
    },
  };
}

/**
 * Cancels what is scheduled after `now` and pins the value the param has
 * there, so a new ramp starts from it, in every browser and whatever the
 * param did before (windsor#694).
 *
 * `held` is the value pinned. A caller that tracks its own ramp passes the
 * value it computed (`fadeRamp`); by default it is `value`, read before the
 * cancel. A browser reports `value` as the timeline's at `currentTime`, and
 * Firefox reads the timeline as it stands, so a read after the cancel no
 * longer sees the cancelled ramp (measured: 0 mid-ramp, a full step).
 *
 * Both halves are needed in Chrome. `cancelAndHoldAtTime` alone holds only
 * when an event lies after `now`: after a finished ramp, or on a param whose
 * only event is the `value` it was built with, it adds nothing, the next
 * ramp runs from that last event, seconds ago, and the gain steps almost to
 * its target. A plain cancel and set can let the sample at `now` fall back
 * to the cancelled timeline's earlier value for one frame. Measured on
 * 2026-10-11 on an Apple M1 (macOS 26.7.1) in headless Chrome 155, with an
 * `OfflineAudioContext` at 48 kHz holding a constant 1 at `now` and then
 * ramping to 0 over 12 ms. The hold alone rendered 0.0132 at `now` after a
 * finished ramp and 0.0234 on a fresh param. Cancel and set put out
 * one-frame spikes of up to 0.89 in 5 of 63 renders. Hold then set ramped
 * from the held value in all 63
 * (`docs/research/2026-10-11-param-hold-on-a-finished-ramp/`).
 */
export function holdAt(param: AudioParam, now: number, held = param.value): void {
  const { cancelAndHoldAtTime } = param as Partial<Pick<AudioParam, 'cancelAndHoldAtTime'>>;
  if (cancelAndHoldAtTime) cancelAndHoldAtTime.call(param, now);
  else param.cancelScheduledValues(now);
  param.setValueAtTime(held, now);
}
