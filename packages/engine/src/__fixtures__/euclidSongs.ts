/**
 * Euclid songs for the lane and ratchet tests (windsor#355): the full
 * fixture song with its kick part's sequencer, regions or velocity swapped,
 * and a reading of the kick's recorded hits by the trigger's local step.
 */
import type { Arrangement, EuclideanSpec, MusicPart, Transport } from '../song/arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ } from '../sequencing/scheduler';
import { FULL_ARRANGEMENT, FULL_PARTS, FULL_SLOT } from './fullArrangement';
import type { Call, RecordingPart } from './recordingPart';

export const KICK_SLOT = FULL_SLOT.kick;
export const KICK_SPEC: EuclideanSpec = FULL_PARTS.kick.sequencer;
/** Seconds per straight tick at the fixture's tempo. */
export const SECONDS_PER_TICK = SECONDS_PER_MINUTE / FULL_ARRANGEMENT.transport.bpm / PPQ;

/** A 16-step captured figure lit on `on`, every other step a rest. */
export const figure = (...on: number[]): boolean[] =>
  Array.from({ length: KICK_SPEC.steps }, (_, i) => on.includes(i));

/** Every step lit. */
export const ALL_ON: readonly boolean[] = figure(...Array.from({ length: 16 }, (_, i) => i));

export interface KickSong {
  /** Fields merged over the kick's sequencer. */
  readonly sequencer?: Partial<EuclideanSpec>;
  readonly part?: Partial<Pick<MusicPart, 'regions' | 'velocity'>>;
  readonly transport?: Partial<Transport>;
}

/** The fixture song with its kick part changed as `song` says. */
export function kickSong(song: KickSong): Arrangement {
  const sequencer: EuclideanSpec = { ...KICK_SPEC, ...song.sequencer };
  return {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, ...song.transport },
    parts: FULL_ARRANGEMENT.parts.map((part) =>
      part.slot === KICK_SLOT ? { ...part, ...song.part, sequencer } : part,
    ),
  };
}

/** A straight-time call's transport tick. */
export const tickOf = (call: Call): number => Math.round((call.time ?? 0) / SECONDS_PER_TICK);

/** The kick's triggers, each with the step it fell on counted from tick 0 at `divisor`. */
export function hitsByStep(
  part: RecordingPart,
  divisor = KICK_SPEC.divisor,
): Array<Call & { step: number }> {
  return part.calls
    .filter((call) => call.kind === 'trigger')
    .map((call) => ({ ...call, step: tickOf(call) / divisor }));
}
