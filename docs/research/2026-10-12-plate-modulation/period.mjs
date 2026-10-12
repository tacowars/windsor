/* global console */
// How long each point's draws last at 8 Hz before they come round.
import { readFileSync } from 'node:fs';
import { BUNDLES } from './rig.mjs';
const src = readFileSync(BUNDLES.new, 'utf8');
class Base { constructor() { this.port = { postMessage() {}, onmessage: null }; } }
const t = new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', src + '\nreturn { MOD_DRAWS, MOD_DRAW_LENGTH, MOD_WIDTH_MIN, MOD_LINES };')(Base, 48000, () => {});
for (let p = 0; p < t.MOD_LINES.length; p++) {
  let w = 0;
  for (let i = 1; i < t.MOD_DRAW_LENGTH; i += 2) w += t.MOD_WIDTH_MIN + t.MOD_DRAWS[p * t.MOD_DRAW_LENGTH + i];
  console.log(`point ${p} (line ${t.MOD_LINES[p]}): ${(w / 16).toFixed(1)} s at 8 Hz`);
}
