/**
 * The Parametric EQ's run for `workletAllocationProbe.ts` (windsor#198): type,
 * slope and on toggled on every band, after a warm-up of every path the audio
 * thread has. The probe imports it by path in its child Node, which runs it
 * directly (its types are stripped), so it imports nothing at run time; the
 * test passes the parameter names keyed by their `EQ_BAND_PARAMS` field
 * (`Freq` … `On`), so no object here shares its keys, and so its hidden class,
 * with one of the bundle's.
 */
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

export type ProbeField = 'Freq' | 'Gain' | 'Q' | 'Type' | 'Slope' | 'On';

export interface EqToggleConfig {
  /** Each field's parameter names, band by band. */
  names: Record<ProbeField, string[]>;
  typeCount: number;
  slopeCount: number;
  /** Quanta between toggles: long enough for a fade out and back in. */
  period: number;
}

export default function eqToggleScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as EqToggleConfig;
  const { params, sound, quiet } = probe;
  const band = (field: ProbeField): Float32Array[] =>
    config.names[field].map((name) => params[name]!);
  const [types, slopes, ons] = [band('Type'), band('Slope'), band('On')];
  const [freqs, gains, qs] = [band('Freq'), band('Gain'), band('Q')];
  const count = types.length;
  // Type, slope and on in turn, for every band at once (preallocated: nothing here allocates).
  const toggle = (q: number): void => {
    if (q % config.period !== 0) return;
    const kind = (q / config.period) % 3;
    for (let b = 0; b < count; b++) {
      if (kind === 0) types[b]![0] = (types[b]![0]! + 1) % config.typeCount;
      else if (kind === 1) slopes[b]![0] = (slopes[b]![0]! + 1) % config.slopeCount;
      else ons[b]![0] = 1 - ons[b]![0]!;
    }
  };
  const glide = (q: number): void => {
    if (q % config.period !== 0) return;
    const step = (q / config.period) % 2 === 0 ? 1.5 : 1 / 1.5;
    for (let b = 0; b < count; b++) {
      freqs[b]![0] = freqs[b]![0]! * step;
      qs[b]![0] = qs[b]![0]! * step;
      gains[b]![0] = -gains[b]![0]!;
    }
  };
  // Every other change the warm-up makes: the output and the enable, and silence now and then.
  const vary = (q: number): Float32Array[][] => {
    if (q % (config.period * 16) === 0) {
      params.output![0] = params.output![0] === 0 ? 3.5 : 0;
      params.enabled![0] = q % (config.period * 32) === 0 ? 0 : 1;
    }
    return q % 97 < 8 ? quiet : sound;
  };
  // Quanta [from, to): the warm-up's glides and changes, or toggling alone. The
  // measured run calls this same function, so it measures code already hot.
  const drive = (from: number, to: number, warm: boolean): void => {
    for (let q = from; q < to; q++) {
      if (warm) glide(q);
      else toggle(q);
      probe.render(q, warm ? vary(q) : sound);
    }
  };
  const { warmup } = probe.config;
  return {
    warm: () => {
      // A load report reads Date.now() twice a quantum, and V8 returns each as a
      // new heap number: the warm-up runs it, then sets the measured cadence (off, 0).
      probe.report(64);
      drive(0, warmup / 4, true);
      probe.report(probe.config.loadQuanta);
      params.enabled![0] = 1;
      params.output![0] = 0;
      // Toggling in short runs, so `drive` itself is optimised whole and not only
      // mid-loop (on-stack replacement), as the measured run calls it.
      const chunk = config.period * 16;
      for (let q = warmup / 4; q < warmup; q += chunk) drive(q, q + chunk, false);
    },
    drive: (from, to) => drive(from, to, false),
  };
}
