// The windsor#343 probe: what idle and ramping k-rate automation parameters on
// the FM part worklet cost, and what scheduling them costs the main thread.
//
// It needs the throwaway processors `fm-part-p29` (29 extra k-rate params,
// `target0`…`target28`) and `fm-part-p8` (8, `slot0`…`slot7`), which the
// probe branch registers beside `fm-part` in `worklet/fm/fmProcessor.ts`
// (`probe-processors.patch`) and bundles with `node scripts/build-worklets.mjs`.
// Nothing here is shipped code.
//
// Run on a page of the Vite dev server, as a module imported from an
// `evaluate_script` call:
//   const p = await import('/@fs/<worktree>/docs/research/2026-10-01-automation-param-cost/probe.js');
//   p.install();                    // once per page, before audio is enabled
//   p.setCase('c');                 // a | b | c | d
//   await p.offline(engineUrl, songUrl, runs);
//   await p.online(seconds);        // with the app playing
//   await p.schedulingOnly(variant, seconds);
//
// `install` swaps `window.AudioWorkletNode` for a subclass that builds the
// case's processor wherever the engine asks for `fm-part`, and keeps every
// node's port so the probe reads the same load reports the app's meter
// (`cost/audioLoad.ts`) reads.
/* global window, document, performance, fetch, OfflineAudioContext, DataTransfer, File, Event, setInterval, clearInterval, setTimeout, navigator */

const BPM = 124;
const PPQ = 24;
const TICK_SECONDS = 60 / BPM / PPQ;
/** `SCHEDULER_LOOK_AHEAD_SECONDS`, the live scheduler's horizon. */
const LIVE_LOOK_AHEAD = 0.12;
/** `RENDER_LOOK_AHEAD_SECONDS`, the offline render's horizon at each stop. */
const RENDER_LOOK_AHEAD = 0.5;
/** `HOST_PUMP_INTERVAL_MS`, the app's pump. */
const PUMP_MS = 25;
/** `FM_LANES_MAX`. */
const LANES = 8;
/** `AUDIO_LOAD_STALE_MS`. */
const STALE_MS = 3000;
const RESOLUTION_MS = 1;

const names = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const CASES = {
  a: { processor: 'fm-part', lanes: [] },
  b: { processor: 'fm-part-p29', lanes: names('target', 29) },
  c: { processor: 'fm-part-p8', lanes: names('slot', LANES) },
  d: { processor: 'fm-part-p8', lanes: names('slot', LANES), ramp: 'bent' },
};

export const state = {
  case: 'a',
  /** The FM nodes built under the current case: { context, params, next, origin }. */
  parts: [],
  /** Every worklet port, with its latest load report. */
  reports: new Map(),
  sched: { ms: 0, calls: 0, pumps: 0, maxPumpMs: 0 },
};

export function setCase(name) {
  state.case = name;
  state.parts = [];
  resetSched();
}

function resetSched() {
  state.sched = { ms: 0, calls: 0, pumps: 0, maxPumpMs: 0 };
}

// One lane's points: a value a beat (24 ticks), pseudo-random but fixed, with
// a bend per segment. The lane's value at a tick is the segment's straight
// line ('points', 'tick') or its bent curve ('bent').
const pointValue = (lane, beat) => Math.sin(beat * 1.7 + lane * 0.9) * 0.5;
const bendOf = (lane, beat) => Math.sin(beat * 0.37 + lane * 1.3);
function laneValue(variant, lane, tick) {
  const beat = Math.floor(tick / PPQ);
  const from = pointValue(lane, beat);
  const to = pointValue(lane, beat + 1);
  let t = (tick - beat * PPQ) / PPQ;
  // A bend in -1..1 as an exponent 2^(3·bend): 0 is the straight line.
  if (variant === 'bent') t = Math.pow(t, Math.pow(2, 3 * bendOf(lane, beat)));
  return from + (to - from) * t;
}

/**
 * Write each lane's ramps from its last scheduled tick up to `horizon`, as
 * the automation player would: 'points' writes one ramp per lane at each
 * point (a beat apart), 'tick' and 'bent' one per lane per tick.
 */
function pump(variant, horizon) {
  const start = performance.now();
  let calls = 0;
  for (const part of state.parts) {
    if (part.params.length === 0) continue;
    for (;;) {
      const time = part.origin + part.next * TICK_SECONDS;
      if (time > horizon) break;
      const tick = part.next++;
      if (variant === 'points' && tick % PPQ !== 0) continue;
      for (let lane = 0; lane < part.params.length; lane++) {
        part.params[lane].linearRampToValueAtTime(laneValue(variant, lane, tick), time);
        calls++;
      }
    }
  }
  const ms = performance.now() - start;
  const s = state.sched;
  s.ms += ms;
  s.calls += calls;
  s.pumps++;
  if (ms > s.maxPumpMs) s.maxPumpMs = ms;
}

function offlinePump(context) {
  const variant = CASES[state.case].ramp;
  if (!variant) return;
  const mine = state.parts.filter((p) => p.context === context);
  const saved = state.parts;
  state.parts = mine;
  pump(variant, context.currentTime + RENDER_LOOK_AHEAD);
  state.parts = saved;
}

export function install() {
  if (window.__automationProbe) return 'already installed';
  window.__automationProbe = true;
  const Original = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Original {
    constructor(context, name, options) {
      const fm = name === 'fm-part';
      const spec = CASES[state.case];
      super(context, fm ? spec.processor : name, options);
      const entry = { report: null, at: 0, sampleRate: context.sampleRate };
      state.reports.set(this.port, entry);
      this.port.addEventListener('message', (event) => {
        if (event.data?.type === 'load') {
          entry.report = event.data;
          entry.at = performance.now();
        }
      });
      if (!fm) return;
      const params = spec.lanes.map((lane) => this.parameters.get(lane));
      if (params.some((p) => !p)) throw new Error(`${spec.processor} lacks a probe parameter`);
      const live = !(context instanceof OfflineAudioContext);
      // A live lane starts a little ahead of now; an offline one at frame 0.
      const origin = live ? context.currentTime + 0.05 : 0;
      state.parts.push({ context, params, next: 0, origin });
      if (!live) offlinePump(context);
    }
  };
  // The render stops every RENDER_STEP_SECONDS and pumps; the lanes pump at
  // the same stop, before the render's own callback runs.
  const suspend = OfflineAudioContext.prototype.suspend;
  OfflineAudioContext.prototype.suspend = function (when) {
    return suspend.call(this, when).then(() => offlinePump(this));
  };
  return 'installed';
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 2) => +x.toFixed(d);

/** The meter's `readout()`, over the reports this probe saw. */
function readout() {
  const cutoff = performance.now() - STALE_MS;
  let busy = 0;
  let wall = 0;
  let peak = 0;
  let underruns = 0;
  let processors = 0;
  for (const { report, at, sampleRate } of state.reports.values()) {
    if (!report) continue;
    underruns += report.underruns;
    if (at < cutoff) continue;
    processors++;
    busy += report.busyMs;
    if (report.wallMs > wall) wall = report.wallMs;
    const budget = (128 / sampleRate) * 1000;
    const pct = (Math.max(0, report.peakMs - RESOLUTION_MS) / budget) * 100;
    if (pct > peak) peak = pct;
  }
  return { loadPct: wall > 0 ? (busy / wall) * 100 : 0, peakPct: peak, underruns, processors };
}

/**
 * Read the load once a second for `seconds` while the app plays, with case
 * d's lanes ramping from the probe's own pump (the app's 25 ms cadence).
 */
export async function online(seconds) {
  const variant = CASES[state.case].ramp;
  const context = state.parts[0]?.context;
  // The lanes start now, not when the nodes were built.
  if (variant) restartLanes(context);
  resetSched();
  const timer = variant
    ? setInterval(() => pump(variant, context.currentTime + LIVE_LOOK_AHEAD), PUMP_MS)
    : null;
  const before = readout().underruns;
  const clock0 = context.currentTime;
  const wall0 = performance.now();
  const series = [];
  for (let i = 0; i < seconds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    series.push(readout());
  }
  if (timer) clearInterval(timer);
  // Below 1, the audio clock fell behind the wall clock: the render did not
  // keep up, and the load reading is no longer a fraction of a real-time budget.
  const clockRate = (context.currentTime - clock0) / ((performance.now() - wall0) / 1000);
  const load = series.map((r) => r.loadPct);
  return {
    case: state.case,
    clockRate: round(clockRate, 3),
    fmNodes: state.parts.length,
    processors: series.at(-1).processors,
    loadMedian: round(median(load)),
    loadMin: round(Math.min(...load)),
    loadMax: round(Math.max(...load)),
    peakMax: round(Math.max(...series.map((r) => r.peakPct))),
    underrunsAdded: series.at(-1).underruns - before,
    sched: schedSummary(seconds),
  };
}

function schedSummary(seconds) {
  const s = state.sched;
  return {
    calls: s.calls,
    pumps: s.pumps,
    msTotal: round(s.ms, 1),
    msPerSongSecond: round(s.ms / seconds, 3),
    callsPerSongSecond: round(s.calls / seconds, 0),
    usPerCall: s.calls ? round((s.ms * 1000) / s.calls, 3) : 0,
    maxPumpMs: round(s.maxPumpMs, 2),
  };
}

function restartLanes(context) {
  for (const part of state.parts) {
    for (const p of part.params) p.cancelScheduledValues(0);
    part.next = 0;
    part.origin = context.currentTime + 0.05;
  }
}

/**
 * The scheduling side alone: pump `variant` on the live nodes for `seconds`
 * at the app's cadence and horizon, and time it on the main thread.
 */
export async function schedulingOnly(variant, seconds) {
  const context = state.parts[0].context;
  restartLanes(context);
  resetSched();
  const timer = setInterval(() => pump(variant, context.currentTime + LIVE_LOOK_AHEAD), PUMP_MS);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearInterval(timer);
  // A seek: cancel everything ahead on every lane and refill the horizon.
  const t0 = performance.now();
  for (const part of state.parts) {
    for (const p of part.params) p.cancelScheduledValues(context.currentTime);
    part.origin = context.currentTime;
    part.next = 1;
  }
  const cancelMs = performance.now() - t0;
  const before = state.sched.ms;
  pump(variant, context.currentTime + LIVE_LOOK_AHEAD);
  return {
    variant,
    seconds,
    ...schedSummary(seconds),
    seekCancelMs: round(cancelMs, 2),
    seekRefillMs: round(state.sched.ms - before, 2),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One live run on a freshly loaded page: install, pick the case, take the
 * song (accept the "Restore" prompt, or import `songUrl` when there is none),
 * enable audio, play, warm up, then read `online(seconds)` and, with
 * `variants`, time `schedulingOnly` for each. The result lands on
 * `window.__run` (an `evaluate_script` call times out before a run ends).
 */
export function appRun(caseName, songUrl, { warm = 5, seconds = 20, variants = [], schedSeconds = 10 } = {}) {
  window.__run = null;
  const job = async () => {
    install();
    setCase(caseName);
    for (let i = 0; i < 30 && !document.getElementById('confirmDlg')?.open; i++) await sleep(100);
    const dialog = document.getElementById('confirmDlg');
    if (dialog?.open) {
      document.getElementById('confirmOk').click();
    } else {
      document.querySelector('[data-tab="arrangement"]').click();
      await sleep(200);
      const text = await (await fetch(songUrl)).text();
      const input = document.querySelector('input[name="import-file"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'sixteen-pads.json', { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(1500);
    document.getElementById('power').click();
    for (let i = 0; i < 50 && state.parts.length < 16; i++) await sleep(100);
    if (state.parts.length !== 16) throw new Error(`${state.parts.length} FM parts, not 16`);
    await sleep(500);
    document.querySelector('button[aria-label^="Play"]').click();
    await sleep(warm * 1000);
    const context = state.parts[0].context;
    const result = {
      contextState: context.state,
      sampleRate: context.sampleRate,
      baseLatency: context.baseLatency,
      outputLatency: context.outputLatency,
      online: await online(seconds),
      scheduling: [],
    };
    document.querySelector('button[aria-label^="Stop"]').click();
    for (const variant of variants) result.scheduling.push(await schedulingOnly(variant, schedSeconds));
    return result;
  };
  job().then(
    (r) => (window.__run = r),
    (e) => (window.__run = { error: String(e?.stack ?? e) }),
  );
  return 'started';
}

/** Render the song offline under each case, interleaved, `runs` times after a warm-up. */
export async function offline(engineUrl, songUrl, runs, cases = 'abcd') {
  const engine = await import(engineUrl);
  const raw = await (await fetch(songUrl)).json();
  const { document } = engine.makeArrangement(raw);
  const render = async (name) => {
    setCase(name);
    const start = performance.now();
    const song = await engine.renderSong(document, { sampleRate: 48000 });
    const ms = performance.now() - start;
    let peak = 0;
    for (const ch of song.channels) for (let i = 0; i < ch.length; i += 7) peak = Math.max(peak, Math.abs(ch[i]));
    return { ms, songSeconds: song.songSeconds, peak, sched: { ...state.sched } };
  };
  await render('a');
  const times = Object.fromEntries([...cases].map((c) => [c, []]));
  const sched = {};
  let songSeconds = 0;
  let peaks = {};
  for (let run = 0; run < runs; run++) {
    for (const c of cases) {
      const r = await render(c);
      times[c].push(r.ms);
      sched[c] = r.sched;
      songSeconds = r.songSeconds;
      peaks[c] = round(r.peak, 4);
    }
  }
  return {
    userAgent: navigator.userAgent,
    runs,
    songSeconds: round(songSeconds, 3),
    peaks,
    results: Object.fromEntries(
      [...cases].map((c) => [
        c,
        {
          medianMs: round(median(times[c]), 1),
          minMs: round(Math.min(...times[c]), 1),
          maxMs: round(Math.max(...times[c]), 1),
          runsMs: times[c].map((x) => round(x, 1)),
          lastSched: { calls: sched[c].calls, ms: round(sched[c].ms, 1) },
        },
      ]),
    ),
  };
}
