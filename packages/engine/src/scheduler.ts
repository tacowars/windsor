/**
 * Look-ahead scheduler -- the two-clocks pattern.
 *
 * A coarse timer wakes periodically and queues events far enough ahead that the
 * audio thread always has work with sample-accurate frame stamps. Notes are
 * never triggered from the render loop directly: `requestAnimationFrame` jitters
 * with frame time, and audio timing that jitters with frame rate is audible.
 */

export interface SchedulerOptions {
  /** Seconds of audio to keep queued ahead of now. */
  lookAhead?: number;
  bpm?: number;
  stepsPerBeat?: number;
}

export type StepHandler = (step: number, time: number) => void;

export class Scheduler {
  lookAhead: number;
  bpm: number;
  stepsPerBeat: number;

  /** Called once per step, with the context time the step should sound at. */
  onStep: StepHandler | null = null;

  private readonly context: BaseAudioContext;
  private running = false;
  private nextTime = 0;
  private step = 0;

  constructor(context: BaseAudioContext, options: SchedulerOptions = {}) {
    this.context = context;
    this.lookAhead = options.lookAhead ?? 0.12;
    this.bpm = options.bpm ?? 120;
    this.stepsPerBeat = options.stepsPerBeat ?? 4;
  }

  get stepDuration(): number {
    return 60 / this.bpm / this.stepsPerBeat;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(atStep = 0): void {
    if (this.running) return;
    this.running = true;
    this.step = atStep;
    this.nextTime = this.context.currentTime + 0.06;
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Advance the queue. Driven by the render loop, but what it emits is timed
   * against the audio clock, so frame-rate variation cannot shift a note.
   */
  update(): void {
    if (!this.running) return;
    const horizon = this.context.currentTime + this.lookAhead;
    while (this.nextTime < horizon) {
      this.onStep?.(this.step, this.nextTime);
      this.nextTime += this.stepDuration;
      this.step++;
    }
  }
}
