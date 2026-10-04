/**
 * The player's binding per sequencer kind (#705): the one switch that builds
 * a part's generator, says what rebuilds it, reconfigures it live, releases
 * what it holds and reads its playhead. `ArrangementPlayer` owns the parts
 * and the transport; this file owns the kinds, so adding one (#706's `arp`,
 * #707's `bass`) is a `case` here and nothing in the player.
 *
 * Every generator meets one contract: `attach(gate)` at its divisor,
 * `reconfigure(config, sampler?)`, `enter(regionIndex)` when the region gate
 * enters a region (the stream restarts from `hashSeed(seed, regionIndex)`),
 * `release(tick, time)` for what it holds (pitched kinds), and a `stepAt`
 * over its local position.
 */
import type {
  ArpDriver,
  BassDriver,
  ChordDriver,
  EuclideanDriver,
  FigureDriver,
  GridDriver,
  RollDriver,
  SequencerKind,
  SequencerSpec,
} from './arrangement';
import { driverOf } from './arrangement';
import { assertArpConfig } from '../sequencing/arpSequencer';
import { Arpeggiator } from '../sequencing/arpeggiator';
import { BassSequencer, assertBassConfig } from '../sequencing/bassSequencer';
import { ChordSequencer, assertChordConfig } from '../sequencing/chordSequencer';
import { EuclideanSequencer, assertEuclideanConfig } from '../sequencing/euclideanSequencer';
import {
  FigureSequencer,
  assertFigureConfig,
  type FigureResolver,
} from '../sequencing/figureSequencer';
import { GridSequencer, assertGridConfig } from '../sequencing/gridSequencer';
import { RollSequencer, assertRollConfig } from '../sequencing/rollSequencer';
import type { ScaleSampler } from '../sequencing/scaleSampler';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

export type Generator =
  | EuclideanSequencer
  | GridSequencer
  | ChordSequencer
  | Arpeggiator
  | BassSequencer
  | FigureSequencer
  | RollSequencer;

/** A generator emitting note events, whose held notes a region end releases. */
export type PitchedGenerator = Exclude<Generator, EuclideanSequencer>;

export const isPitched = (generator: Generator | null): generator is PitchedGenerator =>
  generator !== null && !(generator instanceof EuclideanSequencer);

const sig = (value: unknown): string => JSON.stringify(value) ?? 'absent';

/**
 * What builds a part's generator: its kind, its divisor (the subscription)
 * and its seed (the stream — a seed edit restarts the part at once, by a
 * rebuild; record `2026-09-26-harmony-v2-document-v3-timeline-and-regions`).
 * A Chord Player and a Roll subscribe at every tick and draw nothing, so
 * only their kind rebuilds them. Every other field reconfigures the live generator, so
 * an edit never cuts the held note or restarts the stream; `regions` and the
 * harmony are the gate's and rebuild nothing. Since windsor#74 the rule
 * holds per region: each region's pattern has its own generator, and the
 * sig of that pattern (with the part's seed) says whether an edit to it
 * rebuilds that generator or reconfigures it (`partBinding.ts`).
 */
export function generatorSig(spec: SequencerSpec): string {
  if (spec.kind === 'none' || spec.kind === 'chord' || spec.kind === 'roll')
    return sig([spec.kind]);
  return sig([spec.kind, spec.divisor, spec.seed]);
}

/** The kind that builds no generator, so a part of it has no binding: `none`. */
export const buildsNoGenerator = (kind: SequencerKind): boolean => kind === 'none';

/**
 * The generator a spec builds — a part's `sequencer`, or one region's
 * pattern (`regionPattern`, windsor#74) — or null for `none`. A Figure
 * counts its schedule and drift in bars of `barTicks`, the song meter's bar,
 * and a canon finds its leader through `figureOf` (windsor#487).
 */
export function buildGenerator(
  spec: SequencerSpec,
  sampler: ScaleSampler,
  barTicks = TICKS_PER_BAR,
  figureOf?: FigureResolver,
): Generator | null {
  const driver: unknown = driverOf(spec);
  switch (spec.kind) {
    case 'euclidean':
      return new EuclideanSequencer(driver as EuclideanDriver);
    case 'grid':
      return new GridSequencer(sampler, driver as GridDriver);
    case 'chord':
      return new ChordSequencer(sampler, driver as ChordDriver);
    case 'arp':
      return new Arpeggiator(sampler, driver as ArpDriver);
    case 'bass':
      return new BassSequencer(sampler, driver as BassDriver);
    case 'figure':
      return new FigureSequencer(sampler, driver as FigureDriver, barTicks, figureOf);
    case 'roll':
      return new RollSequencer(driver as RollDriver);
    default:
      return null;
  }
}

/**
 * A part kept live is validated here, inside the player's transaction: a bad
 * edit (a length past its steps, a pulse bound past the figure) is refused
 * before the tempo, the patches or the arrangement change, exactly as a
 * rebuild's constructor would be. What comes back runs after the commit,
 * against the sampler the commit installs. Null when the kinds disagree.
 */
export function liveReconfiguration(
  generator: Generator | null,
  spec: SequencerSpec,
  sampler: ScaleSampler,
): (() => void) | null {
  const driver: unknown = driverOf(spec);
  if (spec.kind === 'grid' && generator instanceof GridSequencer) {
    const config = driver as GridDriver;
    assertGridConfig(config);
    return () => generator.reconfigure(config, sampler);
  }
  if (spec.kind === 'chord' && generator instanceof ChordSequencer) {
    const config = driver as ChordDriver;
    assertChordConfig(config);
    return () => generator.reconfigure(config, sampler);
  }
  if (spec.kind === 'euclidean' && generator instanceof EuclideanSequencer) {
    const config = driver as EuclideanDriver;
    assertEuclideanConfig(config);
    return () => generator.reconfigure(config);
  }
  if (spec.kind === 'arp' && generator instanceof Arpeggiator) {
    const config = driver as ArpDriver;
    assertArpConfig(config);
    return () => generator.reconfigure(config, sampler);
  }
  if (spec.kind === 'bass' && generator instanceof BassSequencer) {
    const config = driver as BassDriver;
    assertBassConfig(config);
    return () => generator.reconfigure(config, sampler);
  }
  if (spec.kind === 'figure' && generator instanceof FigureSequencer) {
    const config = driver as FigureDriver;
    assertFigureConfig(config);
    return () => generator.reconfigure(config, sampler);
  }
  if (spec.kind === 'roll' && generator instanceof RollSequencer) {
    const config = driver as RollDriver;
    assertRollConfig(config);
    return () => generator.reconfigure(config);
  }
  return null;
}

/**
 * The step a generator is sounding at a local tick (since its region entry),
 * or -1 when it has no position to show — an empty Chord Player, a stub
 * (#619 decision 2). Each generator's own `stepAt` answers, so the console's
 * playhead *is* the engine's rule rather than a second copy of it. A Roll's
 * step is its loop tick (windsor#600), which has no divisor.
 */
export function generatorStepAt(generator: Generator, localTick: number): number {
  if (generator instanceof ChordSequencer) return generator.stepAt(localTick)?.step ?? -1;
  if (generator instanceof RollSequencer) return generator.stepAt(localTick);
  return generator.stepAt(Math.floor(localTick / generator.config.divisor));
}
