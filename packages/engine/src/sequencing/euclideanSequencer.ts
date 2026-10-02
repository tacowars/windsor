/**
 * A Euclidean sequencer: `E(k, n)` on the tick grid with `n` fixed and `k`
 * modulated between bounds (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §3).
 *
 * It emits onsets and knows nothing about audio; a binding maps an onset to a
 * part and a velocity, and any other listener can read the same onsets.
 *
 * The pattern regenerates only on a bar line, whichever modulator drives `k`,
 * so a density change never re-cuts a figure mid-flight. A hand edit is
 * different (#610): `reconfigure` re-cuts at once from the new steps and
 * rotation, keeping `k` and the stream. Step position is derived from the
 * absolute tick (`floor(tick / divisor) mod n`) either way, so the figure
 * stays phase-locked to the transport whatever `n * divisor` is and a
 * re-cut never moves the playhead.
 */
import { WALK_DOWN_CHANCE } from '../audioConstants';
import { euclid, type Pattern } from './euclid';
import { assertEuclidRows, type EuclidRows } from './euclidLanes';
import { streamRng, type Rng } from './generatorSeed';
import { isNoteDivisor, type TickEvent, type TickSource, type Unsubscribe } from './scheduler';

export const LFO_SHAPES = ['tri', 'sine', 'saw'] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

export type DensityMod =
  /** Bar-synced: the density peak lands on a downbeat every `bars` bars. */
  | { kind: 'lfoBars'; bars: number; shape: LfoShape }
  /** Free-running on transport time, deliberately unsynced from the bar. */
  | { kind: 'lfoHz'; hz: number; shape: LfoShape }
  /** `k` drunk-walks +-1 per bar within bounds, with `stepChance` of moving at all. */
  | { kind: 'walk'; stepChance: number };

export const DENSITY_MOD_KINDS = ['lfoBars', 'lfoHz', 'walk'] as const;
export type DensityModKind = (typeof DENSITY_MOD_KINDS)[number];

/**
 * The trigger row's fields, plus the ratchet row and the drawn lanes beside
 * it (`EuclidRows`, windsor#355): all optional, absent being a plain hit, so
 * on a part and on a region's pattern alike they leave today's figure alone.
 */
export interface EuclideanConfig extends EuclidRows {
  /** `n`: steps in the figure. Fixed; only `k` moves. */
  steps: number;
  /** Ticks per step. Must divide the bar (see `DIVISORS`). */
  divisor: number;
  /** Inclusive bounds `k` moves within; `start` is where a walk begins. */
  pulses: { min: number; max: number; start: number };
  /** Static rotation of the figure in steps. Nothing modulates it. */
  rotate: number;
  density: DensityMod;
  /** The part's own seed (#705, decision 16); the stream per region is `hashSeed(seed, regionIndex)`. */
  seed: number;
  /**
   * A captured figure (issue #70, record §6): played verbatim, never
   * regenerated, no RNG consumed. `null` or absent is generative.
   */
  pattern?: readonly boolean[] | null;
}

/** A defensible starting point: a 16-step figure, one bar long, breathing over 8 bars. */
export const DEFAULT_EUCLIDEAN_CONFIG: EuclideanConfig = {
  steps: 16,
  divisor: 6,
  pulses: { min: 3, max: 9, start: 5 },
  rotate: 0,
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  seed: 0,
};

export interface OnsetEvent {
  tick: number;
  time: number;
  /** Index of the onset's step within the figure: the ratchet row's key. */
  step: number;
  /** The figure the onset came from, for bindings that accent by density. */
  k: number;
  n: number;
  /**
   * Steps the trigger has counted since its region's entry (`TickEvent.step`):
   * the lanes' clock (windsor#355), each lane reading it mod its own length.
   */
  localStep: number;
  /** Seconds per straight tick at the tempo the step was issued under: a roll's span is read in it. */
  secondsPerTick: number;
}
export type OnsetHandler = (event: OnsetEvent) => void;

/**
 * LFO value in [0, 1] for a phase in [0, 1). Every shape peaks at phase 0 so
 * a bar-synced LFO puts its densest bar on the downbeat.
 */
export function lfoValue(shape: LfoShape, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'tri':
      return Math.abs(1 - 2 * p);
    case 'sine':
      return (1 + Math.cos(2 * Math.PI * p)) / 2;
    case 'saw':
      return 1 - p;
  }
}

function assertDensity(mod: DensityMod): void {
  switch (mod.kind) {
    case 'lfoBars':
      if (!(mod.bars > 0)) throw new RangeError(`lfoBars.bars must be > 0, got ${mod.bars}`);
      return;
    case 'lfoHz':
      if (!(mod.hz >= 0)) throw new RangeError(`lfoHz.hz must be >= 0, got ${mod.hz}`);
      return;
    case 'walk':
      if (!(mod.stepChance >= 0 && mod.stepChance <= 1)) {
        throw new RangeError(`walk.stepChance must be in [0, 1], got ${mod.stepChance}`);
      }
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan` so a bad live edit is refused before anything commits (#610). */
export function assertEuclideanConfig(config: EuclideanConfig): void {
  const { steps, divisor, pulses } = config;
  if (!Number.isInteger(steps) || steps < 1)
    throw new RangeError(`steps must be >= 1, got ${steps}`);
  if (!isNoteDivisor(divisor)) throw new RangeError(`divisor must divide the bar, got ${divisor}`);
  const inRange = (k: number) => Number.isInteger(k) && k >= 0 && k <= steps;
  if (!inRange(pulses.min) || !inRange(pulses.max) || pulses.min > pulses.max) {
    throw new RangeError(`pulses bounds must satisfy 0 <= min <= max <= ${steps}`);
  }
  assertDensity(config.density);
  assertEuclidRows(config);
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
  const { pattern } = config;
  if (pattern != null) {
    if (pattern.length !== steps) {
      throw new RangeError(`pattern must have ${steps} steps, got ${pattern.length}`);
    }
    for (const step of pattern) {
      if (typeof step !== 'boolean') throw new RangeError('pattern steps must be booleans');
    }
  }
}

const countOnsets = (pattern: Pattern): number => pattern.filter(Boolean).length;

export class EuclideanSequencer {
  onOnset: OnsetHandler | null = null;

  private current: EuclideanConfig;
  private rng: Rng;
  private fixed: Pattern | null;
  private pattern: Pattern;
  private k: number;

  constructor(config: EuclideanConfig) {
    assertEuclideanConfig(config);
    this.current = config;
    this.rng = streamRng(config.seed, 0);
    this.fixed = config.pattern ?? null;
    this.k = this.fixed ? countOnsets(this.fixed) : this.clampK(config.pulses.start);
    this.pattern = this.fixed ?? euclid(this.k, config.steps, config.rotate);
  }

  /**
   * The region gate entered `regionIndex` from outside (#705): the stream
   * restarts from `hashSeed(seed, regionIndex)` and a generative walk goes
   * back to `pulses.start`, so the region opens the way the song did.
   */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
    if (this.fixed) return;
    this.k = this.clampK(this.current.pulses.start);
    this.pattern = euclid(this.k, this.current.steps, this.current.rotate);
  }

  get config(): EuclideanConfig {
    return this.current;
  }

  /**
   * Take new fields without a rebuild (#610): the stream and the current `k`
   * carry on — `k` clamped into the new bounds — and the figure is re-cut at
   * once from the new steps, rotation and that `k`, so a knob turned by hand
   * shows on the next step while the modulator still moves `k` only on a bar
   * line. A captured `pattern` swaps to the fixed figure; `null` returns to
   * generative from the current `k`. The ratchet row, the accent amounts and
   * the lanes (windsor#355) are read at each hit, so an edit to them takes
   * here too, the figure, `k` and the playhead carrying on. The divisor is
   * the subscription and the seed is the stream: both need a rebuild.
   */
  reconfigure(config: EuclideanConfig): void {
    assertEuclideanConfig(config);
    if (config.divisor !== this.current.divisor) {
      throw new RangeError(
        'a divisor change rebuilds the sequencer; it cannot be reconfigured live',
      );
    }
    if (config.seed !== this.current.seed) {
      throw new RangeError('a seed change rebuilds the sequencer; it cannot be reconfigured live');
    }
    this.current = config;
    this.fixed = config.pattern ?? null;
    this.k = this.fixed ? countOnsets(this.fixed) : this.clampK(this.k);
    this.pattern = this.fixed ?? euclid(this.k, config.steps, config.rotate);
  }

  /** The figure currently playing; swapped only on a bar line. */
  get currentPattern(): Pattern {
    return this.pattern;
  }

  get currentK(): number {
    return this.k;
  }

  /** The step index a local step (since the region entry) lands on — the console's playhead reads this too (#619). */
  stepAt(localStep: number): number {
    const { steps } = this.current;
    return ((localStep % steps) + steps) % steps;
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(this.current.divisor, (event) => this.handleTick(event));
  }

  /**
   * One step of the figure. Returns the onset it emitted, if any. The figure
   * is only ever swapped on a bar line; started or attached mid-bar, the
   * constructor's figure plays out to the next one.
   */
  handleTick(event: TickEvent): OnsetEvent | null {
    if (this.fixed === null && event.tickInBar === 0) this.regenerate(event);
    const step = this.stepAt(event.step);
    if (!this.pattern[step]) return null;
    const onset: OnsetEvent = {
      tick: event.tick,
      time: event.time,
      step,
      k: this.k,
      n: this.current.steps,
      localStep: event.step,
      secondsPerTick: event.secondsPerTick,
    };
    this.onOnset?.(onset);
    return onset;
  }

  private regenerate(event: TickEvent): void {
    const next = this.nextK(event);
    if (next === this.k) return;
    this.k = next;
    this.pattern = euclid(next, this.current.steps, this.current.rotate);
  }

  private nextK(event: TickEvent): number {
    const mod = this.current.density;
    switch (mod.kind) {
      case 'lfoBars':
        return this.kFromLfo(mod.shape, event.bar / mod.bars);
      case 'lfoHz':
        return this.kFromLfo(mod.shape, event.seconds * mod.hz);
      case 'walk': {
        if (this.rng() >= mod.stepChance) return this.k;
        return this.clampK(this.k + (this.rng() < WALK_DOWN_CHANCE ? -1 : 1));
      }
    }
  }

  private kFromLfo(shape: LfoShape, phase: number): number {
    const { min, max } = this.current.pulses;
    return min + Math.round(lfoValue(shape, phase) * (max - min));
  }

  private clampK(k: number): number {
    const { min, max } = this.current.pulses;
    return Math.min(max, Math.max(min, Math.trunc(k)));
  }
}
