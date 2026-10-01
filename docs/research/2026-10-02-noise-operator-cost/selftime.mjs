/* global process */
/**
 * Self time per function in a V8 `.cpuprofile`, the top eight, as a share of
 * the sampled time (windsor#382). Research only.
 *
 *   node --cpu-prof --cpu-prof-dir=<dir> bench.mjs <repo> base=<bundle> --only noise380 --generic 0 --rounds 10
 *   node selftime.mjs <dir>/*.cpuprofile
 */
import { readFileSync } from 'node:fs';

const TOP = 8;
const prof = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
prof.samples.forEach((id, k) => {
  const name = byId.get(id).callFrame.functionName || '(anonymous)';
  const dt = prof.timeDeltas[k] || 0;
  self.set(name, (self.get(name) || 0) + dt);
  total += dt;
});
for (const [name, t] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
  process.stdout.write(`${((100 * t) / total).toFixed(1).padStart(5)} %  ${name}\n`);
}
