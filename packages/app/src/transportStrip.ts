/**
 * The transport strip (#708, epic #703 decision 1), which sits in the header
 * row since windsor#11 beside the brand, the power button and the tabs — Tap,
 * BPM, Bars, swing and its grid (windsor#29), 4/4, key, scale, the `bar.beat.sixteenth` position, ▶ ■ ‖
 * and the loop button (windsor#30).
 * Tempo and bars are number boxes that type and drag (`numberDrag.ts`,
 * windsor#12), laid out as Ableton Live's control bar: Tap, BPM, Bars. Every edit is a live `ctx.change`, never a rebuild;
 * the buttons are `ctx.transport` (`host.ts`'s `HostTransport`), and the
 * rules they follow are `transportModel.ts`'s.
 *
 * It is chrome, not a tab: `mountTransportStrip` registers it with the
 * context, which re-renders it on every `render()` (an import, a key change
 * on the Harmony tab) and never on `invalidate()`, so a box here survives
 * its own drag. The position follows the transport on `stepStrip.ts`'s
 * `watchPlayhead` — the console's one frame loop. It reads the position
 * halted too, not only while running as #708 decision 4 had it, so a seek
 * from the Song view's playhead (windsor#102) shows here at once.
 */
import type { Swing } from '@windsor/engine';
import type { AppContext } from './appContext';
import type { AppCtx } from './context';
import { el, html, select } from './dom';
import { makeNumberBox } from './numberDrag';
import { keyFacts, spaceAction } from './transportKeys';
import { audibleTick, watchPlayhead } from './stepStrip';
import {
  barsChange,
  bpmChange,
  countsAsTap,
  dragBars,
  dragBpm,
  dragSwing,
  formatPosition,
  isStraight,
  keyChange,
  loopIsOn,
  loopToggle,
  parseBars,
  parseBpm,
  parseSwing,
  pressedButtons,
  scaleChange,
  swingChange,
  swingGridChange,
  swingOf,
  tapTempo,
} from './transportModel';
import {
  BARS_KNOB,
  BPM_KNOB,
  CUSTOM_SCALE,
  KEY_OPTIONS,
  METER_LABEL,
  POSITION_GRID,
  SCALE_OPTIONS,
  SWING_GRID_LABEL,
  SWING_GRID_OPTIONS,
  SWING_KNOB,
  SWING_UNIT,
} from './transportTables';

const songTicks = (ctx: AppCtx): number => ctx.model.doc.transport.bars * POSITION_GRID.bar;

/**
 * Tap, BPM, Bars (windsor#12). The song's length reshapes what every tab
 * draws (regions and events are clamped into it, a timeline appends at its
 * end), so a Bars edit re-renders the tabs — the active one included — while
 * the strip, whose box may be mid-drag, is left alone.
 */
function tempoBoxes(ctx: AppCtx): HTMLElement[] {
  const bpm = makeNumberBox({
    label: BPM_KNOB.label,
    unit: BPM_KNOB.label,
    inputMode: 'decimal',
    get: () => ctx.model.doc.transport.bpm,
    set: (v) => void ctx.change(bpmChange(v)),
    format: BPM_KNOB.fmt ?? String,
    parse: parseBpm,
    drag: (start, upPx, fine) => dragBpm(start, upPx, fine),
  });
  const bars = makeNumberBox({
    label: BARS_KNOB.label,
    unit: BARS_KNOB.label,
    inputMode: 'numeric',
    get: () => ctx.model.doc.transport.bars,
    set: (v) => {
      if (ctx.change(barsChange(v)).ok) ctx.refreshTabs();
    },
    format: BARS_KNOB.fmt ?? String,
    parse: parseBars,
    drag: (start, upPx, fine) => dragBars(start, upPx, fine),
  });
  const tap = button('Tap', 'Tap tempo: tap on the beat; a 2 s pause starts again');
  tap.classList.add('transport-tap');
  let taps: readonly number[] = [];
  // A mouse or touch taps on the press, not the release, so the beat lands
  // where the finger does; a keyboard, assistive technology or voice control
  // activates through a `click` with no press before it (`countsAsTap`).
  const onTap = (e: MouseEvent): void => {
    if (!countsAsTap(e)) return;
    const result = tapTempo(taps, performance.now());
    taps = result.taps;
    if (result.bpm !== null && ctx.change(bpmChange(result.bpm)).ok) bpm.refresh();
  };
  tap.addEventListener('pointerdown', onTap);
  tap.addEventListener('click', onTap);
  return [tap, bpm, bars];
}

/**
 * Swing and its grid (windsor#29): a number box in percent, dimmed while it
 * is straight, and a label-less 1/16 | 1/8 picker. Both write the song's whole
 * `transport.swing` through `ctx.change`.
 */
function swingControls(ctx: AppCtx): HTMLElement[] {
  const swing = (): Swing => swingOf(ctx.model.doc.transport);
  const amount = makeNumberBox({
    label: SWING_KNOB.label,
    unit: SWING_UNIT,
    inputMode: 'numeric',
    get: () => swing().amount,
    set: (v) => {
      if (ctx.change(swingChange(swing(), { amount: v })).ok) dim();
    },
    format: SWING_KNOB.fmt ?? String,
    parse: parseSwing,
    drag: (start, upPx, fine) => dragSwing(start, upPx, fine),
  });
  const dim = (): void => {
    amount.classList.toggle('transport-box-straight', isStraight(swing().amount));
  };
  dim();
  const grid = select(SWING_GRID_LABEL, SWING_GRID_OPTIONS, String(swing().grid), (value) => {
    const partial = swingGridChange(swing(), value);
    if (partial) ctx.change(partial);
  });
  return [amount, headPicker(grid, SWING_GRID_LABEL)];
}

function keyPickers(ctx: AppCtx): HTMLElement[] {
  const { root, scale } = ctx.model.doc.harmony;
  const key = select('Key', KEY_OPTIONS, String(root), (value) => {
    if (ctx.change(keyChange(Number(value))).ok) ctx.render();
  });
  const current = typeof scale === 'string' ? scale : CUSTOM_SCALE;
  const options = [...SCALE_OPTIONS];
  if (current === CUSTOM_SCALE) options.push({ value: CUSTOM_SCALE, label: CUSTOM_SCALE });
  const scalePick = select('Scale', options, current, (name) => {
    const partial = scaleChange(name);
    if (partial && ctx.change(partial).ok) ctx.render();
  });
  return [headPicker(key, 'Key'), headPicker(scalePick, 'Scale')];
}

/**
 * A header picker without its visible label (tacowars's request on windsor#12),
 * so the row stays one control high; the select keeps its `aria-label` from
 * `select()` and names itself in a tooltip.
 */
function headPicker(wrap: HTMLElement, label: string): HTMLElement {
  wrap.querySelector('.field-label')?.remove();
  wrap.classList.add('transport-picker');
  const sel = wrap.querySelector('select');
  if (sel) sel.title = label;
  return wrap;
}

function button(label: string, title: string): HTMLButtonElement {
  const node = el('button', 'btn transport-btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.setAttribute('aria-label', title);
  return node;
}

/** A loop arrow: two strokes, each ending in its arrowhead, round one another. */
const LOOP_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2.5 9V7.5A2.5 2.5 0 0 1 5 5h8M11 3l2 2-2 2"/>' +
  '<path d="M13.5 7v1.5A2.5 2.5 0 0 1 11 11H3M5 9l-2 2 2 2"/></svg>';

/**
 * The loop button (windsor#30 decision 1, Ableton Live's loop switch): lit
 * while the song loops. A press flips `transport.loop.on`, and on a song
 * with no loop yet creates one over bars 1–4 (`loopToggle`). The light
 * follows the document on the console's one frame loop, so a loop an import
 * brought, or a Bars edit dropped, shows without a render of the strip.
 */
function loopButton(ctx: AppCtx): HTMLElement {
  const loop = button('', 'Loop: repeat the bars under the loop brace on the Song tab');
  loop.classList.add('transport-loop');
  loop.appendChild(html('span', 'loop-icon', LOOP_ICON));
  const sync = (on: boolean): void => loop.setAttribute('aria-pressed', String(on));
  loop.onclick = (): void => {
    if (ctx.change(loopToggle(ctx.model.doc.transport)).ok) sync(loopIsOn(ctx.model.doc.transport));
  };
  sync(loopIsOn(ctx.model.doc.transport));
  watchPlayhead({
    attached: () => loop.isConnected,
    playheadAt: () => Number(loopIsOn(ctx.model.doc.transport)),
    mark: (on) => sync(on === 1),
  });
  return loop;
}

/** ▶, as the button and the space bar (windsor#111) press it. */
function playTransport(ctx: AppCtx): void {
  if (!ctx.transport.play()) ctx.notify('enable audio first', 'warning');
}

/** The transport states, numbered for `watchPlayhead`, which marks a changed number. */
const STATE_ORDER = ['idle', 'playing', 'paused'] as const;

/** ▶ ■ ‖ and the position they move. */
function transportControls(ctx: AppCtx): HTMLElement[] {
  const position = el(
    'span',
    'transport-position',
    formatPosition(audibleTick(ctx), songTicks(ctx)),
  );
  position.setAttribute('aria-label', 'Position (bar.beat.sixteenth)');
  const play = button('▶', 'Play from the current position');
  const stop = button('■', 'Stop, release every voice and return to 1.1.1');
  const pause = button('‖', 'Pause, keeping the position');
  const sync = (): void => {
    const pressed = pressedButtons(ctx.transport.state);
    play.setAttribute('aria-pressed', String(pressed.play));
    pause.setAttribute('aria-pressed', String(pressed.pause));
  };
  play.onclick = (): void => {
    playTransport(ctx);
    sync();
  };
  pause.onclick = (): void => {
    ctx.transport.pause();
    sync();
  };
  stop.onclick = (): void => {
    ctx.transport.stop();
    position.textContent = formatPosition(audibleTick(ctx), songTicks(ctx));
    sync();
  };
  sync();
  // The lights follow the transport, so a Space toggle (windsor#111) shows too.
  watchPlayhead({
    attached: () => play.isConnected,
    playheadAt: () => STATE_ORDER.indexOf(ctx.transport.state),
    mark: sync,
  });
  watchPlayhead({
    attached: () => position.isConnected,
    playheadAt: () => audibleTick(ctx),
    mark: (tick) => {
      position.textContent = formatPosition(tick, songTicks(ctx));
    },
  });
  return [position, play, stop, pause, loopButton(ctx)];
}

/** One group the header wraps as a unit (windsor#11 decision 2). */
function group(nodes: readonly HTMLElement[]): HTMLElement {
  const node = el('div', 'transport-group');
  for (const child of nodes) node.appendChild(child);
  return node;
}

/**
 * Draw the strip into `root` from the current document and transport: four
 * groups — tempo and bars, swing and the meter, key and scale, position and
 * buttons — so a narrow header wraps between them, never inside one.
 */
export function renderTransportStrip(root: HTMLElement, ctx: AppCtx): void {
  root.innerHTML = '';
  const row = el('div', 'transport-row');
  row.appendChild(group(tempoBoxes(ctx)));
  row.appendChild(group([...swingControls(ctx), el('span', 'transport-meter', METER_LABEL)]));
  row.appendChild(group(keyPickers(ctx)));
  row.appendChild(group(transportControls(ctx)));
  root.appendChild(row);
}

/**
 * The space bar toggles the transport (windsor#111): ▶ from stopped or
 * paused, ‖ while playing. The key is swallowed when it acts, so a focused
 * button isn't clicked as well and the page doesn't scroll.
 */
function attachSpaceBar(ctx: AppCtx): void {
  addEventListener('keydown', (e) => {
    const action = spaceAction(keyFacts(e), ctx.transport.state);
    if (action === null) return;
    e.preventDefault();
    if (action === 'play') playTransport(ctx);
    else if (action === 'pause') ctx.transport.pause();
  });
}

/**
 * Register the strip as the context's chrome: it renders with every
 * `render()`. The space bar's listener is attached here, once.
 */
export function mountTransportStrip(ctx: AppContext<HTMLElement>, root: HTMLElement): void {
  ctx.addChrome(() => renderTransportStrip(root, ctx));
  attachSpaceBar(ctx);
}
