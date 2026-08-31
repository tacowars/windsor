/** The output scope: draws the analyser tap on the engine master (#70). */

export function startScope(canvas: HTMLCanvasElement, analyser: () => AnalyserNode | null): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const dpr = window.devicePixelRatio || 1;
  let buffer: Float32Array<ArrayBuffer> | null = null;

  const tick = (): void => {
    if (!canvas.isConnected) return;
    requestAnimationFrame(tick);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2C3439';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();

    const node = analyser();
    if (!node) return;
    if (!buffer || buffer.length !== node.fftSize) buffer = new Float32Array(node.fftSize);
    node.getFloatTimeDomainData(buffer);

    // Trigger on a rising zero crossing so the trace holds still.
    let start = 0;
    const half = buffer.length >> 1;
    for (let i = 1; i < half; i++) {
      if ((buffer[i - 1] ?? 0) <= 0 && (buffer[i] ?? 0) > 0) {
        start = i;
        break;
      }
    }
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i] ?? 0));

    g.strokeStyle = peak > 0.99 ? '#D2643C' : '#E0A44E';
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i < half; i++) {
      const v = buffer[start + i] ?? 0;
      const x = (i / half) * w;
      const y = h / 2 - v * (h / 2 - 2);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  tick();
}
