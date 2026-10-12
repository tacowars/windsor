/**
 * The compact knob's value bubble, as values (windsor#768 decisions 6 and 7;
 * record `2026-10-12-song-mixer-arrows-and-value-bubbles`): what it reads,
 * when a pointer, focus or reset input shows or hides it, and where it sits.
 * `knobBubble.ts` is the DOM over these.
 */
import { CARRIER_COLOR } from './consoleColors';
import type { KnobAutomation } from './knobAutomation';
import { ENV_TAG_TEXT, lockTagText } from './knobLock';
import type { KnobBubbleGeometry, KnobBubbleTiming } from './knobBubbleTables';
import { KNOB_BUBBLE_PX, KNOB_BUBBLE_TIMING } from './knobBubbleTables';

/** The tag a held or moving knob shows in its bubble, in the lock's colour. */
export interface KnobBubbleTag {
  readonly text: string;
  readonly color: string;
}

/** What the bubble reads: the knob's label, its value, and its lock's tag. */
export interface KnobBubbleContent {
  readonly label: string;
  readonly value: string;
  readonly tag: KnobBubbleTag | null;
}

/** What a knob tells its bubble on each redraw. */
export interface KnobBubbleReading {
  /** The knob's label now. */
  readonly label: string;
  /** Its value as the spec's own `fmt` prints it. */
  readonly value: string;
  /** The unit the bubble adds after the value, if any ("Hz" on Low cut). */
  readonly unit?: string | undefined;
  /** The lane or macro holding the knob. */
  readonly lock: KnobAutomation | null;
  /** Whether a clip envelope moves it. */
  readonly enveloped: boolean;
}

/**
 * The bubble's content: the label, the value with its unit, and the tag a
 * lock shows (its macro's name, else AUTO, in the lane's colour) or, with
 * no lock, ENV in the envelope's colour while a clip envelope moves it.
 */
export function knobBubbleContent(reading: KnobBubbleReading): KnobBubbleContent {
  const { lock } = reading;
  let tag: KnobBubbleTag | null = null;
  if (lock) tag = { text: lockTagText(lock), color: lock.color };
  else if (reading.enveloped) tag = { text: ENV_TAG_TEXT, color: CARRIER_COLOR };
  const value = reading.unit ? `${reading.value} ${reading.unit}` : reading.value;
  return { label: reading.label, value, tag };
}

/** Where the pointer and the focus are, as far as the bubble cares. */
export interface KnobBubbleState {
  readonly over: boolean;
  readonly pressed: boolean;
  /** Keyboard focus (`:focus-visible`), not a click's. */
  readonly focused: boolean;
}

export const BUBBLE_IDLE: KnobBubbleState = { over: false, pressed: false, focused: false };

/** An input the bubble answers. `inside`: whether the release left the pointer on the knob. */
export type KnobBubbleInput =
  | { readonly kind: 'enter' | 'leave' | 'press' | 'focus' | 'blur' | 'reset' }
  | { readonly kind: 'release'; readonly inside: boolean };

/**
 * What the bubble does. `show`: cancel a pending hide and show after this
 * many ms, at once if it is already up; then, with `hideAfter`, hide that
 * long later. `hide`: cancel a pending show and hide after this many ms.
 */
export type KnobBubbleAction =
  { readonly show: number; readonly hideAfter?: number } | { readonly hide: number } | null;

/** The state after an input, and what the bubble does about it. */
export interface KnobBubbleStep {
  readonly state: KnobBubbleState;
  readonly action: KnobBubbleAction;
}

/** Whether something other than the hover holds the bubble up. */
const held = (s: KnobBubbleState): boolean => s.pressed || s.focused;

/**
 * The bubble's next state and action (decision 6): a hover shows it after
 * `hoverMs`, a press and keyboard focus at once; it stays through a drag,
 * and hides `leaveMs` after the pointer leaves, `releaseMs` after a release
 * off the knob, at once on a blur. A reset shows it for `resetMs`.
 */
export function knobBubbleStep(
  state: KnobBubbleState,
  input: KnobBubbleInput,
  timing: KnobBubbleTiming = KNOB_BUBBLE_TIMING,
): KnobBubbleStep {
  switch (input.kind) {
    case 'enter':
      return {
        state: { ...state, over: true },
        action: { show: held(state) ? 0 : timing.hoverMs },
      };
    case 'leave': {
      const next = { ...state, over: false };
      return { state: next, action: !state.over || held(state) ? null : { hide: timing.leaveMs } };
    }
    case 'press':
      return { state: { ...state, pressed: true }, action: { show: 0 } };
    case 'release': {
      const next = { ...state, pressed: false, over: input.inside };
      const stays = !state.pressed || input.inside || state.focused;
      return { state: next, action: stays ? null : { hide: timing.releaseMs } };
    }
    case 'focus':
      return { state: { ...state, focused: true }, action: { show: 0 } };
    case 'blur': {
      const next = { ...state, focused: false };
      return { state: next, action: state.pressed || state.over ? null : { hide: 0 } };
    }
    case 'reset':
      return { state, action: { show: 0, hideAfter: timing.resetMs } };
  }
}

/** The dial the bubble sits over, and the bubble's and the window's sizes, in px. */
export interface KnobBubbleAnchor {
  /** The dial's centre, across. */
  readonly centreX: number;
  /** The dial's top edge. */
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number;
}

/** Where the bubble goes, in viewport px, and where its tip points from its left edge. */
export interface KnobBubblePlace {
  readonly left: number;
  readonly top: number;
  readonly tipX: number;
}

/**
 * The bubble centred above the dial, `gapPx` clear of it, held `marginPx`
 * inside the window; its tip stays on the dial's centre when it is held.
 */
export function knobBubblePlace(
  anchor: KnobBubbleAnchor,
  geometry: KnobBubbleGeometry = KNOB_BUBBLE_PX,
): KnobBubblePlace {
  const { centreX, width } = anchor;
  const most = Math.max(geometry.marginPx, anchor.viewportWidth - geometry.marginPx - width);
  const left = Math.min(most, Math.max(geometry.marginPx, centreX - width / 2));
  return { left, top: anchor.top - geometry.gapPx - anchor.height, tipX: centreX - left };
}
