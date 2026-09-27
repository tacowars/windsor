/**
 * The envelope display (#70, ported). The curve it draws is the engine's own
 * `segmentLevel` (#620 decision 4): the worklet harness pins that function to
 * `fm-processor.js`, so the drawing and the DSP cannot disagree. The knob
 * groups beside it are `envelopeKnobs.ts`.
 */
import type { Envelope } from '@windsor/engine';
import { segmentLevel } from '@windsor/engine';
import { LINE_BRIGHT_COLOR, LINE_COLOR } from './consoleColors';
import {
  ENV_GUIDE_DASH,
  ENV_HOLD_MIN_S,
  ENV_HOLD_SHARE,
  ENV_PAD_PX,
  ENV_SEGMENT_POINTS,
  ENV_TRACE_WIDTH,
} from './envCanvasConstants';
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
    for (let i = 1; i <= ENV_SEGMENT_POINTS; i++) {
      const p = i / ENV_SEGMENT_POINTS;
      g.lineTo(X(t0 + p * dur), Y(segmentLevel(v0, v1, p, curve)));
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
