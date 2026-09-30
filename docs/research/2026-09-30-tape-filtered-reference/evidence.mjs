/** Report gates retain failure/nulls, DC and gain. No fitted alignment. */
import {
  errorDb,
  powerSpectrum,
  spectrumMetrics,
  db,
} from '../2026-09-30-tape-phase-3/spectra.mjs';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const { EXPERIMENT: E } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-filtered-reference/filteredConstants.ts';`,
);
export function window(render, extended = false, delay = 0, key = 'output') {
  const period = extended ? render.plan.extendedPeriod : render.plan.principalPeriod;
  const start = period * E.frames - delay;
  if (start < 0 || !render[key] || start + E.frames > render[key].length)
    throw Error('Invalid window');
  return render[key].slice(start, start + E.frames);
}
export function state(render, key = 'output') {
  const output = render[key];
  const finite = !render.failure && output.every(Number.isFinite);
  const primary = window(render, false, 0, key);
  const peak = output.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
  return {
    finite,
    peak: finite ? peak : null,
    final: Number.isFinite(render.final) ? render.final : null,
    resets: render.resets,
    clips: render.clips,
    failure: render.failure ?? null,
    fieldPeak: render.fieldPeak ?? null,
    plan: render.plan,
    first: finite ? primary[0] : null,
    last: finite ? primary.at(-1) : null,
    extendedSettlingDb: finite ? errorDb(primary, window(render, true, 0, key)) : null,
  };
}
export function gate(errors, states, target, settlingGate) {
  return (
    errors.length >= 2 &&
    states.length === errors.length + 1 &&
    errors.every((x) => x !== null && Number.isFinite(x) && x <= target) &&
    states.every(
      (s) =>
        s.finite &&
        s.peak > 0 &&
        !s.resets &&
        !s.clips &&
        !s.failure &&
        s.extendedSettlingDb !== null &&
        s.extendedSettlingDb <= settlingGate,
    )
  );
}
export function residual(actual, reference, options = {}) {
  if (
    actual.failure ||
    reference.failure ||
    actual.resets ||
    actual.clips ||
    reference.resets ||
    reference.clips
  )
    return null;
  const a = window(actual, options.extended, options.delay ?? 0, options.key ?? 'output');
  const b = window(
    reference,
    options.extended,
    options.referenceDelay ?? 0,
    options.referenceKey ?? 'output',
  );
  return a.every(Number.isFinite) && b.every(Number.isFinite) ? errorDb(a, b) : null;
}
export function spectrum(output, bins) {
  if (!output.every(Number.isFinite)) return null;
  if (bins.length === 1) return spectrumMetrics(output, bins[0]);
  const powers = powerSpectrum(output);
  const carriers = bins.reduce((sum, bin) => sum + powers[bin], 0);
  const other = powers.reduce(
    (sum, power, bin) => sum + (bin && !bins.includes(bin) ? power : 0),
    0,
  );
  return { otherThanCarriersDbc: db(other / carriers) };
}
