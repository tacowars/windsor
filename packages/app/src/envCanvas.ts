/** Envelope drawing and the shared envelope knob groups (#70, ported). */
import type { Envelope } from '../../../packages/client/src/audio/index-for-editor';
import { fmt2, fmtMs, fmtSigned } from './dom';
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

  const pad = 4;
  const total = env.attackTime + env.decayTime + env.releaseTime;
  const holdT = Math.max(0.02, total * 0.28);
  const span = total + holdT || 1;
  const X = (t: number): number => pad + (t / span) * (w - pad * 2);
  const Y = (v: number): number => h - pad - v * (h - pad * 2);

  g.strokeStyle = '#2C3439';
  g.lineWidth = 1;
  g.setLineDash([2, 3]);
  g.beginPath();
  g.moveTo(pad, Y(env.sustainLevel));
  g.lineTo(w - pad, Y(env.sustainLevel));
  g.stroke();
  g.setLineDash([]);

  g.strokeStyle = color;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(X(0), Y(env.initLevel));
  const segment = (t0: number, dur: number, v0: number, v1: number, curve: number): void => {
    if (dur <= 0) return g.lineTo(X(t0), Y(v1));
    const k = Math.exp(curve * 3);
    for (let i = 1; i <= 26; i++) {
      const p = i / 26;
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

  g.strokeStyle = '#3D4950';
  g.lineWidth = 1;
  g.beginPath();
  const rx = X(env.attackTime + env.decayTime + holdT);
  g.moveTo(rx, pad);
  g.lineTo(rx, h - pad);
  g.stroke();
}

export function envKnobs(basePath: string, color: string, onChange: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const K = (sub: string, label: string, opts: Parameters<typeof pathKnob>[2]): void => {
    frag.appendChild(pathKnob(`${basePath}.${sub}`, label, { ...opts, color, onChange }));
  };
  K('attackTime', 'Attack', { min: 0.0005, max: 12, def: 0.002, curve: 'log', fmt: fmtMs });
  K('decayTime', 'Decay', { min: 0.001, max: 20, def: 0.4, curve: 'log', fmt: fmtMs });
  K('sustainLevel', 'Sustain', { min: 0, max: 1, def: 0.7, fmt: fmt2 });
  K('releaseTime', 'Release', { min: 0.001, max: 20, def: 0.3, curve: 'log', fmt: fmtMs });
  return frag;
}

export function envAdvKnobs(
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const K = (sub: string, label: string, opts: Parameters<typeof pathKnob>[2]): void => {
    frag.appendChild(pathKnob(`${basePath}.${sub}`, label, { ...opts, color, onChange }));
  };
  K('initLevel', 'Init', { min: 0, max: 1, def: 0, fmt: fmt2 });
  K('peakLevel', 'Peak', { min: 0, max: 1, def: 1, fmt: fmt2 });
  K('endLevel', 'End', { min: 0, max: 1, def: 0, fmt: fmt2 });
  K('attackCurve', 'A Crv', { min: -1, max: 1, def: 0, fmt: fmtSigned });
  K('decayCurve', 'D Crv', { min: -1, max: 1, def: 0.5, fmt: fmtSigned });
  K('releaseCurve', 'R Crv', { min: -1, max: 1, def: 0.5, fmt: fmtSigned });
  K('keyScale', 'Key', { min: -1, max: 1, def: 0, fmt: fmtSigned });
  return frag;
}
