/**
 * The song's two tick lists, normalised (#705): a part's `regions` and the
 * harmony's `events`. Both are integer ticks inside `songTicks`
 * (`transport.bars × TICKS_PER_BAR`), sorted by `start`, and reported
 * through the `arrangementFields` vocabulary like every other field.
 *
 * Regions (epic #703 decision 17): each end is clamped to the next region's
 * start and to the song end, so the list never overlaps; a region left with
 * no length is dropped, reported. No regions is a silent part.
 *
 * Events (decisions 5, 6, 10): contiguous — an event's duration *is* the
 * gap to the next start (the song end for the last), so the document holds
 * one canonical timeline and a console draws blocks that meet; a written
 * duration that says otherwise is corrected. Two events on one start keep
 * the later one. No events is the tonic triad for the whole song.
 */
import { CHORD_SIZE_TRIAD, HARMONY_DEGREE_MAX } from '../audioConstants';
import type { HarmonyEvent } from '../harmony/harmonyTimeline';
import { isChordSize, type ChordSize } from '../harmony/chordTheory';
import type { Region } from '../sequencing/regionClock';
import { show, type FieldNormaliser } from './arrangementFields';

interface Span {
  start: number;
  duration: number;
  path: string;
}

/** The written `start` / `duration` of one entry, clamped into the song and sorted later. */
function span(raw: unknown, songTicks: number, path: string, n: FieldNormaliser): Span {
  const o = n.section(raw, path);
  return {
    start: n.int(o.start, 0, 0, songTicks, `${path}.start`),
    duration: n.int(o.duration, songTicks, 0, songTicks, `${path}.duration`),
    path,
  };
}

function sortedSpans(raw: unknown[], songTicks: number, path: string, n: FieldNormaliser): Span[] {
  return raw
    .map((entry, i) => span(entry, songTicks, `${path}[${i}]`, n))
    .sort((a, b) => a.start - b.start);
}

/** A part's regions: sorted, each end clamped to the next start and the song end, empty ones dropped. */
export function normaliseRegions(
  raw: unknown,
  songTicks: number,
  path: string,
  n: FieldNormaliser,
): Region[] {
  if (raw === undefined) {
    n.correction(`${path}: missing — the part has no regions and is silent`);
    return [];
  }
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of regions — the part is silent`);
    return [];
  }
  const spans = sortedSpans(raw, songTicks, path, n);
  const out: Region[] = [];
  spans.forEach((s, i) => {
    const next = spans[i + 1];
    const end = Math.min(s.start + s.duration, next ? next.start : songTicks, songTicks);
    const duration = end - s.start;
    if (duration <= 0) {
      n.correction(`${s.path}: no length left inside the song — region dropped`);
      return;
    }
    if (duration !== s.duration) {
      n.correction(`${s.path}.duration: clamped ${s.duration} to ${duration}`);
    }
    out.push({ start: s.start, duration });
  });
  return out;
}

/** The tonic triad for the whole song — what an absent or empty event list means. */
export function defaultHarmonyEvents(songTicks: number): HarmonyEvent[] {
  return [{ start: 0, duration: songTicks, degree: 0, size: CHORD_SIZE_TRIAD }];
}

function size(raw: unknown, path: string, n: FieldNormaliser): ChordSize {
  if (raw === undefined) return CHORD_SIZE_TRIAD;
  if (typeof raw === 'number' && isChordSize(raw)) return raw;
  n.correction(`${path}: ${show(raw)} is not a triad (3) or a seventh (4) — using a triad`);
  return CHORD_SIZE_TRIAD;
}

/** The harmony's events: sorted, contiguous, one per start; none is the tonic. */
export function normaliseHarmonyEvents(
  raw: unknown,
  songTicks: number,
  path: string,
  n: FieldNormaliser,
): HarmonyEvent[] {
  if (raw === undefined) return defaultHarmonyEvents(songTicks);
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of chord events — holding the tonic`);
    return defaultHarmonyEvents(songTicks);
  }
  const entries = raw.map((entry, i) => {
    const o = n.section(entry, `${path}[${i}]`);
    n.dropUnknown(o, ['start', 'duration', 'degree', 'size'], `${path}[${i}]`);
    return {
      ...span(entry, songTicks, `${path}[${i}]`, n),
      degree: n.int(o.degree, 0, 0, HARMONY_DEGREE_MAX, `${path}[${i}].degree`),
      size: size(o.size, `${path}[${i}].size`, n),
    };
  });
  entries.sort((a, b) => a.start - b.start);
  const out: HarmonyEvent[] = [];
  entries.forEach((e, i) => {
    const next = entries[i + 1];
    if (e.start >= songTicks || (next && next.start === e.start)) {
      n.correction(
        `${e.path}: ${next ? 'shares its start with the next event' : 'starts at the song end'} — event dropped`,
      );
      return;
    }
    const duration = (next ? next.start : songTicks) - e.start;
    if (duration !== e.duration) {
      n.correction(
        `${e.path}.duration: ${e.duration} is not the ${duration} ticks to the next event — corrected`,
      );
    }
    out.push({ start: e.start, duration, degree: e.degree, size: e.size });
  });
  return out.length > 0 ? out : defaultHarmonyEvents(songTicks);
}
