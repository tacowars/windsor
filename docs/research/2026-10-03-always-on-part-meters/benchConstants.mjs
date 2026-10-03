/** windsor#533: every value the always-on part meter bench runs with. */
export const BENCH = {
  /** The meter counts the issue names; 0 is the baseline every delta is taken against. */
  counts: [0, 1, 8, 16],
  /** Parts in the song and sources in the isolated graph, all 16 at every count. */
  parts: 16,
  /** 16 separate shipped meter nodes, or one research node with 16 inputs. */
  variants: ['separate', 'multi'],
  cases: ['song', 'isolated'],
  /** Rounds per invocation; every configuration runs once a round, in a rotated order. */
  rounds: 3,
  /** Seconds of playback before the trace starts. */
  warmupSeconds: 3,
  /**
   * The audio pass: one page per case and variant, traced while the meter count steps
   * through these blocks, each N once a block and in a different place in each, one
   * segment of `seconds` per step. A segment's first `guardSeconds` (nodes being built
   * and torn down) are left out. The song loops, so the pass may outlast it.
   */
  segments: {
    seconds: 2,
    guardSeconds: 0.25,
    blocks: [
      [0, 1, 8, 16],
      [8, 16, 0, 1],
      [1, 0, 16, 8],
    ],
  },
  /** The main-thread pass: one page per case, variant and count, traced for this long. */
  traceSeconds: 8,
  /** The main-thread pass runs only at these counts (decision 5 asks for 16). */
  mainCounts: [0, 16],
  /** The isolated graph's sources sum through one gain, so the mix stays below full scale. */
  sourceGain: 1 / 16,
  /** #211's offline method on the isolated graph, as a cross-check of the real-time mean. */
  offline: { sampleRate: 48000, seconds: 20, repeats: 3 },
  /** A harness check, not a measurement: `--quick`. */
  quick: { rounds: 1, warmupSeconds: 1, segmentSeconds: 1, traceSeconds: 2, offlineRepeats: 1 },
  quantumFrames: 128,
  percentile: 0.95,
  /**
   * Trace categories. The audio pass records only `webaudio`'s per-quantum
   * render span, the GC events and the page's segment marks: categories that
   * mark every `process` call (`v8`, `devtools.timeline`) would charge their
   * own cost once per node, and so grow with N. The main-thread pass needs
   * `devtools.timeline`'s handler calls and reads nothing from the audio thread.
   */
  categories: {
    audio: ['webaudio', 'disabled-by-default-v8.gc', 'blink.user_timing', '__metadata'],
    main: ['toplevel', 'devtools.timeline', 'disabled-by-default-v8.gc', '__metadata'],
  },
  /** The page is ready when `window.bench` exists; polled this often, at most this long. */
  readyPollMs: 100,
  readyTimeoutMs: 30000,
  /** #343's 16-part song: 16 `pad-drift` parts at spread 0, which plays in real time here. */
  song: '../2026-10-01-automation-param-cost/sixteen-pads-light.json',
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};

/** The research multi-input meter's processor name and report layout. */
export const MULTI_METER = {
  name: 'research-multi-peak-meter',
  /** left, right, holdLeft, holdRight, overload (0 or 1), per part. */
  fields: 5,
};
