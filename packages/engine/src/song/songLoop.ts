/**
 * The song's loop (windsor#15, record `2026-09-28-song-loop-in-the-transport`):
 * `transport.loop = { start, end, on }` in ticks, saved with the song.
 *
 * One fitting rule serves the document normaliser and the player's live
 * partials, so a live edit plays what its normalised document will: the
 * points are ordered, snapped to the beat, at least a beat apart and inside
 * the song. A loop that starts at or past the song's end (Bars shrunk below
 * it) has nothing left and is off: the document drops it, and a missing loop
 * means off, so a song written before the loop plays exactly as it did.
 *
 * The clock only sees a `TickLoop` (`sequencing/scheduler.ts`): the fitted
 * range of a loop that is on and shorter than the song. A loop over the whole
 * song is the song's own wrap, so the clock is handed nothing for it.
 */
import type { Arrangement, SongLoop, Transport } from './arrangement';
import { FieldNormaliser } from './arrangementFields';
import { songTicks } from '../sequencing/meter';
import { PPQ, type TickLoop } from '../sequencing/scheduler';

/** The grid the loop's points snap to, and its shortest length: one beat. */
export const LOOP_GRID_TICKS = PPQ;

const ticksOf = (transport: Transport): number => songTicks(transport.bars);

const snap = (tick: number, grid: number): number => Math.round(tick / grid) * grid;

/**
 * A range fitted into a song of `songTicks`: ordered, snapped to `grid`, at
 * least one `grid` long, clamped inside. Null when it starts at or past the
 * song's end. `songTicks` is a whole number of bars, so of grid steps too.
 */
export function fitLoopRange(
  start: number,
  end: number,
  songTicks: number,
  grid: number = LOOP_GRID_TICKS,
): { start: number; end: number } | null {
  const first = Math.max(0, snap(Math.min(start, end), grid));
  if (first >= songTicks) return null;
  const last = Math.min(songTicks, Math.max(first + grid, snap(Math.max(start, end), grid)));
  return { start: first, end: last };
}

/**
 * `transport.loop` from a document or a merged partial. Absent stays absent;
 * junk fields default (the whole song, off), and every repair is reported.
 * Undefined when nothing of the range is left inside the song.
 */
export function normaliseLoop(
  raw: unknown,
  songTicks: number,
  n: FieldNormaliser,
  path = 'transport.loop',
): SongLoop | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['start', 'end', 'on'], path);
  const start = n.num(o.start, 0, 0, Number.MAX_SAFE_INTEGER, `${path}.start`);
  const end = n.num(o.end, songTicks, 0, Number.MAX_SAFE_INTEGER, `${path}.end`);
  const on = n.bool(o.on, false, `${path}.on`);
  const fitted = fitLoopRange(start, end, songTicks);
  if (!fitted) {
    n.correction(`${path}: starts at or past the song's end (${songTicks}) — loop off`);
    return undefined;
  }
  if (fitted.start !== start || fitted.end !== end) {
    n.correction(`${path}: fitted ${start}–${end} to ${fitted.start}–${fitted.end}`);
  }
  return { ...fitted, on };
}

/**
 * The player's live copy with its loop fitted to the current length (Bars
 * shrunk below it clamps it, or turns it off), and never absent: a partial
 * like `{ transport: { loop: { on: true } } }` needs a field to merge into.
 * An absent or emptied loop is the whole song, off.
 */
export function withFittedLoop(arrangement: Arrangement): Arrangement {
  const songTicks = ticksOf(arrangement.transport);
  const loop = normaliseLoop(arrangement.transport.loop, songTicks, new FieldNormaliser()) ?? {
    start: 0,
    end: songTicks,
    on: false,
  };
  return { ...arrangement, transport: { ...arrangement.transport, loop } };
}

/**
 * What the clock wraps: the loop's range while it is on, null while it is
 * off, absent, or covers the whole song (the song's own wrap). The loop is
 * read as fitted; the player hands the clock nothing else.
 */
export function tickLoopOf(transport: Transport): TickLoop | null {
  const loop = transport.loop;
  const songTicks = ticksOf(transport);
  if (!loop?.on || (loop.start <= 0 && loop.end >= songTicks)) return null;
  return { start: loop.start, end: loop.end, songTicks };
}

/** Where ▶ from rest starts and ■ rewinds to: the loop's start while it is on, else 0. */
export function playStartTick(transport: Transport): number {
  return transport.loop?.on ? transport.loop.start : 0;
}
