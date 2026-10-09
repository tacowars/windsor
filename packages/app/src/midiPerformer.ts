/**
 * What a MIDI performance means for the console's notes (#523), without Web
 * MIDI or the DOM: which keys are down, what the sustain pedal is keeping, and
 * the expression values. It speaks to a `PerformerSink` — the audition
 * `Keyboard` in the console, a recorder in the tests. One performer per input,
 * so two controllers holding the same pitch never release each other's note
 * and one device's sustain pedal holds only its own keys.
 *
 * Each press and release carries the MIDI event's `timeStamp` (windsor#663),
 * so the Roll recorder stamps a note when it was played: a release the pedal
 * kept carries the pedal-up's. A lost device's releases have none.
 */
import type { MidiEvent } from './midiMessage';

export interface PerformerSink {
  /** `timeStamp`: the MIDI event's, in performance time (ms). */
  press(note: number, velocity: number, timeStamp?: number): void;
  /** `force`: release even while the console's Hold latch is on (a lost or deselected device). */
  release(note: number, force?: boolean, timeStamp?: number): void;
  bend(semitones: number): void;
  modWheel(value: number): void;
}

export class MidiPerformer {
  /** Keys physically down. */
  private readonly down = new Set<number>();
  /** Keys released while the pedal was down, still sounding. */
  private readonly sustained = new Set<number>();
  private pedal = false;

  constructor(private readonly sink: PerformerSink) {}

  /** One event, stamped `timeStamp` (the MIDI message's, in performance time). */
  handle(event: MidiEvent, timeStamp?: number): void {
    switch (event.type) {
      case 'noteOn':
        // A key struck again while it still sounds (held, or kept by the
        // pedal) restarts the note rather than stacking a second voice.
        if (this.down.has(event.note) || this.sustained.has(event.note)) {
          this.sink.release(event.note, false, timeStamp);
        }
        this.sustained.delete(event.note);
        this.down.add(event.note);
        this.sink.press(event.note, event.velocity, timeStamp);
        break;
      case 'noteOff':
        if (!this.down.delete(event.note)) break;
        if (this.pedal) this.sustained.add(event.note);
        else this.sink.release(event.note, false, timeStamp);
        break;
      case 'sustain':
        this.pedal = event.down;
        if (!event.down) {
          for (const note of this.sustained) this.sink.release(note, false, timeStamp);
          this.sustained.clear();
        }
        break;
      case 'bend':
        this.sink.bend(event.semitones);
        break;
      case 'modWheel':
        this.sink.modWheel(event.value);
        break;
    }
  }

  /** Release everything sounding and return expression to rest: a lost or deselected device. */
  releaseAll(): void {
    for (const note of new Set([...this.down, ...this.sustained])) this.sink.release(note, true);
    this.forget();
    this.sink.bend(0);
    this.sink.modWheel(0);
  }

  /** Drop the state without telling the sink: Panic has already silenced the part. */
  forget(): void {
    this.down.clear();
    this.sustained.clear();
    this.pedal = false;
  }
}
