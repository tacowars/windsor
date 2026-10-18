/**
 * The Roll's zoom bars (windsor#902; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 1 and 9, the approved
 * mockup `docs/design/roll-zoom-mockup.html`, option B): a ↔ bar along the
 * notes pane's foot and a ↕ bar down its right side, in place of its
 * scrollbars, which are hidden. A drag on a thumb's middle scrolls, a drag
 * on either end moves that edge of the view with the other held, which
 * zooms, and a press on the track centres the view there and scrolls on
 * from it.
 *
 * The ↔ track maps the whole region: the loop tinted, and a tick for each
 * note, amber on the loop's first pass and faint on its repeats; the ↕
 * track marks each note's pitch in its colour. The maps are drawn once a
 * paint, never per frame, and a pass of the loop narrower than a pixel of
 * track is drawn once. The thumbs' maths is `rollZoomModel.ts`'s, and the
 * sizes `ROLL_ZOOM_BAR`'s: the finger sizes whenever any pointer is coarse.
 */
import { CARRIER_COLOR, MOD_COLOR } from './consoleColors';
import { el } from './dom';
import { COARSE_POINTER_QUERY } from './keyboardConstants';
import { type NoteTier, noteTier, tonesAt } from './rollHarmony';
import { forwardWheel } from './rollPanes';
import type { RollScene } from './rollScene';
import { ROLL_COLORS, ROLL_SHOW, ROLL_ZOOM_BAR } from './rollTables';
import { type AxisShare, type ViewEdge, fracAt, thumbOf } from './rollZoomModel';

/** Which bar: the ↔ bar's time, or the ↕ bar's rows. */
export type BarAxis = 'time' | 'rows';

/** What the bars read and move. */
export interface ZoomBarsTarget {
  /** The notes pane, which a wheel over a bar scrolls. */
  readonly body: HTMLElement;
  /** Where the view sits along `axis`, as shares of the whole. */
  share(axis: BarAxis): AxisShare;
  /** Scroll so the view starts at the share `start`. */
  scrollTo(axis: BarAxis, start: number): void;
  /** Move the view's `edge` to the share `moved`, its other edge held at `held`. */
  span(axis: BarAxis, edge: ViewEdge, moved: number, held: number): void;
}

/** The two bars, for the panes' grid, and their paint. */
export interface RollZoomBars {
  readonly time: HTMLElement;
  readonly rows: HTMLElement;
  /** Draw both maps for `scene` and place the thumbs. */
  paint(scene: RollScene): void;
  /** Place the thumbs on the view, after a scroll or a zoom. */
  place(): void;
}

/** One bar's parts. */
interface Bar {
  readonly axis: BarAxis;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly thumb: HTMLElement;
}

const TIER_COLOR: Readonly<Record<NoteTier, string>> = {
  chord: CARRIER_COLOR,
  scale: MOD_COLOR,
  out: ROLL_COLORS['--roll-n-out'] ?? MOD_COLOR,
};

/** The least thumb for the pointers on hand: the finger's whenever any pointer is coarse. */
const leastPx = (): number =>
  matchMedia(COARSE_POINTER_QUERY).matches
    ? ROLL_ZOOM_BAR.coarse.leastPx
    : ROLL_ZOOM_BAR.fine.leastPx;

const along = (bar: Bar): number =>
  bar.axis === 'time' ? bar.root.clientWidth : bar.root.clientHeight;

const pointerAlong = (bar: Bar, e: PointerEvent): number => {
  const box = bar.root.getBoundingClientRect();
  return bar.axis === 'time' ? e.clientX - box.left : e.clientY - box.top;
};

function makeBar(axis: BarAxis, title: string): Bar {
  const root = el('div', `roll-zbar ${axis === 'time' ? 'h' : 'v'}`);
  root.title = title;
  const canvas = el('canvas') as HTMLCanvasElement;
  const thumb = el('div', 'roll-zthumb');
  thumb.append(el('i', 'roll-zgrip a'), el('i', 'roll-zgrip b'));
  root.append(canvas, thumb);
  return { axis, root, canvas, thumb };
}

/** The canvas sized to its box × devicePixelRatio and cleared, in CSS px; null while unlaid. */
function sized(bar: Bar): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = bar.root.clientWidth;
  const h = bar.root.clientHeight;
  const g = bar.canvas.getContext('2d');
  if (!g || w === 0 || h === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  if (bar.canvas.width !== Math.round(w * dpr) || bar.canvas.height !== Math.round(h * dpr)) {
    bar.canvas.width = Math.round(w * dpr);
    bar.canvas.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

/** The ↔ map: the loop tinted, a tick per note on each pass, a pass under a pixel drawn once. */
function paintTime(bar: Bar, scene: RollScene): void {
  const box = sized(bar);
  if (!box) return;
  const { g, w, h } = box;
  const { loopTicks: loop, regionTicks: region, notes } = scene;
  const Z = ROLL_ZOOM_BAR;
  g.fillStyle = ROLL_COLORS['--roll-zbar-loop'] ?? CARRIER_COLOR;
  g.fillRect(0, Z.loopInsetPx, Math.max(Z.loopMinPx, (loop / region) * w), h - 2 * Z.loopInsetPx);
  const tickH = h - 2 * Z.tickInsetPx;
  let lastPx = -1;
  for (let pass = 0; pass * loop < region; pass++) {
    const passPx = Math.floor(((pass * loop) / region) * w);
    if (pass > 0 && passPx === lastPx) continue;
    lastPx = passPx;
    g.fillStyle = pass === 0 ? CARRIER_COLOR : (ROLL_COLORS['--roll-zbar-repeat'] ?? MOD_COLOR);
    for (const note of notes) {
      const at = note.tick + pass * loop;
      if (note.tick >= loop || at >= region) continue;
      g.fillRect(Math.floor((at / region) * w), Z.tickInsetPx, 1, tickH);
    }
  }
  g.fillStyle = ROLL_COLORS['--roll-zbar-repeat'] ?? MOD_COLOR;
  for (const note of notes) {
    if (note.tick >= loop && note.tick < region) {
      g.fillRect(Math.floor((note.tick / region) * w), Z.tickInsetPx, 1, tickH);
    }
  }
}

/** The ↕ map: a mark at each note's row, in the note's colour at its onset. */
function paintRows(bar: Bar, scene: RollScene): void {
  const box = sized(bar);
  if (!box || scene.rows.height <= 0) return;
  const { g, w, h } = box;
  const inset = ROLL_ZOOM_BAR.pitchInsetPx;
  const { place } = scene;
  for (const note of scene.notes) {
    const row = scene.rowByPitch.get(note.pitch);
    if (!row) continue;
    const { tones } = tonesAt(place.harmony, place.songTicks, place.regionStart + note.tick);
    g.fillStyle = TIER_COLOR[noteTier(note.pitch, tones)];
    const y = ((row.top + row.h / 2) / scene.rows.height) * h;
    g.fillRect(inset, Math.min(h - 1, Math.floor(y)), w - 2 * inset, 1);
  }
}

/** Set a thumb on its track from the view's shares. */
function placeThumb(bar: Bar, share: AxisShare): void {
  const thumb = thumbOf(share, along(bar), leastPx());
  const { style } = bar.thumb;
  if (bar.axis === 'time') {
    style.left = `${thumb.start}px`;
    style.width = `${thumb.length}px`;
  } else {
    style.top = `${thumb.start}px`;
    style.height = `${thumb.length}px`;
  }
}

/** A press on `bar`: a grip moves its edge, the thumb scrolls, the track jumps and scrolls on. */
function wireDrag(bar: Bar, target: ZoomBarsTarget): void {
  bar.root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = (e.target as Element).closest('.roll-zgrip');
    const onThumb = (e.target as Element).closest('.roll-zthumb') !== null;
    const track = along(bar);
    const least = leastPx();
    const from = pointerAlong(bar, e);
    if (!onThumb) {
      const thumb = thumbOf(target.share(bar.axis), track, least);
      target.scrollTo(bar.axis, fracAt(from - thumb.length / 2, track, least));
    }
    const edge: ViewEdge | null = grip ? (grip.classList.contains('a') ? 'start' : 'end') : null;
    const share = target.share(bar.axis);
    const lit = grip ?? bar.thumb;
    lit.classList.add('drag');
    bar.root.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      const by = fracAt(pointerAlong(bar, ev) - from, track, least);
      if (edge === 'start') target.span(bar.axis, edge, share.start + by, share.end);
      else if (edge === 'end') target.span(bar.axis, edge, share.end + by, share.start);
      else target.scrollTo(bar.axis, share.start + by);
    };
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      lit.classList.remove('drag');
      bar.root.removeEventListener('pointermove', move);
      bar.root.removeEventListener('pointerup', end);
      bar.root.removeEventListener('pointercancel', end);
      bar.root.removeEventListener('lostpointercapture', end);
    };
    bar.root.addEventListener('pointermove', move);
    bar.root.addEventListener('pointerup', end);
    bar.root.addEventListener('pointercancel', end);
    bar.root.addEventListener('lostpointercapture', end);
  });
  bar.root.addEventListener('wheel', (e) => forwardWheel(target.body, e), { passive: false });
}

/** The ↔ and ↕ bars over `target`. */
export function rollZoomBars(target: ZoomBarsTarget): RollZoomBars {
  const time = makeBar('time', ROLL_SHOW.timeBar);
  const rows = makeBar('rows', ROLL_SHOW.rowBar);
  wireDrag(time, target);
  wireDrag(rows, target);
  const place = (): void => {
    placeThumb(time, target.share('time'));
    placeThumb(rows, target.share('rows'));
  };
  return {
    time: time.root,
    rows: rows.root,
    paint: (scene) => {
      paintTime(time, scene);
      paintRows(rows, scene);
      place();
    },
    place,
  };
}
