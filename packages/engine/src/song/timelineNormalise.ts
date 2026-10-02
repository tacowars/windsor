/**
 * The song's two tick lists, normalised (#705): a part's `regions` and the
 * harmony's `events`. Both are integer ticks inside `songTicks`
 * (`transport.bars × TICKS_PER_BAR`), sorted by `start`, and reported
 * through the `arrangementFields` vocabulary like every other field.
 *
 * Regions (epic #703 decision 17): each end is clamped to the next region's
 * start and to the song end, so the list never overlaps; a region left with
 * no length is dropped, reported. No regions is a silent part. A region may
 * carry its own `pattern` (windsor#73), which travels with it and is
 * normalised by `normaliseRegionPattern` against the part's kind.
 *
 * Events (decisions 5, 6, 10): contiguous — an event's duration *is* the
 * gap to the next start (the song end for the last), so the document holds
 * one canonical timeline and a console draws blocks that meet; a written
 * duration that says otherwise is corrected. Two events on one start keep
 * the later one. No events is the tonic triad for the whole song. An event
 * may name a `quality` and an `accidental` (windsor#330); a quality sets the
 * size, and a natural accidental is the field's absence.
 */
import { CHORD_SIZE_TRIAD, HARMONY_DEGREE_MAX } from '../audioConstants';
import type { HarmonyEvent } from '../harmony/harmonyTimeline';
import { isChordSize, type ChordSize } from '../harmony/chordTheory';
import {
  CHORD_ACCIDENTALS,
  QUALITY_INTERVALS,
  type ChordAccidental,
  type NamedQuality,
} from '../harmony/chordTables';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import type { Arrangement, PartRegion, SequencerKind } from './arrangement';
import { FieldNormaliser, isRecord, show } from './arrangementFields';
import { normaliseRegionPattern, sequencerKindOf } from './sequencerNormalise';
import { withFittedAutomation } from './automationNormalise';

/**
 * The arrangement with its regions, events and any part's automation lanes
 * re-fitted to its own `transport.bars` — what the player runs over every
 * merged live partial, so a song shortened live sounds as its normalised
 * document will after export (Codex, #705). Idempotent on normalised data;
 * a region or event left outside the song is dropped exactly as
 * `makeArrangement` drops it, and a lane is cut at the end as it cuts one.
 */
export function fitTimelines(arrangement: Arrangement): Arrangement {
  const n = new FieldNormaliser();
  const songTicks = arrangement.transport.bars * TICKS_PER_BAR;
  return {
    ...arrangement,
    harmony: {
      ...arrangement.harmony,
      events: normaliseHarmonyEvents(arrangement.harmony.events, songTicks, 'harmony.events', n),
    },
    parts: arrangement.parts.map((part) =>
      // A part that carries automation lanes has them fitted too (windsor#342 decision 3).
      withFittedAutomation(
        {
          ...part,
          regions: normaliseRegions(part.regions, {
            songTicks,
            // Read tolerantly: the player fits a merged partial before it validates it.
            kind: sequencerKindOf(part.sequencer),
            path: `parts.${part.slot}.regions`,
            n,
          }),
        },
        songTicks,
      ),
    ),
  };
}

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

/** A region's span and its written `pattern`, which travels with it through the sort. */
interface RegionSpan extends Span {
  pattern: unknown;
}

function sortedSpans(
  raw: unknown[],
  songTicks: number,
  path: string,
  n: FieldNormaliser,
): RegionSpan[] {
  return raw
    .map((entry, i) => ({
      ...span(entry, songTicks, `${path}[${i}]`, n),
      pattern: isRecord(entry) ? entry.pattern : undefined,
    }))
    .sort((a, b) => a.start - b.start);
}

/** What a part's regions are normalised against. */
export interface RegionsContext {
  /** The song's length: every region ends inside it. */
  readonly songTicks: number;
  /** The part's sequencer kind, which a region's own pattern must share (windsor#73). */
  readonly kind: SequencerKind;
  readonly path: string;
  readonly n: FieldNormaliser;
}

/**
 * A part's regions: sorted, each end clamped to the next start and the song
 * end, empty ones dropped. A surviving region keeps its own `pattern`,
 * normalised against the part's kind (windsor#73); one without stays without.
 */
export function normaliseRegions(raw: unknown, context: RegionsContext): PartRegion[] {
  const { songTicks, kind, path, n } = context;
  if (raw === undefined) {
    n.correction(`${path}: missing — the part has no regions and is silent`);
    return [];
  }
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of regions — the part is silent`);
    return [];
  }
  const spans = sortedSpans(raw, songTicks, path, n);
  const out: PartRegion[] = [];
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
    const pattern = normaliseRegionPattern(s.pattern, kind, `${s.path}.pattern`, n);
    out.push(
      pattern === undefined ? { start: s.start, duration } : { start: s.start, duration, pattern },
    );
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

const isNamedQuality = (raw: unknown): raw is NamedQuality =>
  typeof raw === 'string' && Object.hasOwn(QUALITY_INTERVALS, raw);

/** A named table quality, or absent: `'other'` and anything unknown fall back to the scale's chord. */
function quality(raw: unknown, path: string, n: FieldNormaliser): NamedQuality | undefined {
  if (raw === undefined || isNamedQuality(raw)) return raw;
  n.correction(`${path}: ${show(raw)} is not a chord quality — the scale's own chord`);
  return undefined;
}

/** Flat or sharp, else absent; a written 0 is natural and needs no report. */
function accidental(raw: unknown, path: string, n: FieldNormaliser): ChordAccidental | undefined {
  if (raw === undefined || raw === 0) return undefined;
  if ((CHORD_ACCIDENTALS as readonly unknown[]).includes(raw)) return raw as ChordAccidental;
  n.correction(`${path}: ${show(raw)} is not a flat (-1) or a sharp (1) — natural`);
  return undefined;
}

/**
 * The event's chord fields in output order (windsor#330 decision 5): a
 * quality sets the size — silently when none was written, with a report
 * when it disagreed.
 */
function chordFields(
  o: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): Pick<HarmonyEvent, 'size' | 'quality' | 'accidental'> {
  const named = quality(o.quality, `${path}.quality`, n);
  const flat = accidental(o.accidental, `${path}.accidental`, n);
  let chordSize: ChordSize;
  if (named === undefined) {
    chordSize = size(o.size, `${path}.size`, n);
  } else {
    chordSize = (QUALITY_INTERVALS[named].length + 1) as ChordSize;
    if (o.size !== undefined && o.size !== chordSize) {
      n.correction(
        `${path}.size: ${show(o.size)} is not ${named}'s ${chordSize} tones — corrected`,
      );
    }
  }
  return {
    size: chordSize,
    ...(named === undefined ? {} : { quality: named }),
    ...(flat === undefined ? {} : { accidental: flat }),
  };
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
    const fields = ['start', 'duration', 'degree', 'size', 'quality', 'accidental'];
    n.dropUnknown(o, fields, `${path}[${i}]`);
    return {
      ...span(entry, songTicks, `${path}[${i}]`, n),
      degree: n.int(o.degree, 0, 0, HARMONY_DEGREE_MAX, `${path}[${i}].degree`),
      chord: chordFields(o, `${path}[${i}]`, n),
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
    out.push({ start: e.start, duration, degree: e.degree, ...e.chord });
  });
  return out.length > 0 ? out : defaultHarmonyEvents(songTicks);
}
