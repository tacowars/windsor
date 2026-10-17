/**
 * Spectre's workbench (record `2026-10-17-spectre-drawn-cells` decision 10):
 * the instrument the card's Expand opens over the page, on the console's
 * expanded-view ground (`.roll-overlay`). Three lanes of cells (gain, delay,
 * feedback) over one frequency axis, drawn on with brushes over the live
 * spectrum, with one selection across them, Follow, Listen, the Starting
 * point picker, the Shape row and each lane's moves.
 *
 * It keeps no copy of the song: every edit commits the whole insert through
 * the card's model, and each frame it redraws when the document, the scope's
 * reports or its own state moved, so an undo from anywhere shows at once.
 * It closes on Esc or Close, or when the insert is gone; closing turns the
 * scope and Listen off, and the card redraws.
 */
import { pitchMask, scaleOffsets } from '@windsor/engine';
import type { SpectreCurve, SpectreScope, SpectreSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { insertsOf, liveInsert } from './insertTarget';
import type { InsertTarget } from './insertTarget';
import { benchContext, benchPalette, drawBench } from './spectreBenchDraw';
import type { SpectreBenchPalette } from './spectreBenchDraw';
import { wireSpectreBench } from './spectreBenchInput';
import { benchKeyAction, benchKeyFacts } from './spectreBenchKeys';
import type { SpectreBenchKey } from './spectreBenchKeys';
import { activeCells, benchLayout, gridShare, heardCells, readout } from './spectreBenchModel';
import type { SpectreBenchLayout } from './spectreBenchModel';
import { benchHeader, benchLaneColumn, benchRail } from './spectreBenchParts';
import { spectreShapeRow } from './spectreBenchShape';
import { brushSpan, editedCells, withCells } from './spectreCellEdits';
import type { SpectreChannel } from './spectreCellEdits';
import { applyTransform } from './spectreBenchTransforms';
import { generate, generatedInto, keyCells } from './spectreGenerators';
import type { SpectreSongKey } from './spectreGenerators';
import {
  SPECTRE_BENCH,
  SPECTRE_BENCH_LABELS,
  SPECTRE_BRUSH,
  SPECTRE_LANES,
  SPECTRE_SHAPE_SETTINGS,
} from './spectreBenchTables';
import type { SpectreGenerator, SpectreShapeSetting, SpectreTool } from './spectreBenchTables';
import { transformMask } from './spectreCellEdits';

/** What the workbench needs of the card that opens it. */
export interface SpectreBenchHost {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  /** The rack's accent, which the overlay, outside the rack, cannot inherit. */
  readonly accent: string;
  current(): SpectreSpec;
  commit(next: SpectreSpec): void;
  /** After it closes: the card redraws what the workbench changed. */
  closed(): void;
}

interface BenchState {
  tool: SpectreTool;
  width: number;
  levels: number;
  snap: boolean;
  channel: SpectreChannel;
  focus: SpectreCurve;
  generator: SpectreGenerator | null;
  settings: Record<SpectreShapeSetting, number>;
  listen: boolean;
  showKey: boolean;
  hover: { cell: number; curve: SpectreCurve } | null;
  /** Bumped by every change of the workbench's own state, so the next frame redraws. */
  version: number;
}

const defaultSettings = (): Record<SpectreShapeSetting, number> =>
  Object.fromEntries(
    Object.entries(SPECTRE_SHAPE_SETTINGS).map(([key, s]) => [key, s.def]),
  ) as Record<SpectreShapeSetting, number>;

/** The song's key as the generators and Follow read it. */
function songKey(ctx: AppCtx): SpectreSongKey {
  const { root, scale } = ctx.model.doc.harmony;
  return { root, offsets: scaleOffsets(scale) };
}

/** Open the workbench over the page; returns its close. */
// eslint-disable-next-line max-lines-per-function -- composition: the overlay's parts, its loop and its keys, in one place
export function openSpectreBench(host: SpectreBenchHost): () => void {
  const { ctx } = host;
  const state: BenchState = {
    tool: 'draw',
    width: SPECTRE_BRUSH.width,
    levels: 0,
    snap: true,
    channel: 0,
    focus: 'delay',
    generator: null,
    settings: defaultSettings(),
    listen: false,
    showKey: false,
    hover: null,
    version: 0,
  };
  const touch = (): void => {
    state.version++;
  };
  const current = host.current;
  /** Commits made here, so the next frame knows the document moved because of us. */
  let own: SpectreSpec | null = null;
  const commit = (next: SpectreSpec): void => {
    host.commit(next);
    own = current();
  };
  const bpm = (): number => ctx.model.doc.transport.bpm;
  const target = () => ({
    curve: state.focus,
    channel: state.channel,
    grid: gridShare(current(), bpm()),
    levels: state.levels,
  });

  const overlay = el('div', 'roll-overlay spectre-bench');
  overlay.style.setProperty('--kc', host.accent);
  const canvas = document.createElement('canvas');
  canvas.className = 'spectre-bench-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', SPECTRE_BENCH_LABELS.canvas);
  const plot = el('div', 'spectre-bench-plot');
  plot.append(canvas);
  const readoutLine = el('div', 'spectre-readout', ' ');

  const scope = (): SpectreScope | undefined =>
    liveInsert(ctx, host.slot, host.index)?.spectreScope;
  const header = benchHeader({
    current,
    commit,
    // A preset moves the columns' toggles and knobs: the next frame follows it as an outside edit.
    picked: () => (own = null),
    channel: () => state.channel,
    setChannel: (channel) => {
      state.channel = channel;
      touch();
    },
    showKey: () => state.showKey,
    setShowKey: (on) => {
      state.showKey = on;
      touch();
    },
    listen: () => state.listen,
    setListen: (on) => {
      state.listen = on;
      scope()?.setListen(on);
    },
    close: () => close(),
  });

  // The rail, the lanes' columns and the Shape row.
  const rail = benchRail({
    tool: () => state.tool,
    setTool: (tool) => {
      state.tool = tool;
      touch();
    },
    width: () => state.width,
    setWidth: (width) => {
      state.width = width;
      touch();
    },
    levels: () => state.levels,
    setLevels: (levels) => (state.levels = levels),
    snap: () => state.snap,
    setSnap: (on) => (state.snap = on),
  });
  const laneHost = { ctx, slot: host.slot, index: host.index, current, commit };
  const columns = SPECTRE_LANES.map(({ curve }) => benchLaneColumn(laneHost, curve));
  const side = el('div', 'spectre-bench-side');
  side.append(...columns.map((c) => c.element));

  const preview = (): number[] | null => {
    if (!state.generator) return null;
    const shape = generate(state.generator, state.settings, songKey(ctx));
    const cells = editedCells(current(), state.focus, state.channel);
    return generatedInto(cells, shape, transformMask(current()));
  };
  const applyShape = (): void => {
    const cells = preview();
    if (!cells) return;
    withGesture(`${SPECTRE_BENCH_LABELS.undo} ${SPECTRE_BENCH_LABELS.shape}`, () =>
      commit(withCells(current(), state.focus, state.channel, cells)),
    );
    state.generator = null;
    shape.refresh();
    touch();
  };
  const shape = spectreShapeRow({
    generator: () => state.generator,
    pickGenerator: (next) => {
      state.generator = next;
      touch();
    },
    setting: (key) => state.settings[key],
    setSetting: (key, value) => {
      state.settings[key] = value;
      touch();
    },
    focus: () => state.focus,
    setFocus: (curve) => {
      state.focus = curve;
      touch();
    },
    apply: applyShape,
    transform: (id) =>
      withGesture(`${SPECTRE_BENCH_LABELS.undo} ${id}`, () =>
        commit(applyTransform(current(), id, target())),
      ),
  });

  const body = el('div', 'spectre-bench-body');
  const centre = el('div', 'spectre-bench-centre');
  centre.append(plot, readoutLine);
  body.append(rail.element, centre, side);
  overlay.append(header.element, body, shape.element);

  // Drawing.
  let layout: SpectreBenchLayout = benchLayout(SPECTRE_BENCH.minLanePx, SPECTRE_BENCH.minLanePx);
  let g: CanvasRenderingContext2D | null = null;
  let palette: SpectreBenchPalette | null = null;
  const fit = (): void => {
    const box = plot.getBoundingClientRect();
    layout = benchLayout(Math.max(1, Math.floor(box.width)), Math.max(1, Math.floor(box.height)));
    g = benchContext(canvas, layout.width, layout.height);
    layout.lanes.forEach((lane, i) => {
      columns[i]!.element.style.height = `${lane.height}px`;
    });
    side.style.rowGap = `${SPECTRE_BENCH.laneGapPx}px`;
    touch();
  };
  const resize = new ResizeObserver(fit);

  wireSpectreBench({
    canvas,
    layout: () => layout,
    spec: current,
    commit,
    tool: () => state.tool,
    width: () => state.width,
    levels: () => state.levels,
    snap: () => state.snap,
    grid: () => gridShare(current(), bpm()),
    channel: () => state.channel,
    hover: (at) => {
      state.hover = at;
      touch();
    },
    setFocus: (curve) => {
      if (state.focus === curve) return;
      state.focus = curve;
      shape.refresh();
      touch();
    },
  });

  const keyPitches = (): number => {
    const key = songKey(ctx);
    return pitchMask(key.root, key.offsets);
  };
  const draw = (spec: SpectreSpec): void => {
    if (!g) return;
    palette ??= benchPalette(overlay);
    const reading = scope()?.read();
    const pitches = spec.follow === 'off' ? 0 : reading?.pitches || keyPitches();
    const active = activeCells(spec, pitches);
    const lfo = reading?.lfo ?? 0;
    const heard = Object.fromEntries(
      SPECTRE_LANES.map(({ curve }) => [
        curve,
        heardCells(spec, curve, state.channel, active, lfo),
      ]),
    ) as Record<SpectreCurve, number[]>;
    const hover = state.hover
      ? brushSpan(state.hover.cell, state.tool === 'select' ? 1 : state.width)
      : null;
    const cells = preview();
    drawBench(g, {
      spec,
      layout,
      channel: state.channel,
      palette,
      active,
      heard,
      preview: cells ? { curve: state.focus, cells } : null,
      spectrum:
        reading?.input && reading.output ? { input: reading.input, output: reading.output } : null,
      bands: Number(spec.bands),
      grid: gridShare(spec, bpm()),
      hover: state.hover && hover ? { cell: state.hover.cell, from: hover[0], to: hover[1] } : null,
      focus: state.focus,
      keyCells: state.showKey ? keyCells(songKey(ctx)) : null,
    });
    if (state.hover) {
      const r = readout(spec, state.hover.cell, state.channel, bpm());
      readoutLine.textContent = `${r.span} · ${r.note}   Gain ${r.gain}   Delay ${r.delay}   Feedback ${r.feedback}`;
    }
  };

  let lastSpec: SpectreSpec | null = null;
  let lastReports = -1;
  let lastVersion = -1;
  let lastLive: SpectreScope | undefined;
  let raf = 0;
  const frame = (): void => {
    if (!overlay.isConnected) return;
    raf = requestAnimationFrame(frame);
    if (insertsOf(ctx, host.slot)[host.index]?.kind !== 'spectre') return close();
    const spec = current();
    const live = scope();
    live?.setActive(true);
    if (live !== lastLive) {
      // An undo or redo can rebuild the live system: the new stage takes Listen from the bench.
      live?.setListen(state.listen);
      lastLive = live;
    }
    const reports = live?.read().reports ?? 0;
    if (spec !== lastSpec && spec !== own) {
      // Moved from outside (an undo, a lane, the card): the controls follow it.
      header.refresh();
      for (const column of columns) column.refresh();
    } else if (spec !== lastSpec) header.refresh();
    if (spec === lastSpec && reports === lastReports && state.version === lastVersion) return;
    lastSpec = spec;
    lastReports = reports;
    lastVersion = state.version;
    rail.refresh();
    draw(spec);
  };

  const keyAction = (action: SpectreBenchKey): void => {
    if (action.kind === 'escape') {
      if (state.generator) {
        state.generator = null;
        shape.refresh();
        touch();
      } else close();
      return;
    }
    if (action.kind === 'tool') state.tool = action.tool;
    else if (action.kind === 'width') {
      const [lo, hi] = SPECTRE_BRUSH.widthRange;
      state.width = Math.min(hi, Math.max(lo, state.width + action.by));
    } else if (action.kind === 'lane') {
      state.focus = action.curve;
      shape.refresh();
    } else if (action.kind === 'apply') applyShape();
    else {
      withGesture(`${SPECTRE_BENCH_LABELS.undo} nudge`, () =>
        commit(applyTransform(current(), action.by > 0 ? 'right' : 'left', target())),
      );
    }
    touch();
  };
  const onKey = (e: KeyboardEvent): void => {
    const action = benchKeyAction(benchKeyFacts(e));
    if (!action) return;
    e.preventDefault();
    // Before the audition keyboard on `window`, which would play these keys as notes.
    e.stopPropagation();
    keyAction(action);
  };

  const close = (): void => {
    if (!overlay.isConnected) return;
    cancelAnimationFrame(raf);
    resize.disconnect();
    const live = scope();
    live?.setListen(false);
    live?.setActive(false);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    host.closed();
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  resize.observe(plot);
  fit();
  canvas.focus();
  raf = requestAnimationFrame(frame);
  return close;
}
