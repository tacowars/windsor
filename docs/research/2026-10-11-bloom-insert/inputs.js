// Inputs for the bundle bench (page and Node alike). `sines48`: one sine at each band centre, F2..E6
// (the worst case: every band can sound). `chord4`: A3, C#4, E4, A4 (a typical chord). Peak -6 dBFS.
const CHORD = [57, 61, 64, 69];
export function makeInput(cell, rate, seconds) {
  const notes = cell === 'chord4' ? CHORD : Array.from({ length: 48 }, (_, i) => 41 + i);
  const n = Math.round(rate * seconds), x = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < notes.length; k++) {
      const f = 440 * 2 ** ((notes[k] - 69) / 12);
      s += Math.sin(2 * Math.PI * f * (i / rate) + 2.399963 * k * k); // spread phases (golden angle)
    }
    x[i] = s; peak = Math.max(peak, Math.abs(s));
  }
  for (let i = 0; i < n; i++) x[i] *= 0.5 / peak;
  return x;
}
