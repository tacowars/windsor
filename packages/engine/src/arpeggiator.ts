/**
 * The arpeggiator holds a pool, then walks it (record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §5).
 *
 * It samples a few weighted degrees from the shared `ScaleSampler` into a
 * pool, refreshes the pool every few bars -- on a bar line, like every other
 * regeneration -- and walks the pool `up | down | updown | random` with a
 * per-step chance of resting. "Random misses" is that one number.
 *
 * Every step that plays emits a note-on and its note-off together, so the
 * binding can queue both against the look-ahead clock at once.
 */
import { generatorRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { Register, ScaleSampler } from './scaleSampler';
import { isBarDivisor, type TickEvent, type TickSource, type Unsubscribe } from './scheduler';

export const ARP_WALK_MODES = ['up', 'down', 'updown', 'random'] as const;
export type ArpWalkMode = (typeof ARP_WALK_MODES)[number];

export interface ArpeggiatorConfig {
  /** Ticks per step. Must divide the bar. */
  divisor: number;
  /** Degrees drawn into the pool; duplicates collapse, so the pool may be smaller. */
  poolSize: number;
  /** Bars between pool refreshes. */
  refreshBars: number;
  walk: ArpWalkMode;
  /** Chance in [0, 1] that a step rests. 0 plays every step; 1 is silence. */
  skipChance: number;
  register: Register;
  /** Note length as a fraction of the step, in (0, 1]. */
  gate: number;
  seed: number;
  generatorIndex: number;
}

export const DEFAULT_ARPEGGIATOR_CONFIG: ArpeggiatorConfig = {
  divisor: 6,
  poolSize: 4,
  refreshBars: 4,
  walk: 'updown',
  skipChance: 0.2,
  register: { octave: 2, span: 1 },
  gate: 0.5,
  seed: 0,
  generatorIndex: 2,
};

interface PoolNote {
  degree: number;
  note: number;
}

function assertConfig(config: ArpeggiatorConfig): void {
  if (!isBarDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  if (!Number.isInteger(config.poolSize) || config.poolSize < 1) {
    throw new RangeError(`poolSize must be >= 1, got ${config.poolSize}`);
  }
  if (!Number.isInteger(config.refreshBars) || config.refreshBars < 1) {
    throw new RangeError(`refreshBars must be >= 1, got ${config.refreshBars}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  if (!(config.skipChance >= 0 && config.skipChance <= 1)) {
    throw new RangeError(`skipChance must be in [0, 1], got ${config.skipChance}`);
  }
}

export class Arpeggiator {
  readonly config: ArpeggiatorConfig;
  onNote: NoteHandler | null = null;

  private readonly sampler: ScaleSampler;
  private readonly rng: Rng;
  private pool: PoolNote[] = [];
  private position = 0;
  private direction = 1;

  constructor(sampler: ScaleSampler, config: ArpeggiatorConfig) {
    assertConfig(config);
    this.sampler = sampler;
    this.config = config;
    this.rng = generatorRng(config.seed, config.generatorIndex);
  }

  /** The pool being walked, ascending by pitch; refreshed only on a bar line. */
  get currentPool(): readonly PoolNote[] {
    return this.pool;
  }

  attach(source: TickSource): Unsubscribe {
    return source.subscribe(this.config.divisor, (event) => this.handleTick(event));
  }

  /**
   * One step. Returns the events it emitted: none for a rest, on + off for a
   * note. The pool is drawn on the first step it is ever needed -- an empty
   * pool is not a phrase to protect -- and after that only on a bar line
   * that opens a refresh period.
   */
  handleTick(event: TickEvent): NoteEvent[] {
    const refreshDue = event.tickInBar === 0 && event.bar % this.config.refreshBars === 0;
    if (this.pool.length === 0 || refreshDue) this.refreshPool();
    const index = this.nextIndex();
    const rest = this.rng() < this.config.skipChance;
    if (rest) return [];
    const chosen = this.pool[index];
    if (!chosen) return [];
    const durationTicks = Math.max(1, Math.round(this.config.gate * this.config.divisor));
    const events: NoteEvent[] = [
      {
        kind: 'noteOn',
        tick: event.tick,
        time: event.time,
        note: chosen.note,
        degree: chosen.degree,
      },
      {
        kind: 'noteOff',
        tick: event.tick + durationTicks,
        time: event.time + durationTicks * event.secondsPerTick,
        note: chosen.note,
      },
    ];
    for (const e of events) this.onNote?.(e);
    return events;
  }

  private refreshPool(): void {
    const byNote = new Map<number, PoolNote>();
    for (let i = 0; i < this.config.poolSize; i++) {
      const drawn = this.sampler.sampleNote(this.rng, this.config.register);
      byNote.set(drawn.note, drawn);
    }
    this.pool = [...byNote.values()].sort((a, b) => a.note - b.note);
    this.position = 0;
    this.direction = 1;
  }

  /** Advance the walk and return the pool index this step lands on. */
  private nextIndex(): number {
    const last = this.pool.length - 1;
    if (last < 1) return 0;
    switch (this.config.walk) {
      case 'random':
        return Math.floor(this.rng() * this.pool.length);
      case 'up': {
        const i = this.position;
        this.position = (i + 1) % this.pool.length;
        return i;
      }
      case 'down': {
        const i = last - this.position;
        this.position = (this.position + 1) % this.pool.length;
        return i;
      }
      case 'updown': {
        const i = this.position;
        if (i === last) this.direction = -1;
        else if (i === 0) this.direction = 1;
        this.position = i + this.direction;
        return i;
      }
    }
  }
}
