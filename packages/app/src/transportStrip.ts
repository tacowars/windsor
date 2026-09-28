/**
 * The transport strip (#708, epic #703 decision 1), which sits in the header
 * row since windsor#11 beside the brand, the power button and the tabs — Tap,
 * BPM, Bars, 4/4, key, scale, the `bar.beat.sixteenth` position, and ▶ ■ ‖.
 * Tempo and bars are number boxes that type and drag (`numberDrag.ts`,
 * windsor#12), laid out as Ableton Live's control bar: Tap, BPM, Bars. Every edit is a live `ctx.change`, never a rebuild;
 * the buttons are `ctx.transport` (`host.ts`'s `HostTransport`), and the
 * rules they follow are `transportModel.ts`'s.
 *
 * It is chrome, not a tab: `mountTransportStrip` registers it with the
 * context, which re-renders it on every `render()` (an import, a key change
 * on the Harmony tab) and never on `invalidate()`, so a box here survives
 * its own drag. The position follows the transport on `stepStrip.ts`'s
 * `watchPlayhead` — the console's one frame loop — and the loop idles while
 * the transport is not running (issue decision 4).
 */
import type { AppContext } from './appContext';
import type { AppCtx } from './context';
import { el, select } from './dom';
import { makeNumberBox } from './numberDrag';
import { audibleTick, watchPlayhead } from './stepStrip';
import {
  barsChange,
  bpmChange,
  countsAsTap,
  dragBars,
  dragBpm,
  formatPosition,
  keyChange,
  parseBars,
  parseBpm,
  pressedButtons,
  scaleChange,
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
    if (!ctx.transport.play()) ctx.notify('enable audio first', 'warning');
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
  watchPlayhead({
    attached: () => position.isConnected,
    shown: () => ctx.transport.running,
    playheadAt: () => audibleTick(ctx),
    mark: (tick) => {
      position.textContent = formatPosition(tick, songTicks(ctx));
    },
  });
  return [position, play, stop, pause];
}

/** One group the header wraps as a unit (windsor#11 decision 2). */
function group(nodes: readonly HTMLElement[]): HTMLElement {
  const node = el('div', 'transport-group');
  for (const child of nodes) node.appendChild(child);
  return node;
}

/**
 * Draw the strip into `root` from the current document and transport: three
 * groups — tempo and bars, key and scale, position and buttons — so a narrow
 * header wraps between them, never inside one.
 */
export function renderTransportStrip(root: HTMLElement, ctx: AppCtx): void {
  root.innerHTML = '';
  const row = el('div', 'transport-row');
  row.appendChild(group([...tempoBoxes(ctx), el('span', 'transport-meter', METER_LABEL)]));
  row.appendChild(group(keyPickers(ctx)));
  row.appendChild(group(transportControls(ctx)));
  root.appendChild(row);
}

/** Register the strip as the context's chrome: it renders with every `render()`. */
export function mountTransportStrip(ctx: AppContext<HTMLElement>, root: HTMLElement): void {
  ctx.addChrome(() => renderTransportStrip(root, ctx));
}
