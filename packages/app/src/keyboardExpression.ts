/**
 * The controller's pitch bend and mod wheel on the audition keyboard (#523),
 * split out of `keyboard.ts` (windsor#919): they ride the part the keyboard
 * plays, and move to the next one when it changes.
 */
import type { AudioPart } from '@windsor/engine';

export class KeyboardExpression {
  /** The part carrying the bend and wheel, and their positions. */
  private part: AudioPart | null = null;
  private bendSemitones = 0;
  private wheel = 0;
  private readonly getPart: () => AudioPart | null;

  constructor(getPart: () => AudioPart | null) {
    this.getPart = getPart;
  }

  /** The bend moved to `semitones`. */
  bend(semitones: number): void {
    this.bendSemitones = semitones;
    this.follow();
  }

  /** The wheel moved to `value`. */
  modWheel(value: number): void {
    this.wheel = value;
    this.follow();
  }

  /** Both back to rest, as Panic leaves them. */
  rest(): void {
    this.bendSemitones = 0;
    this.wheel = 0;
    this.follow();
  }

  /**
   * Hand the bend and wheel to the part played now: the part that had them
   * returns to rest, the new one takes the current positions.
   */
  follow(): void {
    const part = this.getPart();
    if (this.part && this.part !== part) {
      this.part.pitchBend.value = 0;
      this.part.modWheel.value = 0;
    }
    this.part = part;
    if (part) {
      part.pitchBend.value = this.bendSemitones;
      part.modWheel.value = this.wheel;
    }
  }
}
