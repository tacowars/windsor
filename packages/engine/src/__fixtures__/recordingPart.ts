/**
 * A `PlayablePart` that records every call — the player tests' stand-in for
 * an `AudioPart`, so what the bindings sent can be asserted call by call.
 */
import type { PlayablePart } from '../song/arrangementPlayer';
import type { NoteExtras } from '../synth/audioPart';
import type { Patch } from '../patch/patch';

export interface Call {
  kind: 'trigger' | 'noteOn' | 'noteOffByNote' | 'setPatch' | 'allNotesOff';
  note?: number | undefined;
  velocity?: number | undefined;
  duration?: number | undefined;
  time?: number | undefined;
  patch?: string | undefined;
  /** A grid note's accent mod and slide flag (#602); absent on a plain note. */
  extras?: NoteExtras | undefined;
}

export type RecordingPart = PlayablePart & { calls: Call[] };

export function recordingPart(): RecordingPart {
  const calls: Call[] = [];
  return {
    calls,
    noteOn(note, velocity, time, extras) {
      calls.push({ kind: 'noteOn', note, velocity, time, ...(extras ? { extras } : {}) });
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
