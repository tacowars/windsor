/**
 * The console's one control: a drag/keyboard knob bound to a getter/setter.
 * Ported from the patch editor's original inline script (#70); the widget is
 * pure UI — every value lands wherever `set` points it.
 */

export interface KnobSpec {
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number;
  curve?: 'log';
  fmt?: (v: number) => string;
  color?: string;
  get: () => number;
  set: (v: number) => void;
  onChange?: () => void;
}

const KNOB_R = 15;
const ARC_START = -135;
const ARC_END = 135;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function knobDom(spec: KnobSpec): HTMLElement {
  const node = document.createElement('div');
  node.className = 'knob';
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-label', spec.label);
  if (spec.color) node.style.setProperty('--knob-color', spec.color);
  const size = KNOB_R * 2 + 8;
  const c = size / 2;
  node.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="dial-face" cx="${c}" cy="${c}" r="${KNOB_R - 3.5}"></circle>` +
    `<path class="dial-track" d="${arcPath(c, c, KNOB_R, ARC_START, ARC_END)}"></path>` +
    `<path class="dial-arc" d=""></path>` +
    `<line class="dial-pin" x1="${c}" y1="${c}" x2="${c}" y2="${c - KNOB_R + 5}"></line>` +
    `</svg>` +
    `<span class="knob-val"></span><span class="knob-label">${spec.label}</span>`;
  node.title = `${spec.label} - drag, shift-drag for fine, double-click to reset`;
  return node;
}

interface Scale {
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
}

function scaleFor(spec: KnobSpec): Scale {
  if (spec.curve === 'log') {
    const lo = Math.log(Math.max(1e-6, spec.min));
    const hi = Math.log(spec.max);
    return {
      toNorm: (v) => (Math.log(Math.max(1e-6, v)) - lo) / (hi - lo),
      fromNorm: (n) => Math.exp(lo + Math.min(1, Math.max(0, n)) * (hi - lo)),
    };
  }
  return {
    toNorm: (v) => (v - spec.min) / (spec.max - spec.min),
    fromNorm: (n) => spec.min + Math.min(1, Math.max(0, n)) * (spec.max - spec.min),
  };
}

/** Build one knob. The element re-renders itself after every commit. */
export function makeKnob(spec: KnobSpec): HTMLElement {
  const node = knobDom(spec);
  const arc = node.querySelector('.dial-arc') as SVGPathElement;
  const pin = node.querySelector('.dial-pin') as SVGLineElement;
  const out = node.querySelector('.knob-val') as HTMLElement;
  const size = KNOB_R * 2 + 8;
  const c = size / 2;
  const { toNorm, fromNorm } = scaleFor(spec);

  const render = (): void => {
    const v = spec.get();
    const n = Math.min(1, Math.max(0, toNorm(v)));
    const ang = ARC_START + n * (ARC_END - ARC_START);
    const zeroN = spec.min < 0 && spec.max > 0 ? toNorm(0) : 0;
    const zeroAng = ARC_START + zeroN * (ARC_END - ARC_START);
    const a0 = Math.min(zeroAng, ang);
    const a1 = Math.max(zeroAng, ang);
    arc.setAttribute('d', Math.abs(a1 - a0) < 0.4 ? '' : arcPath(c, c, KNOB_R, a0, a1));
    pin.setAttribute('transform', `rotate(${ang} ${c} ${c})`);
    out.textContent = spec.fmt ? spec.fmt(v) : v.toFixed(2);
    node.setAttribute('aria-valuenow', String(Math.round(v * 1000) / 1000));
  };

  const commit = (raw: number): void => {
    let v = raw;
    if (spec.step) v = Math.round(v / spec.step) * spec.step;
    v = Math.min(spec.max, Math.max(spec.min, v));
    spec.set(v);
    render();
    spec.onChange?.();
  };

  attachKnobInput(node, spec, { toNorm, fromNorm }, commit);
  render();
  return node;
}

function attachKnobInput(
  node: HTMLElement,
  spec: KnobSpec,
  scale: Scale,
  commit: (v: number) => void,
): void {
  let dragging = false;
  let startY = 0;
  let startN = 0;
  node.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startN = scale.toNorm(spec.get());
    node.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  const stop = (e: PointerEvent): void => {
    dragging = false;
    if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
  };
  node.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // A release the knob never saw (capture lost to a window blur, a release
    // outside the browser, a re-render) would otherwise leave the drag live,
    // and the knob would follow the cursor whenever it hovers back.
    if ((e.buttons & 1) === 0) {
      stop(e);
      return;
    }
    const range = e.shiftKey ? 900 : 190;
    commit(scale.fromNorm(startN - (e.clientY - startY) / range));
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
  node.addEventListener('lostpointercapture', stop);
  node.addEventListener('dblclick', () => commit(spec.def));
  node.addEventListener('keydown', (e) => {
    const stepN = e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      commit(scale.fromNorm(scale.toNorm(spec.get()) + stepN));
      e.preventDefault();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      commit(scale.fromNorm(scale.toNorm(spec.get()) - stepN));
      e.preventDefault();
    }
  });
}
