/**
 * The Output display: draws the analyser tap on the engine master (#70) in
 * one of three views (windsor#586): Scope, Cycle and Spectrum, a tap on the
 * canvas moving to the next. This file is the canvas's frame loop and the
 * view switch; `scopeTrace.ts` draws Scope and Cycle, `scopeSpectrum.ts`
 * Spectrum, and each view does only its own reading. Every load starts on
 * Scope, and nothing remembers the view. The loop draws nothing while the
 * canvas is hidden.
 */
import { LINE_COLOR } from './consoleColors';
import type { ScopeView } from './scopeConstants';
import { SCOPE_VIEW_LABELS, SCOPE_VIEWS } from './scopeConstants';
import { createSpectrumDrawer } from './scopeSpectrum';
import { createTraceDrawer } from './scopeTrace';

/** The view after `view`, round again past the last. */
export const nextScopeView = (view: ScopeView): ScopeView =>
  SCOPE_VIEWS[(SCOPE_VIEWS.indexOf(view) + 1) % SCOPE_VIEWS.length]!;

export function startScope(canvas: HTMLCanvasElement, analyser: () => AnalyserNode | null): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const dpr = window.devicePixelRatio || 1;
  // The view's name at the right end of the section's title.
  const label = canvas.parentElement?.querySelector<HTMLElement>('[data-scope-view]') ?? null;
  const trace = createTraceDrawer();
  const spectrum = createSpectrumDrawer();
  let view: ScopeView = SCOPE_VIEWS[0];
  const show = (): void => {
    if (label) label.textContent = SCOPE_VIEW_LABELS[view];
  };
  canvas.addEventListener('click', () => {
    view = nextScopeView(view);
    show();
  });
  show();

  const tick = (): void => {
    if (!canvas.isConnected) return;
    requestAnimationFrame(tick);
    if (canvas.closest('[hidden]') !== null) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const node = analyser();
    if (view === 'spectrum') {
      if (node) spectrum.draw(g, node, w, h);
      return;
    }
    g.strokeStyle = LINE_COLOR;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    if (node) trace.draw(g, node, view === 'cycle', w, h);
  };
  tick();
}
