// What 16 active part-strip meters cost in Chrome (windsor#155 decision 5).
// Run as one `evaluate_script` in the project's headless Chrome on a page of
// the Vite dev server: `bench(url)` with the peak meter worklet's URL (see
// README.md). It renders 16 part strips' dry paths, as `stripTap.ts` builds
// them (head gain, audible gate, splitter, four rotation gains, merger) into
// a music bus, through an `OfflineAudioContext`, with no meters and with one
// `a204-peak-meter` on each strip's rotation output, wired as
// `createPeakMeter` wires it (a silent sink to the destination). Offline
// rendering runs as fast as it can, so the time is the whole graph's CPU time
// on the render thread; the meters' cost is the metered time less the bare.
/* global OfflineAudioContext, AudioWorkletNode, performance, navigator, setTimeout */
// eslint-disable-next-line max-lines-per-function -- pasted whole into one evaluate_script call, so it must be self-contained
export async function bench(url) {
  const RATE = 48000;
  const SECONDS = 30;
  const RUNS = 7;
  const PARTS = 16;
  const frames = RATE * SECONDS;

  // A program-like signal per part: three tones under a slow envelope.
  const program = (context, part) => {
    const buffer = context.createBuffer(2, frames, RATE);
    const l = buffer.getChannelData(0);
    const r = buffer.getChannelData(1);
    const root = 55 * (1 + part / 4);
    for (let i = 0; i < frames; i++) {
      const t = i / RATE;
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t + part);
      const a = Math.sin(2 * Math.PI * root * t);
      const b = Math.sin(2 * Math.PI * root * 3.01 * t);
      l[i] = 0.1 * env * (0.7 * a + 0.3 * b);
      r[i] = 0.1 * env * (0.4 * a + 0.6 * b);
    }
    return buffer;
  };

  const strip = (context, source, bus, pan) => {
    const head = context.createGain();
    const gate = context.createGain();
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const theta = (pan * Math.PI) / 4;
    const [c, s] = [Math.cos(theta), Math.sin(theta)];
    const matrix = [
      [0, 0, c],
      [1, 0, -s],
      [0, 1, s],
      [1, 1, c],
    ];
    source.connect(head);
    head.connect(gate);
    gate.connect(split);
    for (const [from, to, value] of matrix) {
      const g = context.createGain();
      g.gain.value = value;
      split.connect(g, from);
      g.connect(merge, 0, to);
    }
    merge.connect(bus);
    return merge;
  };

  const meter = (context, tap, counts) => {
    const node = new AudioWorkletNode(context, 'a204-peak-meter', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    node.port.onmessage = () => counts.reports++;
    const sink = context.createGain();
    sink.gain.value = 0;
    tap.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
  };

  const buffers = new Map();
  const render = async (metered) => {
    const context = new OfflineAudioContext(2, frames, RATE);
    await context.audioWorklet.addModule(url);
    const bus = context.createGain();
    bus.connect(context.destination);
    const counts = { reports: 0 };
    for (let p = 0; p < PARTS; p++) {
      if (!buffers.has(p)) buffers.set(p, program(context, p));
      const source = context.createBufferSource();
      source.buffer = buffers.get(p);
      const tap = strip(context, source, bus, (p / (PARTS - 1)) * 2 - 1);
      if (metered) meter(context, tap, counts);
      source.start();
    }
    const start = performance.now();
    await context.startRendering();
    const ms = performance.now() - start;
    // Let the queued port messages land before counting them.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { ms, reports: counts.reports };
  };

  const KINDS = { none: false, sixteenMeters: true };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  await render(false); // warm-up
  const times = { none: [], sixteenMeters: [] };
  const reports = {};
  // Interleaved, so drift over the run spreads evenly across the kinds.
  for (let run = 0; run < RUNS; run++) {
    for (const [kind, metered] of Object.entries(KINDS)) {
      const r = await render(metered);
      times[kind].push(r.ms);
      reports[kind] = r.reports;
    }
  }
  const base = median(times.none);
  const results = Object.fromEntries(
    Object.keys(KINDS).map((k) => [
      k,
      {
        medianMs: +median(times[k]).toFixed(1),
        msPerAudioSecondOverNone: +((median(times[k]) - base) / SECONDS).toFixed(3),
        runsMs: times[k].map((x) => +x.toFixed(1)),
        reportsInLastRun: reports[k],
      },
    ]),
  );
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    sampleRate: RATE,
    seconds: SECONDS,
    runs: RUNS,
    parts: PARTS,
    results,
  };
}
