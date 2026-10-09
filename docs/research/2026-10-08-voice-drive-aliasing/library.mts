// How hard the library's driven patches push the shaper: each patch with its
// drive on, rendered at note 60, velocity 1, with the drive and the filter
// off and pan, spread and random pan at 0, so the left channel over the pan
// gain is the drive's input. Its peak times the gain plus the bias is the
// shaper's peak operand (soft bends from about 1 and saturates at 3).
// Usage: npx tsx docs/research/2026-10-08-voice-drive-aliasing/library.mts
import { loadProcessor, render } from '../../../packages/engine/src/__fixtures__/workletHarness.ts';
import { driveOnByDefault, DRIVE_SHAPE_NAMES, FILTER_MODE } from '../../../packages/engine/src/patch/patch.ts';
import { PRESETS } from '../../../packages/engine/src/patch/presets.ts';

const loaded = loadProcessor();
const PAN_L = Math.SQRT1_2;
const rows: { id: string; shape: string; gain: number; bias: number; operand: number; filter: number }[] = [];
for (const [id, preset] of Object.entries(PRESETS)) {
  const d = preset.drive;
  const on = d.on ?? driveOnByDefault(d.gain, d.bias);
  if (!on || (d.gain === 1 && d.bias === 0)) continue;
  const p = structuredClone(preset);
  p.drive = { ...p.drive, on: false };
  const filterMode = p.filter.mode;
  p.filter = { ...p.filter, mode: FILTER_MODE.OFF };
  Object.assign(p, { pan: 0, panRandom: 0, spread: 0, panKey: 0 });
  const out = render(loaded, loaded.create(p, 8), Math.ceil(48000 / 128), [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]).samples;
  let peak = 0;
  for (let i = 0; i < out.length; i += 2) peak = Math.max(peak, Math.abs(out[i]));
  const sig = peak / PAN_L;
  rows.push({ id, shape: DRIVE_SHAPE_NAMES[d.shape], gain: d.gain, bias: d.bias, operand: d.gain * sig + Math.abs(d.bias), filter: filterMode });
}
rows.sort((a, b) => b.operand - a.operand);
console.log('patch'.padEnd(22), 'shape', ' gain', ' bias', 'peak operand', 'filter');
for (const r of rows) console.log(r.id.padEnd(22), r.shape.padEnd(5), r.gain.toFixed(2).padStart(5), r.bias.toFixed(2).padStart(5), r.operand.toFixed(2).padStart(12), String(r.filter).padStart(6));
