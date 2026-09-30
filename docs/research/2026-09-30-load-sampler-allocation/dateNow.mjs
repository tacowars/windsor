/* global process, console, gc */
/**
 * Whether V8 can read `Date.now()` without a heap number (windsor#214), run
 * from the repository root:
 *
 *   node --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 \
 *     docs/research/2026-09-30-load-sampler-allocation/dateNow.mjs
 *
 * Each loop runs 2 000 000 times to warm up, so it is optimised, then 100 000
 * times between two heap readings with nothing collected, and prints the
 * growth per iteration. Every loop stores its result straight into a
 * preallocated Float64Array, the form the issue proposed. Add
 * `--turbo-filter=twoReadings --trace-turbo-graph` to see the reading lowered
 * to a call of the runtime's `DateCurrentTime`.
 */
import v8 from 'node:v8';

const slot = new Float64Array(4);
const date = new Date();
const N = 100000;
const WARM = 2000;

const LOOPS = {
  nothing(n) {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + i) | 0;
    slot[0] = s;
  },
  oneReading(n) {
    for (let i = 0; i < n; i++) slot[0] = Date.now();
  },
  twoReadings(n) {
    for (let i = 0; i < n; i++) {
      const start = Date.now();
      slot[1] += Date.now() - start;
    }
  },
  storedDate(n) {
    for (let i = 0; i < n; i++) slot[2] = date.getTime();
  },
  mathRandom(n) {
    for (let i = 0; i < n; i++) slot[3] += Math.random();
  },
};

for (const [name, loop] of Object.entries(LOOPS)) {
  for (let k = 0; k < WARM; k++) loop(1000);
  gc();
  gc();
  v8.getHeapStatistics();
  const before = v8.getHeapStatistics().used_heap_size;
  loop(N);
  const after = v8.getHeapStatistics().used_heap_size;
  console.log(name.padEnd(12), ((after - before) / N).toFixed(2), 'bytes per iteration');
}
console.log(process.version, 'V8', process.versions.v8);
