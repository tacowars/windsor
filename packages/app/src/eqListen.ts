/**
 * Listen on drag, wired (windsor#200 decision 3): with the card's switch on,
 * a press on a point plays only that band, as a band-pass, until the hold
 * ends. It ends on release, cancel or a lost capture, when the curve loses
 * focus, when the card leaves the page (the insert folded, paged away or
 * removed), when its tab hides, and when the transport stops; each end
 * calls the stage it started on, so a rebuilt system never keeps a listen.
 * The pill over the curve names the band and follows its frequency. Live
 * only: the stage's `listen`, never the spec or the song.
 *
 * The press itself is `eqCurveInput.ts`'s (it selects and drags the point);
 * this listens beside it, and `listenStarts` / `listenEnds` say when.
 */
import { EQ_LISTEN } from '@windsor/engine';
import type { EqSpec, InsertSpec, InsertStage } from '@windsor/engine';
import type { EqPlot } from './eqCurveModel';
import { hitBand } from './eqCurveModel';
import { eqListenLabel } from './eqTables';
import { watchPlayhead } from './stepStrip';
import type { TransportState } from './transportModel';

/** What Listen reads of its card. */
export interface EqListenHost {
  readonly canvas: HTMLCanvasElement;
  readonly pill: HTMLElement;
  /** The card's "Listen on drag" switch. */
  enabled(): boolean;
  spec(): EqSpec;
  plot(): EqPlot;
  sampleRate(): number;
  /** The live EQ stage, if audio is on. */
  stage(): InsertStage<InsertSpec> | undefined;
  transport(): TransportState;
}

/** The band a primary press at `point` listens to, or `EQ_LISTEN.off`. */
export function listenStarts(
  host: Pick<EqListenHost, 'enabled' | 'spec' | 'plot' | 'sampleRate'>,
  point: { readonly x: number; readonly y: number; readonly button: number },
): number {
  if (point.button !== 0 || !host.enabled()) return EQ_LISTEN.off;
  const band = hitBand(host.spec(), point, host.plot(), host.sampleRate());
  return band >= 0 ? band : EQ_LISTEN.off;
}

/** What a frame of a listen sees: the card in the page and shown, and the transport. */
export interface ListenFrame {
  readonly attached: boolean;
  readonly shown: boolean;
  /** The transport when the listen started, and now. */
  readonly began: TransportState;
  readonly now: TransportState;
}

/**
 * A listen ends when its card goes, its tab hides, or the transport stops or
 * pauses under it; the transport starting under it keeps it.
 */
export const listenEnds = (f: ListenFrame): boolean =>
  !f.attached || !f.shown || (f.now !== f.began && f.now !== 'playing');

/** The card's handle on Listen: the pill follows an edit through `refresh`. */
export interface EqListenControl {
  refresh(): void;
}

/** Wire Listen on `host.canvas`; the returned control repaints the pill. */
export function wireEqListen(host: EqListenHost): EqListenControl {
  const { canvas, pill } = host;
  let band: number = EQ_LISTEN.off;
  let heard: InsertStage<InsertSpec> | undefined;
  let began: TransportState = 'idle';
  const refresh = (): void => {
    pill.hidden = band < 0;
    const freq = host.spec().bands[band]?.freq;
    if (band >= 0 && freq !== undefined) pill.textContent = eqListenLabel(band, freq);
  };
  const stop = (): void => {
    if (band < 0) return;
    heard?.listen?.(EQ_LISTEN.off);
    heard = undefined;
    band = EQ_LISTEN.off;
    refresh();
  };
  canvas.addEventListener('pointerdown', (e) => {
    stop();
    const box = canvas.getBoundingClientRect();
    const point = { x: e.clientX - box.left, y: e.clientY - box.top, button: e.button };
    const next = listenStarts(host, point);
    heard = next >= 0 ? host.stage() : undefined;
    if (!heard?.listen) return;
    band = next;
    began = host.transport();
    heard.listen(band);
    refresh();
  });
  canvas.addEventListener('pointermove', (e) => {
    if ((e.buttons & 1) === 0) stop();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
    canvas.addEventListener(type, stop);
  watchPlayhead({
    attached: () => {
      if (canvas.isConnected) return true;
      stop();
      return false;
    },
    playheadAt: () => {
      if (band < 0) return 0;
      const frame = {
        attached: canvas.isConnected,
        shown: canvas.closest('[hidden]') === null,
        began,
        now: host.transport(),
      };
      if (listenEnds(frame)) stop();
      return 0;
    },
    mark: () => {},
  });
  return { refresh };
}
