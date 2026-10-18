/**
 * The metronome (windsor#906): a click on every counted beat of the song's
 * meter while the transport runs, the bar line's louder and higher.
 *
 * It is a subscriber of the transport like every part's generator, so each
 * click is played at its tick's stamped `time`, through the look-ahead, and
 * never from a frame or a timer. The bar and the beat are read from each
 * tick: `tickInBar` is the transport's own, and the beats are the meter's at
 * that tick (`METER_TABLE`). A loop jump, a seek mid-bar, a meter change and
 * a tempo change therefore all keep the accent on the bar line, from the
 * next beat. Swing moves no click, since a beat is a pair boundary.
 *
 * It subscribes on the coarsest grid every meter's beats fall on (12 ticks
 * for the shipped table), not every tick, and allocates nothing per tick
 * beyond the note it plays. The voice is structural: `AudioSystem` hands in
 * an aux part (`createAuxPart`), and a test a recorder.
 */
import { meterBeats } from './meter';
import { METER_TABLE, type Meter, type MeterBeats, type MeterTable } from './meterTables';
import { METRONOME_TABLE, type MetronomeTable } from './metronomeTables';
import type { TickEvent, TickSource, Unsubscribe } from './scheduler';

/** What the metronome plays its clicks on: an `AudioPart` is one. */
export interface ClickVoice {
  /** A note of fixed length at clock time `time`. */
  trigger(note: number, velocity: number, duration: number, time: number): number;
  /** Release what sounds and drop every queued note. */
  allNotesOff(): void;
}

/** The transport as the metronome reads it: its ticks and its meter. */
export interface MetronomeClock extends TickSource {
  readonly meter: Meter;
}

/**
 * The counted beat that starts at `tickInBar`, 0 for the bar line, or -1
 * between beats. An index loop: it runs on every subscribed tick.
 */
export function beatAt(tickInBar: number, beats: MeterBeats): number {
  let start = 0;
  for (let i = 0; i < beats.length; i++) {
    if (tickInBar === start) return i;
    if (tickInBar < start) return -1;
    start += beats[i]!;
  }
  return -1;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The coarsest tick grid every beat of every meter in `table` starts on. */
export function beatGrid(table: MeterTable = METER_TABLE): number {
  let grid = 0;
  for (const beats of Object.values(table)) for (const beat of beats) grid = gcd(grid, beat);
  return grid;
}

export class Metronome {
  private unsubscribe: Unsubscribe | null = null;
  private readonly grid: number;

  constructor(
    private readonly clock: MetronomeClock,
    private readonly voice: ClickVoice,
    private readonly table: MetronomeTable = METRONOME_TABLE,
    private readonly meters: MeterTable = METER_TABLE,
  ) {
    this.grid = beatGrid(meters);
  }

  get on(): boolean {
    return this.unsubscribe !== null;
  }

  /**
   * On, it clicks on every beat the running transport issues from now; off,
   * it stops and drops the clicks the look-ahead already queued, and a click
   * sounding rings out its decay.
   */
  setOn(on: boolean): void {
    if (on === this.on) return;
    if (on) {
      this.unsubscribe = this.clock.subscribe(this.grid, this.tick);
      return;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.voice.allNotesOff();
  }

  /**
   * The transport halted (‖ or ■): the queued clicks are dropped, as every
   * part's are, and the next start clicks again on its first beat.
   */
  halt(): void {
    if (this.on) this.voice.allNotesOff();
  }

  private readonly tick = (event: TickEvent): void => {
    const beat = beatAt(event.tickInBar, meterBeats(this.clock.meter, this.meters));
    if (beat < 0) return;
    const click = beat === 0 ? this.table.accent : this.table.beat;
    this.voice.trigger(click.note, click.velocity, this.table.gateSeconds, event.time);
  };
}
