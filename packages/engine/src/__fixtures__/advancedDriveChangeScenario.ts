/**
 * Advanced Drive's run for `workletAllocationProbe.ts` (windsor#226): a cycle of
 * steps, each a set of parameter changes applied at its first quantum and then
 * held while the controls glide and settle, with a silence at its end.
 * The test builds the steps (every route, shaper, filter and LFO wave, stages
 * and the insert switched off and on, modulation, sync); the warm-up plays the
 * cycle whole several times, the load meter on for its first cycle, and the
 * measured run plays it once more, so it measures code already hot. The probe
 * imports this by path in its child Node, which runs it directly (its types
 * are stripped), so it imports nothing at run time.
 *
 * With `sleeps` (windsor#793) the silence is long enough for the drive to
 * sleep, rest and be woken by the next step's sound; the scenario then throws
 * at the end of the measured run unless that run saw the drive asleep and saw
 * it wake.
 */
import type { ProbeRig, ProbeScenario } from './workletAllocationProbe';

export interface DriveChangeStep {
  /** The parameters this step sets, and their values, index for index. */
  names: string[];
  values: number[];
}

export interface DriveChangeConfig {
  steps: DriveChangeStep[];
  /** Quanta each step plays: long enough for every control to settle. */
  period: number;
  /** Quanta of silence at the end of each step (the follower's release, silent input). */
  quiet: number;
  /** Whether the silence must put the drive to sleep, and the next step wake it. */
  sleeps?: boolean;
}

/** The processor's field the run reads (`DriveSleep`). */
interface DriveSleepState {
  asleep: boolean;
}

export default function advancedDriveChangeScenario(probe: ProbeRig): ProbeScenario {
  const config = probe.config.scenarioConfig as DriveChangeConfig;
  const { params, sound, quiet } = probe;
  const { period, steps } = config;
  const sleep = (probe.processor as unknown as { sleep: DriveSleepState }).sleep;
  // Asleep, and woken: each path the measured run must take with `sleeps`.
  const seen = new Uint8Array(2);
  let wasAsleep = false;
  // Preallocated: each change's parameter array and value, so nothing here allocates.
  const arrays = steps.map((step) => step.names.map((name) => params[name]!));
  const values = steps.map((step) => Float32Array.from(step.values));
  const cycle = steps.length * period;
  const apply = (q: number): void => {
    if (q % period !== 0) return;
    const step = (q / period) % steps.length;
    const at = arrays[step]!,
      to = values[step]!;
    for (let i = 0; i < at.length; i++) at[i]![0] = to[i]!;
  };
  const { warmup, measure } = probe.config;
  // Quanta [from, to). The warm-up and the measured run call this same function.
  const drive = (from: number, to: number): void => {
    for (let q = from; q < to; q++) {
      apply(q);
      probe.render(q, q % period >= period - config.quiet ? quiet : sound);
      if (sleep.asleep) seen[0] = 1;
      else if (wasAsleep) seen[1] = 1;
      wasAsleep = sleep.asleep;
    }
    if (config.sleeps && to === warmup + measure && seen.includes(0)) {
      throw new Error(`the measured run missed sleep or wake: ${seen.join(' ')}`);
    }
  };
  return {
    warm: () => {
      if (warmup % cycle !== 0)
        throw new Error(`warm-up ${warmup} is not whole cycles of ${cycle}`);
      // The meter on for the first cycle, so its path is hot, then the measured cadence.
      probe.report(64);
      // In chunks, so `drive` itself is optimised whole and not only mid-loop
      // (on-stack replacement), as the measured run calls it.
      for (let q = 0; q < warmup; q += period) {
        if (q === cycle) probe.report(probe.config.loadQuanta);
        drive(q, q + period);
      }
      seen.fill(0);
    },
    drive,
  };
}
