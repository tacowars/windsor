/* global console */
// How much the Build taps colour the tank's feed (windsor#761). Each side's
// tap sum is an FIR, H(f) = Σ g e^(−j2πft); the two sides reach the output
// through the tank, which decorrelates them, so the feed's steady-state
// energy response is (|H_L|² + |H_R|²) / 2. Printed against Build: its
// spread in dB over 100 Hz to 4 kHz (raw, on a 1/48-octave grid, which a
// held note hears), and in third-octave bands (which noise and chords hear).
// node colour.mjs  (reads the shipped tables from the worklet's source)
import {
  BUILD_GAIN_ROWS,
  BUILD_STRETCH_MIN,
  BUILD_TAP_TIME,
  BUILD_TAPS_PER_SIDE,
} from '../../../packages/engine/src/worklet/reverb/reverbBuildTables.ts';

const freqs = [];
for (let k = 0; k <= 48 * Math.log2(40); k++) freqs.push(100 * 2 ** (k / 48));

function response(build) {
  const stretch = BUILD_STRETCH_MIN + (1 - BUILD_STRETCH_MIN) * build;
  const position = build * (BUILD_GAIN_ROWS.length - 1);
  const lower = Math.min(Math.floor(position), BUILD_GAIN_ROWS.length - 2);
  const along = position - lower;
  const gain = BUILD_GAIN_ROWS[lower].map(
    (g, t) => g + (BUILD_GAIN_ROWS[lower + 1][t] - g) * along,
  );
  return freqs.map((f) => {
    let energy = 0;
    for (const side of [0, 1]) {
      let re = 0;
      let im = 0;
      for (let t = side * BUILD_TAPS_PER_SIDE; t < (side + 1) * BUILD_TAPS_PER_SIDE; t++) {
        const phase = 2 * Math.PI * f * BUILD_TAP_TIME[t] * stretch;
        re += gain[t] * Math.cos(phase);
        im -= gain[t] * Math.sin(phase);
      }
      energy += (re * re + im * im) / 2;
    }
    return energy;
  });
}

const dB = (x) => 10 * Math.log10(x);
console.log('build\traw min dB\traw max dB\traw sd dB\t1/3-oct min dB\t1/3-oct max dB');
for (let b = 0; b <= 10; b++) {
  const e = response(b / 10);
  const raw = e.map(dB);
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  const sd = Math.sqrt(raw.reduce((s, v) => s + (v - mean) ** 2, 0) / raw.length);
  // Third-octave bands: 16 grid points a band, averaged in energy.
  const bands = [];
  for (let i = 0; i + 16 <= e.length; i += 16) bands.push(dB(e.slice(i, i + 16).reduce((s, v) => s + v, 0) / 16));
  console.log(
    [b / 10, Math.min(...raw), Math.max(...raw), sd, Math.min(...bands), Math.max(...bands)]
      .map((v, i) => (i === 0 ? v : v.toFixed(1)))
      .join('\t'),
  );
}
