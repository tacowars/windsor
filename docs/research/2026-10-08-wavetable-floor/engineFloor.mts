// The shipped engine's oscillator floor, every semitone C0..C8, through the
// worklet harness: run it in two checkouts to compare them.
// Usage: npx tsx docs/research/2026-10-08-wavetable-floor/engineFloor.mts <checkout root>
const root = process.argv[2] ?? '.';
const { loadProcessor, render } = await import(`${root}/packages/engine/src/__fixtures__/workletHarness.ts`);
const { FILTER_MODE, makePatch, WAVE } = await import(`${root}/packages/engine/src/patch/patch.ts`);
const { N, read } = await import('../2026-10-08-voice-drive-aliasing/spectrum.mts');

const loaded = loadProcessor();
const env = { attackTime: 0.001, decayTime: 0.001, sustainLevel: 1 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WAVES: [string, number, number][] = [
  ['saw', WAVE.SAW, 1],
  ['square', WAVE.SQUARE, 1],
  ['pulse 0.3', WAVE.PULSE, 0.3],
];
for (const [label, wave, width] of WAVES) {
  const worst = new Array<number>(8).fill(-Infinity);
  const at = new Array<string>(8).fill('');
  for (let n = 12; n <= 107; n++) {
    const f = 440 * 2 ** ((n - 69) / 12);
    const p = makePatch({
      algorithm: 0, volume: 0.5, tone: 1, spread: 0, panRandom: 0, filter: { mode: FILTER_MODE.OFF },
      ops: [{ wave, width, fixed: true, fixedHz: f, level: 1, env }, { level: 0, env }, { level: 0, env }, { level: 0, env }],
    });
    const out: Float32Array = render(loaded, loaded.create(p, 4), Math.ceil((12000 + N) / 128), [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]).samples;
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) x[i] = out[(12000 + i) * 2];
    const r = read(x, 0, f).asrA;
    const o = Math.floor(n / 12) - 1;
    if (r > worst[o]) {
      worst[o] = r;
      at[o] = NAMES[n % 12] + String(o);
    }
  }
  console.log(`${label.padEnd(10)} worst A-weighted floor by octave: ` + worst.map((w, o) => `${at[o]} ${w.toFixed(1)}`).join(' | '));
}
