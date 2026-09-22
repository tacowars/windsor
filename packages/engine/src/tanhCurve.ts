/**
 * A `WaveShaperNode` curve for `ceiling·tanh(x / ceiling)` (#647, #641): the
 * soft clip the echo's loop and the drive insert both use.
 *
 * The spec maps a shaper's input [-1, 1] linearly onto the curve and holds the
 * end values past it, so the curve spans x in ±`range`·ceiling and the caller
 * pre-scales its signal by 1 / (range·ceiling) into the shaper. An odd point
 * count puts an exact 0 in the middle, so silence stays silence. Built once per
 * shape and shared: a real shaper copies the array on assignment.
 */
const cache = new Map<string, Float32Array<ArrayBuffer>>();

export function tanhCurve(range: number, points: number, ceiling = 1): Float32Array<ArrayBuffer> {
  const key = `${range}:${points}:${ceiling}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const curve = new Float32Array(points);
  const last = points - 1;
  for (let i = 0; i <= last; i++) {
    const u = (2 * i) / last - 1;
    curve[i] = ceiling * Math.tanh(u * range);
  }
  cache.set(key, curve);
  return curve;
}
