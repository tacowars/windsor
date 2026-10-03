/**
 * The rules behind the mixer lights (windsor#159), pure so they are tested
 * in Node: the green light's brightness from a peak, the colours it is drawn
 * at, and the red light's latch. The part strip's chips (windsor#528) read
 * every part's lights from the part meter bank through one `BankLights`;
 * the Mixer tab's group lights read strip meters.
 *
 * The latch is the app's, not the meter's. A meter's `setActive(false)`
 * zeroes its report, overload included, so the red light keeps its own
 * state by slot: set by a read that shows an overload, cleared only by a
 * click, and dropped when the slot's meter is a different object (a rebuilt
 * system) or the part is gone.
 */
import { amplitudeDb } from './masterTables';
import type { MixerLightTable } from './songMixerLightsTables';
import { MIXER_LIGHTS } from './songMixerLightsTables';

/**
 * The green light's brightness, 0 (dark) to 1 (lit), for a sample peak in
 * linear amplitude: dark at or below the floor, fully lit at 0 dBFS and
 * above, and between them the peak's place on the dB scale raised to the
 * table's curve.
 */
export function peakBrightness(peak: number, table: MixerLightTable = MIXER_LIGHTS): number {
  if (!(peak > 0)) return 0;
  const db = amplitudeDb(peak);
  if (db <= table.floorDb) return 0;
  if (db >= 0) return 1;
  return ((db - table.floorDb) / -table.floorDb) ** table.curve;
}

/** The step a brightness is drawn at, 0 to `table.steps`. */
export const lightStep = (brightness: number, table: MixerLightTable = MIXER_LIGHTS): number =>
  Math.round(Math.min(1, Math.max(0, brightness)) * table.steps);

const mixChannel = (dark: number, lit: number, t: number): number =>
  Math.round(dark + (lit - dark) * t);

/** The CSS colour of every step, dark first and lit last, built once rather than per frame. */
export function lightRamp(table: MixerLightTable = MIXER_LIGHTS): readonly string[] {
  return Array.from({ length: table.steps + 1 }, (_, step) => {
    const t = step / table.steps;
    const [r, g, b] = table.darkColor.map((dark, i) => mixChannel(dark, table.litColor[i]!, t));
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/** One meter report as the latch sees it. */
export interface LatchRead {
  readonly revision: number;
  readonly overload: boolean;
}

interface Latch<M> {
  readonly meter: M;
  clipped: boolean;
  /** Reports up to this revision were posted before the last clear reached the worklet. */
  quietThrough: number;
}

/**
 * The red lights' latches by slot. `M` is the meter's identity: any value
 * compared with `===`, `undefined` while the slot has no live strip.
 */
export class ClipLatches<M> {
  private readonly bySlot = new Map<number, Latch<M>>();

  constructor(private readonly table: MixerLightTable = MIXER_LIGHTS) {}

  /**
   * A read of the slot's meter. A meter other than the one last seen drops
   * the latch and starts a fresh one; an overload sets it, except in a
   * report the last clear expects to be stale. Returns whether it is lit.
   */
  observe(slot: number, meter: M, read: LatchRead): boolean {
    let latch = this.bySlot.get(slot);
    if (!latch || latch.meter !== meter) {
      latch = { meter, clipped: false, quietThrough: -Infinity };
      this.bySlot.set(slot, latch);
    }
    if (read.overload && read.revision > latch.quietThrough) latch.clipped = true;
    return latch.clipped;
  }

  /** Whether the slot's red light is lit. */
  lit(slot: number): boolean {
    return this.bySlot.get(slot)?.clipped ?? false;
  }

  /** A click: put the light out, ignoring the reports that may predate the reset. */
  clear(slot: number, revision: number): void {
    const latch = this.bySlot.get(slot);
    if (!latch) return;
    latch.clipped = false;
    latch.quietThrough = revision + this.table.staleReports;
  }

  /** Forget every slot `keep` refuses: its part is gone. */
  retain(keep: (slot: number) => boolean): void {
    for (const slot of this.bySlot.keys()) if (!keep(slot)) this.bySlot.delete(slot);
  }
}

/** A peak report as a light reads it: the strip meter's and the part meter bank's. */
export interface LightReport {
  readonly left: number;
  readonly right: number;
  readonly overload: boolean;
}

/** The green light's step for a report, from its louder channel; dark with none. */
export const reportStep = (
  report: LightReport | undefined,
  table: MixerLightTable = MIXER_LIGHTS,
): number =>
  lightStep(peakBrightness(Math.max(report?.left ?? 0, report?.right ?? 0), table), table);

/** What the lights read of a meter bank: the part meter bank's (windsor#540) shape. */
export interface LightBank {
  /** Advances with each report, and when a slot is reset. */
  readonly revision: number;
  read(slot: number): LightReport;
}

/** A part as the lights know it: its slot, which is its input on the bank. */
interface SlotOwner {
  readonly slot: number;
}

/**
 * Every part's two lights from one meter bank (windsor#528): a green step and
 * a red latch per slot, one copy for the part strip's chips and the Song
 * mixer, so a clear on either puts both out. `update` reads the bank only
 * when its revision or the part list moved, and `changes` advances only when
 * a step or a latch did, so a view repaints only then.
 */
export class BankLights<B extends LightBank> {
  private bank: B | undefined;
  private revision = 0;
  private parts: readonly SlotOwner[] = [];
  private readonly steps = new Map<number, number>();
  private readonly latches: ClipLatches<B | undefined>;
  private count = 0;

  constructor(private readonly table: MixerLightTable = MIXER_LIGHTS) {
    this.latches = new ClipLatches(table);
  }

  /** A count that moves whenever a light must be drawn again. */
  get changes(): number {
    return this.count;
  }

  /** Read `parts`' slots from `bank`, `undefined` while audio is off, if either moved. */
  update(bank: B | undefined, parts: readonly SlotOwner[]): void {
    const revision = bank?.revision ?? 0;
    if (bank === this.bank && revision === this.revision && parts === this.parts) return;
    if (parts !== this.parts) this.forgetOthers(parts);
    this.bank = bank;
    this.revision = revision;
    this.parts = parts;
    let changed = false;
    for (const { slot } of parts) {
      const report = bank?.read(slot);
      const was = this.latches.lit(slot);
      const lit = this.latches.observe(slot, bank, {
        revision,
        overload: report?.overload ?? false,
      });
      const step = reportStep(report, this.table);
      if (step !== this.step(slot) || lit !== was) changed = true;
      this.steps.set(slot, step);
    }
    if (changed) this.count++;
  }

  /** The slot's green step, 0 (dark) to the table's `steps`. */
  step(slot: number): number {
    return this.steps.get(slot) ?? 0;
  }

  /** Whether the slot's red light is lit. */
  lit(slot: number): boolean {
    return this.latches.lit(slot);
  }

  /** A click on either view's red light: out, ignoring the reports that may predate the reset. */
  clear(slot: number): void {
    if (!this.latches.lit(slot)) return;
    this.latches.clear(slot, this.revision);
    this.count++;
  }

  /** A removed part's light goes with it, so a part added on its slot starts dark. */
  private forgetOthers(parts: readonly SlotOwner[]): void {
    const slots = new Set(parts.map((part) => part.slot));
    this.latches.retain((slot) => slots.has(slot));
    for (const slot of [...this.steps.keys()]) if (!slots.has(slot)) this.steps.delete(slot);
  }
}
