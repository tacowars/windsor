/**
 * The strip's audible gate: the one gain after the tap's head that the dry
 * path and every send pass through (#667, windsor#154). It is open only
 * while the part is routed to the master, is not muted and is not soloed
 * out, so each of those cuts the dry signal and the sends together,
 * post-fader. The sidechain key is tapped at the head, before the gate, so
 * none of them changes what a detector hears.
 *
 * A change ramps over `INSERT_FADE_SECONDS`, as the output switch always
 * has, so it never clicks. A caller building a system that has not played
 * yet may ask for no ramp, so a render's first block is already right.
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
}

export function createAudibleGate(context: BaseAudioContext, strip: ChannelStrip): AudibleGate {
  const node = context.createGain();
  let sidechain = strip.output === 'sidechain';
  let mute = strip.mute === true;
  let soloedOut = false;
  const target = (): number => (sidechain || mute || soloedOut ? 0 : 1);
  node.gain.value = target();
  const ramp = (seconds: number): void => {
    const now = context.currentTime;
    node.gain.cancelScheduledValues(now);
    if (seconds <= 0) {
      node.gain.setValueAtTime(target(), now);
      return;
    }
    node.gain.setValueAtTime(node.gain.value, now);
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
  };
}
