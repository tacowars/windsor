/* global process, console */
// How the room's input diffusers follow Size (windsor#746): T30 off Decay, %,
// a centred click with damping open and the modulation off, Build 0.1, at the
// short decays and large Sizes where diffusers ringing outside the loop show,
// on `main`, the room scaled by Size itself (the bundle patched) and the room
// scaled by its square root (as shipped). Both rooms take the lengths the
// lines held before windsor#746, so only the law differs.
// node inputLaw.mjs <new bundle> <main bundle>
import { clickT30 } from '../2026-10-12-plate-stereo-input/measure.mjs';
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { patchVoicing } from './voicingRig.mjs';

const [file, mainFile] = process.argv.slice(2);
const OLD = {
  roomInput: [0.004771345, 0.003595309, 0.012734787, 0.009307483],
  roomInputRight: [0.005312, 0.003825, 0.011459, 0.008022],
};
// The law and the capacity it allocates for (Size's top under the law) move together.
const LAW = 'this._inputFollowsSize ? Math.sqrt(size) : 1';
const CAPACITY = 'row.inputFollowsSize ? Math.sqrt(MAX_SIZE) : 1';
const linear = (s) => {
  if (!s.includes(LAW) || !s.includes(CAPACITY)) throw new Error('inputLaw: the law is not in the bundle');
  return patchVoicing(s, OLD)
    .replace(LAW, 'this._inputFollowsSize ? size : 1')
    .replace(CAPACITY, 'row.inputFollowsSize ? MAX_SIZE : 1');
};
const plates = [
  ['main', loadPlate(mainFile, 48000), 0],
  ['linear', loadPlate(file, 48000, linear), 1],
  ['square root', loadPlate(file, 48000, (s) => patchVoicing(s, OLD)), 1],
];
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1, build: 0.1 };
console.log(`| Decay, Size | ${plates.map(([n]) => n).join(' | ')} |`);
console.log(`|---|${plates.map(() => '---').join('|')}|`);
for (const [decay, size] of [
  [0.5, 2],
  [0.5, 4],
  [1, 4],
  [1.5, 4],
]) {
  const cells = plates.map(([, p, voicing]) => {
    const t = clickT30(p, { ...OPEN, decay, size, voicing }, 'centred', 1.5 * decay + 3) / decay - 1;
    return `${t >= 0 ? '+' : ''}${(t * 100).toFixed(1)} %`;
  });
  console.log(`| ${decay} s, ${size} | ${cells.join(' | ')} |`);
}
