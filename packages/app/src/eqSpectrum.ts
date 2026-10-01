/**
 * The Parametric EQ card's output spectrum (windsor#200, record
 * `2026-09-30-parametric-eq-insert` decision 9): the reader over the stage's
 * analyser tap, and the gate that decides when that tap runs. The analyser
 * is connected only while the card is in the page (a folded, paged-away or
 * removed insert has no card), its tab is shown, and something sounds: the
 * transport runs, or the master output stage heard anything lately, which
 * covers the audition keyboard and the tails after Stop. It is read at most
 * every `frameMs` on the console's one frame loop (`watchPlayhead`), the way
 * `compressorMeter.ts` reads its gain reduction. Nothing draws while it is
 * off.
 *
 * The gate (`createSpectrumGate`) and the drawing's levels (`spectrumLevels`)
 * are pure, and `eqSpectrum.test.ts` pins them.
 */
import { EQ_SPECTRUM } from '@windsor/engine';
import type { InsertSpec, InsertStage } from '@windsor/engine';
import type { EqPlot } from './eqCurveModel';
import { freqOfX } from './eqCurveModel';
import { EQ_SPECTRUM_VIEW } from './eqTables';
import { watchPlayhead } from './stepStrip';

/** What one frame of the gate reads. */
export interface SpectrumFrame {
  /** The card is in the page: its insert is there, unfolded, on the EQ's page. */
  readonly attached: boolean;
  /** Its tab is shown. */
  readonly shown: boolean;
  /** The transport runs. */
  readonly running: boolean;
  /** The master output stage's latest input peak, linear (0 with no audio). */
  readonly peak: number;
  /** Now, in milliseconds. */
  readonly now: number;
}

/** The gate's verdict for a frame: run the analyser, and read and draw it now. */
export interface SpectrumStep {
  readonly active: boolean;
  readonly draw: boolean;
}

export interface SpectrumGate {
  step(frame: SpectrumFrame): SpectrumStep;
}

/** A gate with its own memory of when it last heard sound and last drew. */
export function createSpectrumGate(view = EQ_SPECTRUM_VIEW): SpectrumGate {
  let heard = -Infinity;
  let drawn = -Infinity;
  return {
    step(frame) {
      if (frame.running || frame.peak >= view.heardPeak) heard = frame.now;
      const sounding = frame.now - heard <= view.holdMs;
      const active = frame.attached && frame.shown && sounding;
      if (!active) {
        drawn = -Infinity;
        return { active, draw: false };
      }
      const draw = frame.now - drawn >= view.frameMs;
      if (draw) drawn = frame.now;
      return { active, draw };
    },
  };
}

/**
 * The spectrum's height at every `step` px of `plot` into `out`, in px from
 * the top: `bins` (dBFS, bin k at k × `binHz`) read on the plot's log
 * frequency axis, `floorDb` at the bottom and `ceilingDb` at the top. Where a
 * column spans more than one bin it takes the loudest; where it falls between
 * two it takes the line between them. Returns how many columns it wrote.
 */
export function spectrumLevels(
  bins: Float32Array,
  binHz: number,
  plot: EqPlot,
  out: Float64Array,
  view = EQ_SPECTRUM_VIEW,
): number {
  const last = bins.length - 1;
  const span = view.ceilingDb - view.floorDb;
  let n = 0;
  for (let x = 0; x <= plot.width; x += view.step) {
    const lo = Math.max(0, freqOfX(x - view.step / 2, plot) / binHz);
    const hi = Math.min(last, freqOfX(x + view.step / 2, plot) / binHz);
    let db: number;
    if (Math.floor(hi) > Math.ceil(lo)) {
      db = -Infinity;
      for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) db = Math.max(db, bins[k]!);
    } else {
      const at = Math.min(last, freqOfX(x, plot) / binHz);
      const k = Math.min(last - 1, Math.floor(at));
      db = bins[k]! + (at - k) * (bins[k + 1]! - bins[k]!);
    }
    const share = Math.min(1, Math.max(0, (db - view.floorDb) / span));
    out[n++] = plot.height * (1 - (Number.isNaN(share) ? 0 : share));
  }
  return n;
}

/** What the reader reads of its card. */
export interface SpectrumHost {
  /** The curve's canvas: in the page while the card is. */
  readonly canvas: HTMLElement;
  /** The live EQ stage, if audio is on. */
  stage(): InsertStage<InsertSpec> | undefined;
  running(): boolean;
  /** The master output stage's latest input peak, linear. */
  peak(): number;
  /** Redraw with these levels (dBFS per bin), or with no spectrum. */
  draw(bins: Float32Array | null): void;
}

type Spectrum = NonNullable<InsertStage<InsertSpec>['spectrum']>;

/** Read the stage's spectrum into its card while the gate says so, on the shared frame loop. */
export function watchEqSpectrum(host: SpectrumHost): void {
  const gate = createSpectrumGate();
  const bins = new Float32Array(EQ_SPECTRUM.fftSize / 2);
  let tap: Spectrum | undefined;
  let frames = 0;
  const release = (): void => {
    tap?.setActive(false);
    tap = undefined;
  };
  const verdict = (attached: boolean, shown: boolean): SpectrumStep =>
    gate.step({
      attached,
      shown,
      running: host.running(),
      peak: host.peak(),
      now: performance.now(),
    });
  watchPlayhead({
    attached: () => {
      if (host.canvas.isConnected) return true;
      release();
      return false;
    },
    shown: () => {
      if (host.canvas.closest('[hidden]') === null) return true;
      verdict(true, false);
      release();
      return false;
    },
    playheadAt: () => {
      const step = verdict(true, true);
      const next = step.active ? host.stage()?.spectrum : undefined;
      if (next !== tap) {
        release();
        tap = next;
        tap?.setActive(true);
      }
      if (!tap) return -1;
      if (step.draw) frames++;
      return frames;
    },
    mark: (frame) => {
      if (frame < 0 || !tap) return host.draw(null);
      tap.read(bins);
      host.draw(bins);
    },
  });
}
