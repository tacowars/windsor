/** Envelope drawing and the shared envelope knob groups (#70, ported). */
import type { Envelope } from '../../../packages/client/src/audio/index-for-editor';
import { LINE_BRIGHT_COLOR, LINE_COLOR } from './consoleColors';
import {
  ENV_CURVE_STEEPNESS,
  ENV_GUIDE_DASH,
  ENV_HOLD_MIN_S,
  ENV_HOLD_SHARE,
  ENV_PAD_PX,
  ENV_SEGMENT_POINTS,
  ENV_TRACE_WIDTH,
} from './envCanvasConstants';
import { ENVELOPE_ADV_KNOBS, ENVELOPE_KNOBS, patchKnobOpts } from './patchKnobTables';
import type { PatchKnobTable } from './patchKnobTables';
import { pathKnob } from './patchState';

const curveShape = (p: number, k: number): number => p / (p + (1 - p) * k);

export function drawEnv(canvas: HTMLCanvasElement, env: Envelope, color: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const pad = ENV_PAD_PX;
  const total = env.attackTime + env.decayTime + env.releaseTime;
  const holdT = Math.max(ENV_HOLD_MIN_S, total * ENV_HOLD_SHARE);
  const span = total + holdT || 1;
  const X = (t: number): number => pad + (t / span) * (w - pad * 2);
  const Y = (v: number): number => h - pad - v * (h - pad * 2);

  g.strokeStyle = LINE_COLOR;
  g.lineWidth = 1;
  g.setLineDash([...ENV_GUIDE_DASH]);
  g.beginPath();
  g.moveTo(pad, Y(env.sustainLevel));
  g.lineTo(w - pad, Y(env.sustainLevel));
  g.stroke();
  g.setLineDash([]);

  g.strokeStyle = color;
  g.lineWidth = ENV_TRACE_WIDTH;
  g.beginPath();
  g.moveTo(X(0), Y(env.initLevel));
  const segment = (t0: number, dur: number, v0: number, v1: number, curve: number): void => {
    if (dur <= 0) return g.lineTo(X(t0), Y(v1));
    const k = Math.exp(curve * ENV_CURVE_STEEPNESS);
    for (let i = 1; i <= ENV_SEGMENT_POINTS; i++) {
      const p = i / ENV_SEGMENT_POINTS;
      const s = k === 1 ? p : curveShape(p, k);
      g.lineTo(X(t0 + p * dur), Y(v0 + (v1 - v0) * s));
    }
  };
  let t = 0;
  segment(t, env.attackTime, env.initLevel, env.peakLevel, env.attackCurve);
  t += env.attackTime;
  segment(t, env.decayTime, env.peakLevel, env.sustainLevel, env.decayCurve);
  t += env.decayTime;
  g.lineTo(X(t + holdT), Y(env.sustainLevel));
  t += holdT;
  segment(t, env.releaseTime, env.sustainLevel, env.endLevel, env.releaseCurve);
  g.stroke();

  g.strokeStyle = LINE_BRIGHT_COLOR;
  g.lineWidth = 1;
  g.beginPath();
  const rx = X(env.attackTime + env.decayTime + holdT);
  g.moveTo(rx, pad);
  g.lineTo(rx, h - pad);
  g.stroke();
}

/** One envelope table's knobs under `basePath`, each defaulting to the engine's value there. */
function envelopeRow(
  table: PatchKnobTable,
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const entry of table) {
    const path = `${basePath}.${entry.f}`;
    frag.appendChild(
      pathKnob(path, entry.label, { ...patchKnobOpts(entry, path), color, onChange }),
    );
  }
  return frag;
}

export function envKnobs(basePath: string, color: string, onChange: () => void): DocumentFragment {
  return envelopeRow(ENVELOPE_KNOBS, basePath, color, onChange);
}

export function envAdvKnobs(
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  return envelopeRow(ENVELOPE_ADV_KNOBS, basePath, color, onChange);
}
