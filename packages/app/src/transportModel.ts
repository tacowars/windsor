/**
 * The transport strip's pure rules (#708): the `bar.beat.sixteenth` position
 * a tick reads as, the ▶ ■ ‖ state machine, and the partials the strip's
 * controls write. No DOM, no engine — `transportModel.test.ts` pins them.
 *
 * Epic #703 decision 8: ▶ runs from the current position; ■ halts, releases
 * every voice and rewinds to tick 0; ‖ pauses keeping the position
 * (`AudioSystem.setMuted`). The pressed state is ▶ or ‖; ■ is momentary.
 *
 * windsor#12: the tempo and bars boxes' typed entry, their drag, and tap
 * tempo are rules here too, so the DOM file only wires them.
 */
import type { DocumentPartial, ScaleName } from '@windsor/engine';
import { SCALE_NAMES } from '@windsor/engine';
import {
  BARS_DRAG_STEP,
  BARS_KNOB,
  BPM_KNOB,
  type DragFeel,
  type KnobRange,
  MS_PER_MINUTE,
  NUMBER_DRAG,
  NUMBER_DRAG_THRESHOLD_PX,
  POSITION_GRID,
  type PositionGrid,
  TAP_TEMPO,
  type TapTempo,
} from './transportTables';

export type TransportState = 'idle' | 'playing' | 'paused';
export type TransportAction = 'play' | 'pause' | 'stop';

/**
 * The song position of a transport tick, 1-based: tick 0 → `1.1.1`, tick 95
 * → `1.4.4`, tick 96 → `2.1.1`. The transport's tick never wraps; the song
 * does (`tick mod songTicks`, epic #703 decision 5), so the readout does too.
 */
export function formatPosition(
  tick: number,
  songTicks: number,
  grid: PositionGrid = POSITION_GRID,
): string {
  const t = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : Math.max(0, tick);
  const bar = Math.floor(t / grid.bar) + 1;
  const beat = Math.floor((t % grid.bar) / grid.beat) + 1;
  const sixteenth = Math.floor((t % grid.beat) / grid.sixteenth) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

/**
 * The next state: ▶ plays from anywhere; ‖ pauses only what is playing (an
 * idle or paused transport stays put); ■ is idle at tick 0 from anywhere.
 */
export function nextTransportState(state: TransportState, action: TransportAction): TransportState {
  switch (action) {
    case 'play':
      return 'playing';
    case 'pause':
      return state === 'playing' ? 'paused' : state;
    case 'stop':
      return 'idle';
  }
}

/** Which of ▶ / ‖ shows pressed; ■ never does. */
export const pressedButtons = (state: TransportState): { play: boolean; pause: boolean } => ({
  play: state === 'playing',
  pause: state === 'paused',
});

/** The strip's writes, each a live partial for `ctx.change` (issue decision 1). */
export const bpmChange = (bpm: number): DocumentPartial => ({ transport: { bpm } });
export const barsChange = (bars: number): DocumentPartial => ({ transport: { bars } });
export const keyChange = (root: number): DocumentPartial => ({ harmony: { root } });

/** A scale pick as a partial, or null for a value that names no scale (the custom row). */
export function scaleChange(name: string): DocumentPartial | null {
  const picked: ScaleName | undefined = SCALE_NAMES.find((known) => known === name);
  return picked ? { harmony: { scale: picked } } : null;
}

type BoxRange = Pick<KnobRange, 'min' | 'max' | 'step'>;

/** Decimal places a step carries: 0.01 → 2, 1 → 0. */
const stepDecimals = (step: number): number => String(step).split('.')[1]?.length ?? 0;

/**
 * Clamp into the range and round to its step, without the binary-fraction
 * tail a bare `round(v / 0.01) * 0.01` leaves (133.50000000000003).
 */
export function clampToStep(value: number, range: BoxRange): number {
  const step = range.step ?? 0;
  const stepped =
    step > 0 ? Number((Math.round(value / step) * step).toFixed(stepDecimals(step))) : value;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/**
 * A typed entry (windsor#12 decision 1): a number, clamped and rounded to the
 * box's step, or null for anything that is not a number, so the box reverts.
 * A decimal comma reads as a point, as some locales' decimal keypads type it.
 */
export function parseBoxEntry(text: string, range: BoxRange): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? clampToStep(value, range) : null;
}

export const parseBpm = (text: string): number | null => parseBoxEntry(text, BPM_KNOB);
export const parseBars = (text: string): number | null => parseBoxEntry(text, BARS_KNOB);

/** A vertical drag, in pixels (up positive), as a share of the range, the way a knob reads it. */
function dragDelta(upPx: number, fine: boolean, range: BoxRange, feel: DragFeel): number {
  return (upPx / (fine ? feel.fineRangePx : feel.rangePx)) * (range.max - range.min);
}

/**
 * The tempo a drag reaches (decision 2): the value it started from plus the
 * knob's share of the range per pixel, at the box's step, so a slow sweep
 * while playing moves smoothly.
 */
export function dragBpm(start: number, upPx: number, fine: boolean, feel = NUMBER_DRAG): number {
  return clampToStep(start + dragDelta(upPx, fine, BPM_KNOB, feel), BPM_KNOB);
}

/**
 * The song length a drag reaches (decision 2): whole steps of
 * `BARS_DRAG_STEP` on multiples of it — 6 dragged up is 8, then 12; 6 down
 * is 4; 4 down is 0, clamped to 1 — within `1..BARS_MAX`.
 */
export function dragBars(
  start: number,
  upPx: number,
  fine: boolean,
  feel = NUMBER_DRAG,
  step = BARS_DRAG_STEP,
): number {
  const steps = Math.trunc(dragDelta(upPx, fine, BARS_KNOB, feel) / step);
  if (steps === 0) return start;
  const base = steps > 0 ? Math.floor(start / step) * step : Math.ceil(start / step) * step;
  return clampToStep(base + steps * step, BARS_KNOB);
}

/** The taps tap tempo remembers, and the tempo they give once there are two. */
export interface TapResult {
  readonly taps: readonly number[];
  readonly bpm: number | null;
}

/**
 * One tap at `now` ms (decision 4): the average of the last
 * `TAP_TEMPO.intervals` intervals, from the second tap on, clamped and
 * rounded to the tempo box's step. A gap of `resetMs` or more starts again.
 */
export function tapTempo(
  taps: readonly number[],
  now: number,
  tap: TapTempo = TAP_TEMPO,
): TapResult {
  const last = taps.at(-1);
  const kept = last === undefined || now - last >= tap.resetMs ? [] : taps;
  const next = [...kept, now].slice(-(tap.intervals + 1));
  if (next.length < 2) return { taps: next, bpm: null };
  const interval = (now - (next[0] ?? now)) / (next.length - 1);
  return { taps: next, bpm: interval > 0 ? clampToStep(MS_PER_MINUTE / interval, BPM_KNOB) : null };
}

/** What a pointer move does to a press on a number box. */
export type PressMove = 'end' | 'wait' | 'drag';

/**
 * A move during a press on a number box: `end` once the primary button is no
 * longer held (a release outside the window, or a focus loss that never sent
 * `pointerup`, as `knob.ts` guards), `wait` while an unmoved press stays
 * inside the threshold (a click to type), `drag` otherwise.
 */
export function pressMove(
  moved: boolean,
  upPx: number,
  buttons: number,
  thresholdPx = NUMBER_DRAG_THRESHOLD_PX,
): PressMove {
  if ((buttons & 1) === 0) return 'end';
  return !moved && Math.abs(upPx) < thresholdPx ? 'wait' : 'drag';
}

/** The fields of a Tap event that decide whether it counts. */
export interface TapEvent {
  readonly type: string;
  readonly button: number;
  readonly detail: number;
}

/**
 * Whether an event on Tap counts as one tap. A mouse or touch counts on the
 * primary `pointerdown`, where the beat lands; a `click` counts only when its
 * `detail` is 0 (a keyboard, assistive technology or voice activation with
 * no press before it), so one physical tap never counts twice.
 */
export function countsAsTap(e: TapEvent): boolean {
  if (e.type === 'pointerdown') return e.button === 0;
  return e.type === 'click' && e.detail === 0;
}
