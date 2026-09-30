/**
 * The Parametric EQ's card (windsor#199, record
 * `2026-09-30-parametric-eq-insert` decision 8; the mockup's layout,
 * `docs/research/2026-09-30-parametric-eq/mockup.html`): one page at the
 * rack's height. On the left the band row over the curve; on the right the
 * selected band's panel (Type, Slope, Listen on drag, Freq, Gain, Q), a rule,
 * then Scale and Output. The on/off switch is the rack's rail.
 *
 * Every edit is the insert's whole spec, `bands` included, through
 * `ctx.change`, so it is live and saved; a drag commits on every move inside
 * one undo step, as a knob does. The selected band, the ± range and the
 * Listen switch are session view state, kept here by the insert's id
 * (`insertRackModel.ts`'s `rackKey`) and never in the song.
 *
 * Behind the curve, the EQ's output spectrum (`eqSpectrum.ts`); with the
 * Listen switch on, holding a point plays only that band (`eqListen.ts`),
 * with the "Listening" pill over the curve (windsor#200). Both are live
 * only: the stage's analyser tap and `listen`, never the spec.
 */
import { DEFAULT_EQ, EQ_SPECTRUM } from '@windsor/engine';
import type { InsertSpec, InsertStage } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { drawEqCurve, eqCanvasContext, eqPalette } from './eqCurve';
import type { EqPalette } from './eqCurve';
import { wireEqCurve } from './eqCurveInput';
import { eqPlot } from './eqCurveModel';
import type { EqListenControl } from './eqListen';
import { wireEqListen } from './eqListen';
import type { EqCardModel } from './eqPanel';
import { eqBandRow, eqPanel, eqRangeToggle } from './eqPanel';
import { watchEqSpectrum } from './eqSpectrum';
import type { EqView } from './eqTables';
import {
  EQ_CURVE_LABEL,
  EQ_DEFAULT_VIEW,
  EQ_FALLBACK_SAMPLE_RATE,
  EQ_FULL_MESSAGE,
} from './eqTables';
import type { InsertCard } from './insertCards';
import { insertPage } from './insertLayout';
import { insertIdAt, rackKey } from './insertRackModel';
import type { InsertTarget } from './insertTarget';
import { insertChange, insertsOf, liveInsert } from './insertTarget';

/** Every EQ's view for this session, by `rackKey`: never in the song. */
const views = new Map<string, EqView>();

function cardModel(ctx: AppCtx, slot: InsertTarget, index: number): EqCardModel {
  const key = rackKey(slot, insertIdAt(insertsOf(ctx, slot), index));
  const model: EqCardModel = {
    spec: () => {
      const spec = insertsOf(ctx, slot)[index];
      return spec?.kind === 'eq' ? spec : DEFAULT_EQ;
    },
    view: () => views.get(key) ?? EQ_DEFAULT_VIEW,
    setView: (patch) => void views.set(key, { ...model.view(), ...patch }),
    commit: (spec) => {
      const list = insertsOf(ctx, slot).map((held, i) =>
        i === index ? { ...held, ...spec } : held,
      );
      return ctx.change(insertChange(slot, list)).ok;
    },
    sampleRate: () => ctx.host.system?.engine.context.sampleRate ?? EQ_FALLBACK_SAMPLE_RATE,
    plot: () => eqPlot(model.view().range, model.sampleRate()),
  };
  return model;
}

/** The live EQ stage at the card's slot, if audio is on. */
function eqStage(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
): InsertStage<InsertSpec> | undefined {
  const stage = liveInsert(ctx, slot, index);
  return stage?.kind === 'eq' ? stage : undefined;
}

/** The master output stage's latest input peak, linear: 0 before audio. */
function masterPeak(ctx: AppCtx): number {
  const report = ctx.host.system?.engine.outputStage?.read();
  return report ? Math.max(report.inputLeft, report.inputRight) : 0;
}

interface CurveCanvas {
  canvas: HTMLCanvasElement;
  draw(): void;
  /** Draw behind the curve with this spectrum (dBFS per bin), or with none. */
  spectrum(bins: Float32Array | null): void;
}

/** The curve's canvas, and the call that draws it from the card's state now. */
function curveCanvas(model: EqCardModel): CurveCanvas {
  const canvas = document.createElement('canvas');
  canvas.className = 'eq-plot';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', EQ_CURVE_LABEL);
  const g = eqCanvasContext(canvas);
  let palette: EqPalette | null = null;
  let bins: Float32Array | null = null;
  const draw = (): void => {
    if (!g || !canvas.isConnected) return;
    palette ??= eqPalette(canvas);
    drawEqCurve(g, {
      spec: model.spec(),
      selected: model.view().band,
      plot: model.plot(),
      sampleRate: model.sampleRate(),
      palette,
      spectrum: bins && { bins, binHz: model.sampleRate() / EQ_SPECTRUM.fftSize },
    });
  };
  const spectrum = (next: Float32Array | null): void => {
    bins = next;
    draw();
  };
  return { canvas, draw, spectrum };
}

/**
 * The curve's live extras (windsor#200): the spectrum behind it and Listen
 * on drag with its pill. Wired after the curve's own gestures, so a press
 * has selected its point before Listen starts on it.
 */
function liveExtras(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  model: EqCardModel,
  curve: CurveCanvas,
): { pill: HTMLElement; listen: EqListenControl } {
  const stage = (): InsertStage<InsertSpec> | undefined => eqStage(ctx, slot, index);
  const pill = el('div', 'eq-listen-pill');
  pill.hidden = true;
  const listen = wireEqListen({
    canvas: curve.canvas,
    pill,
    enabled: () => model.view().listen,
    spec: model.spec,
    plot: model.plot,
    sampleRate: model.sampleRate,
    stage,
    transport: () => ctx.transport.state,
  });
  watchEqSpectrum({
    canvas: curve.canvas,
    stage,
    running: () => ctx.transport.running,
    peak: () => masterPeak(ctx),
    draw: curve.spectrum,
  });
  return { pill, listen };
}

function eqPage(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const model = cardModel(ctx, slot, index);
  const curve = curveCanvas(model);
  const { canvas, draw } = curve;
  const chips = el('div', 'eq-chips');
  const panel = el('div', 'eq-band');
  const paint = {
    chips: (): void => chips.replaceChildren(...eqBandRow(model, repaint)),
    panel: (): void => panel.replaceChildren(...eqPanel(ctx, slot, index, model, repaint)),
  };
  function repaint(what: 'curve' | 'band' | 'all'): void {
    if (what !== 'curve') paint.chips();
    if (what === 'all') paint.panel();
    draw();
  }
  const knobs = (): void =>
    panel.querySelectorAll<HTMLElement & { refresh?: () => void }>('.knob').forEach((knob) => {
      knob.refresh?.();
    });
  wireEqCurve({
    canvas,
    spec: model.spec,
    plot: model.plot,
    sampleRate: model.sampleRate,
    selected: () => model.view().band,
    select: (band) => {
      model.setView({ band });
      repaint('all');
    },
    edit: (spec) => {
      if (!model.commit(spec)) return;
      knobs();
      repaint('band');
      extras.listen.refresh();
    },
    full: () => ctx.notify(EQ_FULL_MESSAGE, 'info'),
  });
  const extras = liveExtras(ctx, slot, index, model, curve);
  const wrap = el('div', 'eq-plot-wrap');
  wrap.append(
    canvas,
    eqRangeToggle(model, () => repaint('curve')),
    extras.pill,
  );
  const graph = el('div', 'eq-graph');
  graph.append(chips, wrap);
  paint.chips();
  paint.panel();
  // The canvas reads the rack's accent once it is in the page.
  requestAnimationFrame(draw);
  const page = insertPage(graph, panel);
  page.classList.add('eq-page');
  return page;
}

export const eqCard: InsertCard = (ctx, slot, index) => [
  { name: 'EQ', build: () => eqPage(ctx, slot, index) },
];
