/* global console, process */
/**
 * What sequencer lanes (windsor#488) cost the scheduler, under Node.
 * Research only.
 *
 *   node docs/research/2026-10-03-seq-lane-scheduler-cost/bench.mjs <song.json> <none|lanes> [runs]
 *
 * Run from the repo root. It bundles the real `ArrangementPlayer` from
 * `packages/engine/src` (or from `AUDIO_DIR`, another checkout's engine
 * source, for a baseline) with `packages/app/lib/audioBundle.mjs`, plays the
 * whole song into recording parts (the songsmith `events.mjs` rig) and
 * times only the transport's advance over every tick: the region gates, the
 * lane reads and the generators, no audio graph. Eight warm-up runs, then
 * the median and quartiles over `runs` runs, each on a fresh player.
 *
 * `lanes` adds, before normalising, every sequencer lane each pitched part's
 * kind offers (`SEQ_AUTOMATION_FIELDS`), each a bent ramp over the whole
 * song, so every onset reads a moving value.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { audioBundleOptions } from '../../../packages/app/lib/audioBundle.mjs';

const { build } = createRequire(import.meta.url)('esbuild');
const WARM_RUNS = 8;
const RAMPS = { gate: [0.3, 0.9], skipChance: [0, 0.3], density: [1, 0.6] };
const BEND = 0.3;

const dir = process.env.AUDIO_DIR;
const exportsSource = `
  export { ArrangementPlayer } from './song/arrangementPlayer';
  export { TickTransport } from './sequencing/scheduler';
  export { recordingPart } from './__fixtures__/recordingPart';
  export { songTicks } from './sequencing/meter';
  export { makeArrangement } from './song/arrangementDocument';`;
const cacheName = dir ? 'seq-lane-bench-base' : 'seq-lane-bench';
const options = dir
  ? audioBundleOptions(exportsSource, cacheName, dir)
  : audioBundleOptions(exportsSource, cacheName);
await build(options);
const E = await import(pathToFileURL(options.outfile).href);

const [file, mode = 'none', runsArg = '60'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, 'utf8'));
const rawTicks = E.songTicks(raw.transport.bars, raw.transport.meter);
const offered = { figure: ['gate', 'skipChance'], grid: ['skipChance'], arp: ['gate', 'skipChance'], bass: ['gate', 'density'] };
if (mode === 'lanes') {
  for (const part of raw.parts) {
    const fields = offered[part.sequencer?.kind] ?? [];
    const lanes = fields.map((field) => ({
      target: `seq.${field}`,
      on: true,
      points: [
        { tick: 0, value: RAMPS[field][0], bend: BEND },
        { tick: rawTicks, value: RAMPS[field][1], bend: 0 },
      ],
    }));
    if (lanes.length > 0) part.automation = [...(part.automation ?? []), ...lanes];
  }
}
const doc = E.makeArrangement(raw).document;
const seqLanes = doc.parts.flatMap((p) => p.automation ?? []).filter((l) => l.target.startsWith('seq.'));
const ticks = E.songTicks(doc.transport.bars, doc.transport.meter);
const runs = Number(runsArg);
const times = [];
let notes = 0;
for (let r = 0; r < WARM_RUNS + runs; r++) {
  const transport = new E.TickTransport(doc.transport.bpm);
  const parts = new Map(doc.parts.map((p) => [p.slot, E.recordingPart()]));
  new E.ArrangementPlayer(transport, parts, doc, doc.patches);
  const start = process.hrtime.bigint();
  for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  const end = process.hrtime.bigint();
  if (r >= WARM_RUNS) times.push(Number(end - start) / 1e6);
  if (r === 0) {
    for (const part of parts.values()) {
      notes += part.calls.filter((c) => c.kind === 'noteOn' || c.kind === 'trigger').length;
    }
  }
}
times.sort((a, b) => a - b);
const at = (q) => times[Math.floor(q * (times.length - 1))].toFixed(2);
console.log(
  JSON.stringify({
    song: doc.meta?.name,
    parts: doc.parts.length,
    ticks,
    mode,
    seqLanes: seqLanes.length,
    notes,
    runs,
    medianMs: at(0.5),
    p25: at(0.25),
    p75: at(0.75),
  }),
);
