/**
 * Buses: dry summing points with inserts, built from native Web Audio nodes.
 *
 * A bus owns no effect a part might want a different amount of. Reverb and
 * delay are returns fed by per-part sends (`returnBus.ts`); what stays here is
 * the insert every part on the bus shares -- today, a filter. Decision:
 * docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md §1, §5.
 *
 * Native nodes execute in the audio thread and cost nothing from the
 * main-thread frame budget that `docs/design/tech-demo-proposal.md` §1
 * identifies as the project's primary risk.
 */

import { BUS_FILTER_FREQUENCY_HZ, BUS_FILTER_Q } from './audioConstants';

export interface BusFilterOptions {
  type?: BiquadFilterType;
  frequency?: number;
  Q?: number;
}

export interface BusOptions {
  /** Omit to leave the filter out of the graph entirely. */
  filter?: BusFilterOptions;
}

export interface AudioBus {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly filter?: BiquadFilterNode;
}

/** Wire a bus. Connect parts to `input`; route `output` onward. */
export function createBus(context: BaseAudioContext, options: BusOptions = {}): AudioBus {
  const input = context.createGain();
  const output = context.createGain();
  const bus: { input: GainNode; output: GainNode; filter?: BiquadFilterNode } = { input, output };

  let tail: AudioNode = input;

  if (options.filter) {
    const filter = context.createBiquadFilter();
    filter.type = options.filter.type ?? 'lowpass';
    filter.frequency.value = options.filter.frequency ?? BUS_FILTER_FREQUENCY_HZ;
    filter.Q.value = options.filter.Q ?? BUS_FILTER_Q;
    tail.connect(filter);
    tail = filter;
    bus.filter = filter;
  }

  tail.connect(output);
  return bus;
}
