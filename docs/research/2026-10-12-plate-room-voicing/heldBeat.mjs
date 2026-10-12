/* global process, console */
// The held 1 kHz sine's beat (windsor#746) in each voicing and on `main`, at
// the default modulation, as `mixer/reverbModulationSpread.test.ts` reads it
// (`voicingMeasures.mjs`'s `heldBeat`), dB re the envelope's mean.
// node heldBeat.mjs <new bundle> <main bundle> [rate]
import { loadPlate } from '../2026-10-12-plate-stereo-input/rig.mjs';
import { heldBeat } from './voicingMeasures.mjs';

const [file, mainFile, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);
console.log(`main ${heldBeat(loadPlate(mainFile, rate), 0).toFixed(2)} dB`);
console.log(`plate ${heldBeat(plate, 0).toFixed(2)} dB`);
console.log(`room ${heldBeat(plate, 1).toFixed(2)} dB`);
