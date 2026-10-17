/**
 * Spectre's scope (record `2026-10-17-spectre-drawn-cells` decision 8): each
 * channel's input and output power binned to the curves' cells, the loudest
 * band in each cell held since the last report, so the workbench can draw the
 * spectrum under the cells it edits. It runs only while the workbench asks,
 * and the processor posts `input`, `output` and the LFO's `lfo` at most
 * `SPECTRE_DSP.scopeHz` times a second, starting the bins again each time.
 *
 * Layout: channel ch's cell i at `ch · SPECTRE_CELLS + i`, power as re² + im²
 * of the band's complex value (the card turns it into dB).
 *
 * Invariants: `bin` and `close` allocate nothing and take their operands
 * through fields and the frame's arrays (worklet rule 2). Pinned by
 * `inserts/spectreDsp.test.ts` and `inserts/spectreAllocation.test.ts`.
 */
import { SPECTRE_CELLS } from '../../inserts/spectreConstants';

class SpectreScope {
  readonly input: Float32Array;
  readonly output: Float32Array;
  readonly heldInput: Float64Array;
  readonly heldOutput: Float64Array;
  active: boolean;
  /** A report waits in `input`/`output` for the processor to post. */
  pending: boolean;
  /** The LFO's level when the report closed. */
  lfo: number;
  /** The pitch classes the selection followed when the report closed (0 while it follows nothing). */
  pitches: number;
  /** In: which channel `bin` writes, 0 or 1. */
  channel: number;

  constructor() {
    this.lfo = this.channel = this.pitches = NaN;
    this.input = new Float32Array(2 * SPECTRE_CELLS);
    this.output = new Float32Array(2 * SPECTRE_CELLS);
    this.heldInput = new Float64Array(2 * SPECTRE_CELLS);
    this.heldOutput = new Float64Array(2 * SPECTRE_CELLS);
    this.active = this.pending = false;
    this.lfo = 0;
    this.channel = 0;
    this.pitches = 0;
  }

  /** The loudest band of each cell of `re`/`im` into the held input (`output` false) or output. */
  bin(
    re: Float64Array,
    im: Float64Array,
    axis: Float64Array,
    bands: number,
    output: boolean,
  ): void {
    const held = output ? this.heldOutput : this.heldInput,
      base = this.channel * SPECTRE_CELLS,
      last = SPECTRE_CELLS - 1;
    for (let k = 0; k < bands; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const i = Math.floor(axis[k] * SPECTRE_CELLS);
      const at = base + (i > last ? last : i);
      if (power > held[at]) held[at] = power;
    }
  }

  /** The held bins into the report, ready to post; the bins start again. */
  close(lfo: number, pitches: number): void {
    const input = this.input,
      output = this.output,
      heldInput = this.heldInput,
      heldOutput = this.heldOutput;
    for (let i = 0; i < input.length; i++) {
      input[i] = heldInput[i];
      output[i] = heldOutput[i];
      heldInput[i] = 0;
      heldOutput[i] = 0;
    }
    this.lfo = lfo;
    this.pitches = pitches;
    this.pending = true;
  }

  /** On or off: either way it starts from empty. */
  setActive(active: boolean): void {
    this.active = active;
    this.heldInput.fill(0);
    this.heldOutput.fill(0);
    this.pending = false;
  }
}

export { SpectreScope };
