/**
 * The song's clock fields as the player hands them to the transport: its
 * tempo, meter (windsor#429), swing (windsor#14) and loop (windsor#15), and
 * the length they give the song. One place, so the player's build and its
 * live partials set the clock the same way.
 */
import type { Arrangement } from './arrangement';
import { tickLoopOf } from './songLoop';
import { songTicks } from '../sequencing/meter';
import { FOUR_FOUR, type Meter } from '../sequencing/meterTables';
import type { TickLoop } from '../sequencing/scheduler';
import { playableSwing } from '../sequencing/swing';
import { STRAIGHT_SWING, type Swing } from '../sequencing/swingTables';

/** The clock settings a transport takes. `Scheduler` and `TickTransport` both have them. */
export interface SongClock {
  bpm: number;
  /** The song's swing (windsor#14). Optional: a transport without it plays straight. */
  swing?: Swing;
  /** The song's meter (windsor#429). Optional: a transport without it counts 4/4. */
  meter?: Meter;
  /** The loop the clock wraps (windsor#15). Optional: a transport without it plays through. */
  loop?: TickLoop | null;
}

/** The song's length in ticks: its explicit `transport.bars` (decision 5) of its meter's bar. */
export const songTicksOf = (arrangement: Arrangement): number =>
  songTicks(arrangement.transport.bars, arrangement.transport.meter);

/**
 * The arrangement with its swing and meter written out: a document may
 * leave them absent (straight, 4/4), but the player's live copy carries
 * them so a partial like `{ transport: { swing: { amount: 60 } } }` or
 * `{ transport: { meter: '7/8' } }` has a field to merge into.
 */
export function withClockFields(arrangement: Arrangement): Arrangement {
  const { swing = STRAIGHT_SWING, meter = FOUR_FOUR } = arrangement.transport;
  return { ...arrangement, transport: { ...arrangement.transport, swing, meter } };
}

/** Hand `clock` the song's tempo, meter, swing and loop. */
export function setSongClock(clock: SongClock, { transport }: Arrangement): void {
  clock.bpm = transport.bpm;
  clock.meter = transport.meter ?? FOUR_FOUR;
  clock.swing = playableSwing(transport.swing);
  clock.loop = tickLoopOf(transport);
}
