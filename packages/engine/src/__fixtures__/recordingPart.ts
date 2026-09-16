/**
 * A `PlayablePart` that records every call — the player tests' stand-in for
 * an `AudioPart`, so what the bindings sent can be asserted call by call.
 */
import type { PlayablePart } from '../arrangementPlayer';
import type { Patch } from '../patch';

export interface Call {
  kind: 'trigger' | 'noteOn' | 'noteOffByNote' | 'setPatch' | 'allNotesOff';
  note?: number | undefined;
  velocity?: number | undefined;
  duration?: number | undefined;
  time?: number | undefined;
  patch?: string | undefined;
}

export type RecordingPart = PlayablePart & { calls: Call[] };

export function recordingPart(): RecordingPart {
  const calls: Call[] = [];
  return {
    calls,
    noteOn(note, velocity, time) {
      calls.push({ kind: 'noteOn', note, velocity, time });
      return calls.length;
    },
    noteOffByNote(note, time) {
      calls.push({ kind: 'noteOffByNote', note, time });
    },
    trigger(note, velocity, duration, time) {
      calls.push({ kind: 'trigger', note, velocity, duration, time });
      return calls.length;
    },
    setPatch(patch: Patch) {
      calls.push({ kind: 'setPatch', patch: patch.name });
    },
    allNotesOff() {
      calls.push({ kind: 'allNotesOff' });
    },
  };
}

export const kinds = (part: RecordingPart, kind: Call['kind']): Call[] =>
  part.calls.filter((c) => c.kind === kind);
