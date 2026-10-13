/**
 * The Pump's scope (record `2026-10-13-pump-insert` decision 5): the key's
 * peak level binned across one cycle from its trigger, so the card can draw
 * the kick under the shape it ducks with. It runs only while a card asks;
 * a cycle's trace is handed over when the cycle ends or a trigger cuts it
 * short, and the processor posts it.
 *
 * Invariants: `add` and `close` allocate nothing and take their values
 * through fields (worklet rule 2); every double field is born NaN (rule 7).
 * Pinned by `inserts/pumpDsp.test.ts` (a trace's shape) and
 * `inserts/pumpAllocation.test.ts`.
 */
import { PUMP_DSP } from '../../inserts/pumpConstants';

class PumpScope {
  readonly bins: Float64Array;
  /** The last finished cycle's trace, as posted. */
  readonly trace: Float32Array;
  active: boolean;
  /** Something was binned since the last close. */
  dirty: boolean;
  /** A trace waits in `trace` for the processor to post. */
  pending: boolean;
  /** In: where in the cycle, below 1, and the key's level there. */
  phase: number;
  level: number;

  constructor() {
    this.phase = this.level = NaN;
    this.bins = new Float64Array(PUMP_DSP.scopeBins);
    this.trace = new Float32Array(PUMP_DSP.scopeBins);
    this.active = this.dirty = this.pending = false;
    this.phase = this.level = 0;
  }

  add(): void {
    const at = (this.phase * PUMP_DSP.scopeBins) | 0;
    if (this.level > this.bins[at]) this.bins[at] = this.level;
    this.dirty = true;
  }

  /** The cycle so far into `trace`, ready to post; the bins start again. */
  close(): void {
    if (!this.dirty) return;
    const bins = this.bins;
    for (let i = 0; i < bins.length; i++) {
      this.trace[i] = bins[i];
      bins[i] = 0;
    }
    this.dirty = false;
    this.pending = true;
  }

  /** On or off: either way it starts from empty. */
  setActive(active: boolean): void {
    this.active = active;
    this.bins.fill(0);
    this.dirty = this.pending = false;
  }
}

export { PumpScope };
