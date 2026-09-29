// The output stage's cost in Chrome (windsor#93 decision 13). Run as one
// `evaluate_script` in the project's headless Chrome on a page of the Vite
// dev server: `bench(url)` with the worklet's URL (see README.md). It renders the
// same stereo program through an `OfflineAudioContext` straight to the
// destination, through the browser's `DynamicsCompressorNode` set as the old
// safety limiter was, and through the output stage in each mode, and times
// `startRendering()` for each. Offline rendering runs as fast as it can, so
// the time is the whole graph's CPU time on the render thread; the stage's
// cost is its time less the direct render's.
/* global OfflineAudioContext, AudioWorkletNode, performance, navigator */
// eslint-disable-next-line max-lines-per-function -- pasted whole into one evaluate_script call, so it must be self-contained
export async function bench(url) {
  const RATE = 48000;
  const SECONDS = 30;
  const RUNS = 7;
  const frames = RATE * SECONDS;

  // A program-like signal: three tones under a slow envelope, at `peak`.
  const program = (context, peak) => {
    const buffer = context.createBuffer(2, frames, RATE);
    const l = buffer.getChannelData(0);
    const r = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      const t = i / RATE;
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t);
      const a = Math.sin(2 * Math.PI * 110 * t);
      const b = Math.sin(2 * Math.PI * 1234 * t);
      const c = Math.sin(2 * Math.PI * 5003 * t);
      l[i] = peak * env * (0.6 * a + 0.3 * b + 0.1 * c);
      r[i] = peak * env * (0.2 * a + 0.5 * b + 0.3 * c);
    }
    return buffer;
  };

  const MODES = { limiter: 0, soft: 1, hard: 2, off: 3 };
  const render = async (kind, peak) => {
    const context = new OfflineAudioContext(2, frames, RATE);
    await context.audioWorklet.addModule(url);
    const source = context.createBufferSource();
    source.buffer = program(context, peak);
    let last = source;
    if (kind === 'compressor') {
      const c = context.createDynamicsCompressor();
      c.threshold.value = -6;
      c.knee.value = 0;
      c.ratio.value = 20;
      c.attack.value = 0.003;
      c.release.value = 0.15;
      source.connect(c);
      last = c;
    } else if (kind !== 'direct') {
      const [mode, lookahead] = kind.split('+');
      const stage = new AudioWorkletNode(context, 'windsor-output-stage', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        parameterData: { mode: MODES[mode], ceilingDb: -1, lookahead: lookahead ? 1 : 0 },
      });
      source.connect(stage);
      last = stage;
    }
    last.connect(context.destination);
    source.start();
    const start = performance.now();
    const rendered = await context.startRendering();
    const ms = performance.now() - start;
    let max = 0;
    const out = rendered.getChannelData(0);
    for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
    return { ms, max };
  };

  const KINDS = ['direct', 'compressor', 'off', 'limiter', 'limiter+lookahead', 'soft', 'hard'];
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const results = {};
  for (const [level, peak] of [
    ['quiet (-12 dBFS)', 0.25],
    ['hot (+6 dBFS)', 2],
  ]) {
    await render('direct', peak); // warm-up
    const times = Object.fromEntries(KINDS.map((k) => [k, []]));
    const peaks = {};
    // Interleaved, so drift over the run spreads evenly across the kinds.
    for (let run = 0; run < RUNS; run++) {
      for (const kind of KINDS) {
        const r = await render(kind, peak);
        times[kind].push(r.ms);
        peaks[kind] = r.max;
      }
    }
    const base = median(times.direct);
    results[level] = Object.fromEntries(
      KINDS.map((k) => [
        k,
        {
          medianMs: +median(times[k]).toFixed(1),
          msPerAudioSecondOverDirect: +((median(times[k]) - base) / SECONDS).toFixed(3),
          runsMs: times[k].map((x) => +x.toFixed(1)),
          outputPeak: +peaks[k].toFixed(4),
        },
      ]),
    );
  }
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    sampleRate: RATE,
    seconds: SECONDS,
    runs: RUNS,
    results,
  };
}
