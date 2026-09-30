/**
 * The master column's meter parts (windsor#193 decision 3; record
 * `2026-09-30-master-column-and-meters`, decisions 4, 5 and 10): a vertical
 * peak bar, a vertical gain-reduction bar, the dB scales beside them, and a
 * thin horizontal bar for the bridge.
 *
 * Each bar is a fixed zone gradient under a cover scaled with `transform`,
 * with a hold line moved the same way, so drawing needs no layout; the
 * segments are a repeating gradient over the bar (`console.css`'s
 * `.meter-bar::after`). A readout's text is written only when it changes at
 * the shown precision. No `<meter>`. The numbers are `meterTables.ts`, the
 * rules `meterModel.ts`; this file only applies what the model returns.
 * The Mixer's master column and its bridge (windsor#194) lay them out and
 * run them on `meterLoop.ts`.
 */
import { el } from './dom';
import {
  elapsedSeconds,
  meterPosition,
  peakHoldTranslatePx,
  peakReadout,
  reductionHoldTranslatePx,
  reductionPosition,
  reductionReadout,
  restingMeter,
  stepMeter,
  zoneGradient,
  type MeterState,
} from './meterModel';
import {
  METER_BAR_WIDTH_PX,
  METER_CHANNEL_WIDTH_PX,
  METER_HOLD_LINE_PX,
  METER_TICKS_DB,
  METER_TRANSFORM_DECIMALS,
  REDUCTION_BALLISTICS,
  REDUCTION_NAMES,
  REDUCTION_QUIET_DB,
  REDUCTION_SCALE,
} from './meterTables';
import type { OutputGauge } from './outputStageModel';

const PERCENT = 100;
const px = (n: number): string => `${n.toFixed(1)}px`;

/** Writes a style property only when its text changed, so a steady bar costs nothing. */
function styleWriter(
  node: HTMLElement,
  property: 'transform' | 'opacity',
): (value: string) => void {
  let last = '';
  return (value) => {
    if (value === last) return;
    last = value;
    node.style[property] = value;
  };
}

/** Writes a readout's text only when it changed. */
function textWriter(node: HTMLElement): (text: string) => void {
  let last: string | null = null;
  return (text) => {
    if (text === last) return;
    last = text;
    node.textContent = text;
  };
}

/** The pieces every vertical channel has: LED slot, readout, bar, cover, hold, name. */
interface Channel {
  root: HTMLElement;
  led: HTMLElement;
  readout: HTMLElement;
  bar: HTMLElement;
  cover: HTMLElement;
  hold: HTMLElement;
  name: HTMLElement;
}

/** What every vertical channel is built from. */
interface ChannelOptions {
  name: string;
  label: string;
  heightPx: number;
  /** The channel's width; the shipped `METER_CHANNEL_WIDTH_PX` by default. */
  channelPx?: number;
}

function channel(options: ChannelOptions, led: boolean): Channel {
  const { name, label, heightPx } = options;
  const root = el('div', 'meter-channel');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);
  root.style.setProperty('--meter-ch-w', `${options.channelPx ?? METER_CHANNEL_WIDTH_PX}px`);
  root.style.setProperty('--meter-bar-w', `${METER_BAR_WIDTH_PX}px`);
  root.style.setProperty('--meter-h', `${heightPx}px`);
  const ledNode = led ? el('button', 'meter-led') : el('span', 'meter-led is-empty');
  const readout = el('button', 'meter-readout');
  for (const node of led ? [ledNode, readout] : [readout]) node.setAttribute('type', 'button');
  const bar = el('div', 'meter-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${label} level`);
  const cover = el('i', 'meter-cover');
  const hold = el('i', 'meter-hold');
  hold.style.height = `${METER_HOLD_LINE_PX}px`;
  bar.append(cover, hold);
  const nameNode = el('span', 'meter-name', name);
  root.append(ledNode, readout, bar, nameNode);
  return { root, led: ledNode, readout, bar, cover, hold, name: nameNode };
}

export interface PeakBarOptions extends ChannelOptions {
  /** The name under the bar: L, R. */
  name: string;
  /** What it measures, for assistive tech: "Output stage input, left". */
  label: string;
  /** A clip LED above the readout; clicking it calls `onClear`. */
  clipLed?: { onClear(): void };
  /** Draw a ceiling line, placed by `setCeiling`. */
  ceilingLine?: boolean;
}

export interface PeakBar {
  readonly root: HTMLElement;
  /** A new sample peak in dBFS (−∞ at silence), at frame time `nowMs`. */
  update(peakDb: number, nowMs: number): void;
  /** Light or clear the clip LED. */
  setClip(lit: boolean): void;
  /** Move the ceiling line, and redden the readout above it (0 dBFS otherwise). */
  setCeiling(db: number): void;
  /** Back to the floor, nothing held. */
  reset(): void;
}

/** A vertical peak bar with its held-peak readout, optional clip LED and ceiling line. */
export function createPeakBar(options: PeakBarOptions): PeakBar {
  const parts = channel(options, Boolean(options.clipLed));
  parts.bar.style.background = zoneGradient('to top');
  parts.readout.title = 'Peak over the last second. Click to reset.';
  const cover = styleWriter(parts.cover, 'transform');
  const hold = styleWriter(parts.hold, 'transform');
  const holdShown = styleWriter(parts.hold, 'opacity');
  const text = textWriter(parts.readout);
  const ceiling = options.ceilingLine ? el('i', 'meter-ceiling') : null;
  if (ceiling) parts.bar.appendChild(ceiling);
  let hotAboveDb = 0;
  let state: MeterState = restingMeter();
  let lastMs: number | null = null;

  const draw = (): void => {
    cover(`scaleY(${(1 - meterPosition(state.shownDb)).toFixed(METER_TRANSFORM_DECIMALS)})`);
    hold(`translateY(${px(peakHoldTranslatePx(state.heldDb, options.heightPx))})`);
    holdShown(meterPosition(state.heldDb) > 0 ? '1' : '0');
    text(peakReadout(state.heldDb));
    parts.readout.classList.toggle('is-hot', state.heldDb > hotAboveDb);
  };
  const reset = (): void => {
    state = restingMeter();
    lastMs = null;
    draw();
  };
  parts.readout.addEventListener('click', () => {
    state = { ...state, heldDb: -Infinity, heldSeconds: 0 };
    draw();
  });
  if (options.clipLed) {
    const { onClear } = options.clipLed;
    parts.led.title = 'Above 0 dBFS before the stage. Click to clear.';
    parts.led.setAttribute('aria-label', `Clear ${options.label} clip`);
    parts.led.addEventListener('click', () => {
      parts.led.classList.remove('is-lit');
      onClear();
    });
  }
  draw();
  return {
    root: parts.root,
    update(peakDb, nowMs) {
      state = stepMeter(state, peakDb, elapsedSeconds(lastMs, nowMs));
      lastMs = nowMs;
      draw();
    },
    setClip: (lit) => void parts.led.classList.toggle('is-lit', lit),
    setCeiling(db) {
      hotAboveDb = db;
      if (ceiling)
        ceiling.style.transform = `translateY(${px(-meterPosition(db) * options.heightPx)})`;
      draw();
    },
    reset,
  };
}

export interface ReductionBar {
  readonly root: HTMLElement;
  /** A new reading in dB (0 or more), at frame time `nowMs`. */
  update(db: number, nowMs: number): void;
  /** Which gauge it shows: GR, Over, or Off (dimmed). */
  setGauge(gauge: OutputGauge): void;
  reset(): void;
}

/** A vertical gain-reduction bar that fills from the top, renamed and dimmed by its gauge. */
export function createReductionBar(options: Omit<ChannelOptions, 'name'>): ReductionBar {
  const parts = channel({ ...options, name: REDUCTION_NAMES.reduction }, false);
  parts.bar.classList.add('is-reduction');
  parts.readout.title = 'Deepest over the last second. Click to reset.';
  const cover = styleWriter(parts.cover, 'transform');
  const hold = styleWriter(parts.hold, 'transform');
  const holdShown = styleWriter(parts.hold, 'opacity');
  const text = textWriter(parts.readout);
  const name = textWriter(parts.name);
  let off = false;
  let state: MeterState = restingMeter(REDUCTION_BALLISTICS);
  let lastMs: number | null = null;

  const draw = (): void => {
    cover(`scaleY(${(1 - reductionPosition(state.shownDb)).toFixed(METER_TRANSFORM_DECIMALS)})`);
    hold(`translateY(${px(reductionHoldTranslatePx(state.heldDb, options.heightPx))})`);
    holdShown(state.heldDb > REDUCTION_QUIET_DB ? '1' : '0');
    text(reductionReadout(state.heldDb, off));
  };
  const reset = (): void => {
    state = restingMeter(REDUCTION_BALLISTICS);
    lastMs = null;
    draw();
  };
  parts.readout.addEventListener('click', () => {
    state = { ...state, heldDb: 0, heldSeconds: 0 };
    draw();
  });
  draw();
  return {
    root: parts.root,
    update(db, nowMs) {
      state = stepMeter(state, db, elapsedSeconds(lastMs, nowMs), REDUCTION_BALLISTICS);
      lastMs = nowMs;
      draw();
    },
    setGauge(gauge) {
      off = gauge === 'none';
      name(REDUCTION_NAMES[gauge]);
      parts.root.classList.toggle('is-dim', off);
      draw();
    },
    reset,
  };
}

/** A scale column: one labelled tick per entry, `bottom` a fraction of the height. */
function scaleColumn(
  className: string,
  options: { label: string; heightPx: number },
  ticks: readonly { zero: boolean; bottom: number; text: string }[],
): HTMLElement {
  const scale = el('div', className);
  scale.setAttribute('role', 'img');
  scale.setAttribute('aria-label', options.label);
  scale.style.setProperty('--meter-h', `${options.heightPx}px`);
  for (const tick of ticks) {
    const span = el('span', tick.zero ? 'is-zero' : '', tick.text);
    span.style.bottom = `${(tick.bottom * PERCENT).toFixed(2)}%`;
    scale.appendChild(span);
  }
  return scale;
}

/** The dBFS scale the peak bars share: +6 at the top to −48. */
export function createPeakScale(options: { label: string; heightPx: number }): HTMLElement {
  const ticks = METER_TICKS_DB.map((db) => ({
    zero: db === 0,
    bottom: meterPosition(db),
    text: db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0',
  }));
  return scaleColumn('meter-scale', options, ticks);
}

/** The gain-reduction bar's scale: 0 dB at the top to the gauge's maximum. */
export function createReductionScale(options: { label: string; heightPx: number }): HTMLElement {
  const ticks = REDUCTION_SCALE.ticksDb.map((db) => ({
    zero: false,
    bottom: 1 - reductionPosition(db),
    text: String(db),
  }));
  return scaleColumn('meter-scale is-reduction', options, ticks);
}

export interface BridgeBar {
  readonly root: HTMLElement;
  update(peakDb: number, nowMs: number): void;
  setCeiling(db: number): void;
  reset(): void;
}

/** A thin horizontal peak bar for the meter bridge, with a ceiling mark. */
export function createBridgeBar(options: { label: string }): BridgeBar {
  const root = el('div', 'meter-hbar');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', options.label);
  root.style.background = zoneGradient('to right');
  const coverNode = el('i', 'meter-cover');
  const ceiling = el('i', 'meter-ceiling');
  root.append(coverNode, ceiling);
  const cover = styleWriter(coverNode, 'transform');
  let state: MeterState = restingMeter();
  let lastMs: number | null = null;
  const draw = (): void =>
    cover(`scaleX(${(1 - meterPosition(state.shownDb)).toFixed(METER_TRANSFORM_DECIMALS)})`);
  draw();
  return {
    root,
    update(peakDb, nowMs) {
      state = stepMeter(state, peakDb, elapsedSeconds(lastMs, nowMs));
      lastMs = nowMs;
      draw();
    },
    setCeiling(db) {
      ceiling.style.left = `${(meterPosition(db) * PERCENT).toFixed(2)}%`;
    },
    reset() {
      state = restingMeter();
      lastMs = null;
      draw();
    },
  };
}
