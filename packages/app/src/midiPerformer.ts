/**
 * What a MIDI performance means for the console's notes (#523), without Web
 * MIDI or the DOM: which keys are down, what the sustain pedal is keeping, and
 * the expression values. It speaks to a `PerformerSink` — the audition
 * `Keyboard` in the console, a recorder in the tests. One performer per input,
 * so two controllers holding the same pitch never release each other's note
 * and one device's sustain pedal holds only its own keys.
 */
import type { MidiEvent } from './midiMessage';

export interface PerformerSink {
  press(note: number, velocity: number): void;
  /** `force`: release even while the console's Hold latch is on (a lost or deselected device). */
  release(note: number, force?: boolean): void;
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

  handle(event: MidiEvent): void {
    switch (event.type) {
      case 'noteOn':
        // A key struck again while it still sounds (held, or kept by the
        // pedal) restarts the note rather than stacking a second voice.
        if (this.down.has(event.note) || this.sustained.has(event.note)) {
          this.sink.release(event.note);
        }
        this.sustained.delete(event.note);
        this.down.add(event.note);
        this.sink.press(event.note, event.velocity);
        break;
      case 'noteOff':
        if (!this.down.delete(event.note)) break;
        if (this.pedal) this.sustained.add(event.note);
        else this.sink.release(event.note);
        break;
      case 'sustain':
        this.pedal = event.down;
        if (!event.down) {
          for (const note of this.sustained) this.sink.release(note);
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
