/**
 * The arpeggiator's and the bass's sequencer fields, normalised (#705):
 * the `arp` and `bass` branches of `normaliseSequencer`. Complete here so a
 * v3 document carries either kind today; #706 and #707 add the generator
 * and the card, not a field. Everything returned satisfies `assertArpConfig`
 * / `assertBassConfig` by construction.
 */
import { ARP_OCTAVES_MAX, ARP_OCTAVES_MIN, GATE_MIN, HARMONY_DEGREE_MAX } from '../audioConstants';
import { CHORD_VOICING_DEFAULT, CHORD_VOICING_IDS } from '../harmony/chordTables';
import { ARP_STYLES, DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { BASS_PITCH_MODES, DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import type { ArpDriver, BassDriver } from './arrangement';
import type { FieldNormaliser } from './arrangementFields';
import { registerOctave, seed } from './sequencerFields';

export function arpDriver(raw: unknown, path: string, n: FieldNormaliser): ArpDriver {
  const d = DEFAULT_ARP_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(
    o,
    ['style', 'divisor', 'gate', 'octaves', 'voicing', 'retrigger', 'register', 'seed'],
    path,
  );
  return {
    style: n.pick(o.style, ARP_STYLES, d.style, `${path}.style`),
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    octaves: n.int(o.octaves, d.octaves, ARP_OCTAVES_MIN, ARP_OCTAVES_MAX, `${path}.octaves`),
    voicing: n.pick(o.voicing, CHORD_VOICING_IDS, CHORD_VOICING_DEFAULT, `${path}.voicing`),
    retrigger: n.bool(o.retrigger, d.retrigger, `${path}.retrigger`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    seed: seed(o.seed, `${path}.seed`, n),
  };
}

export function bassDriver(raw: unknown, path: string, n: FieldNormaliser): BassDriver {
  const d = DEFAULT_BASS_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(
    o,
    ['pitchMode', 'rootBias', 'fixedDegree', 'divisor', 'gate', 'register', 'density', 'seed'],
    path,
  );
  return {
    pitchMode: n.pick(o.pitchMode, BASS_PITCH_MODES, d.pitchMode, `${path}.pitchMode`),
    rootBias: n.num(o.rootBias, d.rootBias, 0, 1, `${path}.rootBias`),
    fixedDegree: n.int(o.fixedDegree, d.fixedDegree, 0, HARMONY_DEGREE_MAX, `${path}.fixedDegree`),
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    density: n.num(o.density, d.density, 0, 1, `${path}.density`),
    seed: seed(o.seed, `${path}.seed`, n),
  };
}
