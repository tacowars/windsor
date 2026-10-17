/**
 * Spectre's workbench chrome (record `2026-10-17-spectre-drawn-cells`
 * decision 10): the latching toggles, the header (title, Starting point,
 * the channel edited, Follow, Key, Listen, Close), the tool rail (the brushes, Width,
 * Levels and Snap) and each lane's column (its Steps and Link, and its
 * Shift, Offset and Select knobs, which lanes can lock like every insert
 * knob). `spectreBench.ts` composes them.
 */
import type { SpectreCurve, SpectreFollow, SpectreSpec } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { makeKnob } from './knob';
import { insertKnobs, pickKnobs } from './insertKnobs';
import type { InsertTarget } from './insertTarget';
import { withGesture } from './gestureHooks';
import { withCurveSwitch } from './spectreCellEdits';
import type { SpectreChannel } from './spectreCellEdits';
import { spectrePresetPicker } from './spectrePresetPicker';
import {
  SPECTRE_BENCH_LABELS,
  SPECTRE_BRUSH,
  SPECTRE_LANE_COLOR,
  SPECTRE_LANE_LABELS,
  SPECTRE_TOOLS,
} from './spectreBenchTables';
import type { SpectreTool } from './spectreBenchTables';
import { SPECTRE_KNOBS } from './spectreTables';

/** A latching button with a lamp: `get` reads it, a press flips it. */
export function benchToggle(
  label: string,
  hint: string,
  get: () => boolean,
  set: (on: boolean) => void,
): HTMLButtonElement & { refresh(): void } {
  const button = document.createElement('button') as HTMLButtonElement & { refresh(): void };
  button.type = 'button';
  button.className = 'spectre-toggle';
  button.title = hint;
  button.append(el('i'), document.createTextNode(label));
  button.refresh = (): void => button.setAttribute('aria-pressed', String(get()));
  button.onclick = (): void => {
    set(!get());
    button.refresh();
  };
  button.refresh();
  return button;
}

/** What the rail reads and sets on its workbench. */
export interface SpectreRailHost {
  tool(): SpectreTool;
  setTool(tool: SpectreTool): void;
  width(): number;
  setWidth(width: number): void;
  levels(): number;
  setLevels(levels: number): void;
  snap(): boolean;
  setSnap(on: boolean): void;
}

/** The tool rail; `refresh` follows a tool or width picked by key. */
export function benchRail(host: SpectreRailHost): { element: HTMLElement; refresh(): void } {
  const tools = seg(
    SPECTRE_TOOLS.map((t) => ({ value: t.id, label: `${t.label} ${t.key.toUpperCase()}` })),
    () => host.tool(),
    (value) => host.setTool(value as SpectreTool),
    STRIP_COLOR,
  );
  tools.classList.add('spectre-tools');
  [...tools.children].forEach((b, i) => ((b as HTMLElement).title = SPECTRE_TOOLS[i]!.hint));
  const width = makeKnob({
    label: SPECTRE_BENCH_LABELS.width,
    min: SPECTRE_BRUSH.widthRange[0],
    max: SPECTRE_BRUSH.widthRange[1],
    def: SPECTRE_BRUSH.width,
    step: 1,
    dial: 'rack',
    fmt: (v) => String(Math.round(v)),
    get: () => host.width(),
    set: (v) => host.setWidth(Math.round(v)),
  });
  const levels = select(
    SPECTRE_BENCH_LABELS.levels,
    SPECTRE_BRUSH.levels.map((n) => ({ value: String(n), label: n === 0 ? 'off' : String(n) })),
    String(host.levels()),
    (value) => host.setLevels(Number(value)),
  );
  const snap = benchToggle(
    SPECTRE_BENCH_LABELS.snap,
    SPECTRE_BENCH_LABELS.snapHint,
    () => host.snap(),
    (on) => host.setSnap(on),
  );
  const element = el('div', 'spectre-rail');
  element.append(tools, width, levels, snap);
  const refresh = (): void => {
    [...tools.children].forEach((b, i) =>
      b.setAttribute('aria-pressed', String(SPECTRE_TOOLS[i]!.id === host.tool())),
    );
    width.refresh();
  };
  return { element, refresh };
}

/** What a lane's column reads and writes. */
export interface SpectreLaneHost {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  current(): SpectreSpec;
  commit(next: SpectreSpec): void;
}

const MOVE_FIELDS: Readonly<Record<SpectreCurve, readonly (keyof SpectreSpec)[]>> = {
  gain: ['gainShift', 'gainOffset', 'gainSelect'],
  delay: ['delayShift', 'delayOffset', 'delaySelect'],
  feedback: ['feedbackShift', 'feedbackOffset', 'feedbackSelect'],
};

/** One lane's column: its name in its colour, Steps and Link, and its three moves. */
export function benchLaneColumn(
  host: SpectreLaneHost,
  curve: SpectreCurve,
): { element: HTMLElement; refresh(): void } {
  const swap =
    (key: 'link' | 'steps') =>
    (on: boolean): void =>
      host.commit(withCurveSwitch(host.current(), curve, key, on));
  const steps = benchToggle(
    SPECTRE_BENCH_LABELS.steps,
    SPECTRE_BENCH_LABELS.stepsHint,
    () => host.current().curves[curve].steps,
    swap('steps'),
  );
  const link = benchToggle(
    SPECTRE_BENCH_LABELS.link,
    SPECTRE_BENCH_LABELS.linkHint,
    () => host.current().curves[curve].link,
    swap('link'),
  );
  const name = el('span', 'spectre-lane-name', SPECTRE_LANE_LABELS[curve]);
  name.style.color = `var(${SPECTRE_LANE_COLOR[curve]})`;
  const head = el('div', 'spectre-lane-head');
  head.append(name, steps, link);
  const knobs = el('div', 'spectre-lane-knobs');
  knobs.append(
    ...insertKnobs(
      host.ctx,
      host.slot,
      host.index,
      pickKnobs(SPECTRE_KNOBS, MOVE_FIELDS[curve] as Parameters<typeof pickKnobs<SpectreSpec>>[1]),
    ),
  );
  const element = el('div', 'spectre-lane-column');
  element.append(head, knobs);
  const refresh = (): void => {
    steps.refresh();
    link.refresh();
    for (const knob of knobs.querySelectorAll<HTMLElement & { refresh?: () => void }>('.knob')) {
      knob.refresh?.();
    }
  };
  return { element, refresh };
}

/** What the header reads and sets on its workbench. */
export interface SpectreHeaderHost {
  current(): SpectreSpec;
  commit(next: SpectreSpec): void;
  channel(): SpectreChannel;
  setChannel(channel: SpectreChannel): void;
  showKey(): boolean;
  setShowKey(on: boolean): void;
  listen(): boolean;
  setListen(on: boolean): void;
  close(): void;
}

const FOLLOW_OPTIONS: readonly (readonly [SpectreFollow, string])[] = [
  ['off', 'Off'],
  ['key', 'Key'],
  ['chord', 'Chord'],
];

/** The header; `refresh` follows the document after an edit from elsewhere. */
export function benchHeader(host: SpectreHeaderHost): { element: HTMLElement; refresh(): void } {
  const picker = spectrePresetPicker(host.current, host.commit);
  const channel = seg(
    [
      { value: '0', label: 'L' },
      { value: '1', label: 'R' },
    ],
    () => String(host.channel()),
    (value) => host.setChannel(Number(value) as SpectreChannel),
    STRIP_COLOR,
  );
  channel.classList.add('spectre-channel');
  const follow = select(
    SPECTRE_BENCH_LABELS.follow,
    FOLLOW_OPTIONS.map(([value, label]) => ({ value, label })),
    host.current().follow,
    (value) =>
      withGesture('Spectre Follow', () =>
        host.commit({ ...host.current(), follow: value as SpectreFollow }),
      ),
  );
  const key = benchToggle(
    SPECTRE_BENCH_LABELS.key,
    SPECTRE_BENCH_LABELS.keyHint,
    host.showKey,
    host.setShowKey,
  );
  const listen = benchToggle(
    SPECTRE_BENCH_LABELS.listen,
    SPECTRE_BENCH_LABELS.listenHint,
    host.listen,
    host.setListen,
  );
  const close = seg(
    [{ value: 'close', label: SPECTRE_BENCH_LABELS.close }],
    () => '',
    () => host.close(),
    STRIP_COLOR,
  );
  close.classList.add('spectre-bench-close');
  const element = el('div', 'roll-overlay-head spectre-bench-head');
  element.append(
    el('span', 'roll-overlay-title', SPECTRE_BENCH_LABELS.title),
    picker.root,
    channel,
    follow,
    key,
    listen,
    el('span', 'roll-overlay-note', SPECTRE_BENCH_LABELS.note),
    close,
  );
  const refresh = (): void => {
    picker.refresh();
    (follow.querySelector('select') as HTMLSelectElement).value = host.current().follow;
  };
  return { element, refresh };
}
