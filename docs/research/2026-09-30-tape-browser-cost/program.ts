/** windsor#211's deterministic music program: FM bass, detuned chord, noise hats and a
 * 60 Hz kick, mixed to -6 dBFS peak, right = left one frame late. Only + − × ÷, floor
 * and fround, so Node and Chrome produce the same bits and the same SHA-256; no
 * Math.sin, exp or pow, whose last bits an engine build need not pin. A cost workload,
 * not a song, a reference or an audition. Original Windsor research.
 */
import { COST } from './costConstants';
type Program = (typeof COST)['program'];
export interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

/** sin(2π·cycles): folded to a quarter wave, then Taylor to degree 11 (error < 6e-8). */
export function sine(cycles: number): number {
  let x = cycles - Math.floor(cycles);
  if (x >= 0.5) x -= 1;
  if (x > 0.25) x = 0.5 - x;
  else if (x < -0.25) x = -0.5 - x;
  const r = 2 * Math.PI * x,
    r2 = r * r;
  return (
    r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 - r2 / 39916800)))))
  );
}
/** Rational decay (τ / (τ + t))², 1 at t = 0. */
function decay(t: number, tau: number): number {
  const d = tau / (tau + t);
  return d * d;
}

/** Stateful voices over the whole program: chord phases and the hat's noise filter. */
function voices(p: Program, rate: number) {
  const beat = (rate * 60) / p.bpm,
    hatFrames = beat * p.hat.beats,
    burst = p.hat.burstSeconds * rate,
    phases = p.chord.hz.map(() => 0);
  let noise = p.hat.seed >>> 0,
    previous = 0,
    high = 0;
  return (i: number): number => {
    const t = i / rate,
      within = i % beat,
      tn = within / rate,
      b = p.bass;
    const f = b.hz[Math.floor(i / beat) % b.hz.length];
    const gate = Math.min(1, tn / b.attackSeconds, (beat - within) / rate / b.releaseSeconds);
    const depth = b.depth * decay(tn, b.depthDecaySeconds);
    let sum =
      b.level * gate * decay(tn, b.decaySeconds) * sine(f * tn + depth * sine(b.ratio * f * tn));
    p.chord.hz.forEach((hz, k) => {
      phases[k] += (hz * (1 + p.chord.detune * sine(p.chord.detuneHz * t + k / 3))) / rate;
      sum += p.chord.level * sine(phases[k]);
    });
    const hat = i % hatFrames;
    if (hat < burst) {
      noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
      const x = noise / 2147483648 - 1;
      high = p.hat.highpass * (high + x - previous);
      previous = x;
      const accent = Math.floor(i / hatFrames) % 2 ? 1 : p.hat.accent;
      sum += p.hat.level * accent * (1 - hat / burst) * high;
    }
    return sum + p.kick.level * sine(p.kick.hz * tn) * decay(tn, p.kick.decaySeconds);
  };
}

/** The program at `rate`: `frames` stereo Float32 frames, peak exactly scaled to peakGain. */
export function renderProgram(p: Program = COST.program, rate = COST.rate): Stereo {
  const voice = voices(p, rate),
    mono = new Float64Array(p.frames);
  let peak = 0;
  for (let i = 0; i < p.frames; i++) {
    mono[i] = voice(i);
    peak = Math.max(peak, Math.abs(mono[i]));
  }
  const gain = p.peakGain / peak,
    left = new Float32Array(p.frames),
    right = new Float32Array(p.frames);
  for (let i = 0; i < p.frames; i++) {
    left[i] = Math.fround(mono[i] * gain);
    if (i >= p.offsetFrames) right[i] = Math.fround(mono[i - p.offsetFrames] * gain);
  }
  return { left, right };
}

/** Left then right as little-endian Float32 bytes: the hashed form. */
export function programBytes({ left, right }: Stereo): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(8 * left.length));
  left.forEach((v, i) => view.setFloat32(4 * i, v, true));
  right.forEach((v, i) => view.setFloat32(4 * (left.length + i), v, true));
  return view.buffer;
}

/** SHA-256 hex through Web Crypto, present in Node 24 and in a secure-context page. */
export async function programHash(program: Stereo): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', programBytes(program));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length and level against the declaration; the hash is compared by the caller. */
export function checkProgram(program: Stereo, p: Program = COST.program) {
  let peak = 0;
  for (const channel of [program.left, program.right])
    for (const v of channel) peak = Math.max(peak, Math.abs(v));
  const peakDb = 20 * Math.log10(peak),
    frames = program.left.length;
  const lengthOk = frames === p.frames && program.right.length === p.frames,
    levelOk = Math.abs(peakDb - p.peakDbfs) <= p.toleranceDb;
  return { frames, peakDb, lengthOk, levelOk, passes: lengthOk && levelOk };
}
