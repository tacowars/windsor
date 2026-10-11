/**
 * How the app names the song's scales (windsor#721): one lower-case name per
 * `ScaleName`, read by the transport's Scale picker and the roll summary
 * (`A harmonic minor`), and the picker's groups in their shown order.
 */
import type { ScaleName } from '@windsor/engine';

export const SCALE_DISPLAY_NAMES: Readonly<Record<ScaleName, string>> = {
  major: 'major',
  naturalMinor: 'minor',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  lydian: 'lydian',
  pentatonicMajor: 'major pentatonic',
  pentatonicMinor: 'minor pentatonic',
  phrygian: 'phrygian',
  locrian: 'locrian',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  phrygianDominant: 'phrygian dominant',
  hirajoshi: 'hirajoshi',
  japaneseIn: 'in (miyako-bushi)',
  majorBlues: 'major blues',
  minorBlues: 'minor blues',
  wholeTone: 'whole tone',
};

/** One `<optgroup>` of the Scale picker. */
export interface ScaleGroup {
  readonly label: string;
  readonly scales: readonly ScaleName[];
}

/** The picker's groups (windsor#721 decision 3); every scale sits in exactly one. */
export const SCALE_GROUPS: readonly ScaleGroup[] = [
  {
    label: 'Modes',
    scales: ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'naturalMinor', 'locrian'],
  },
  { label: 'Minor', scales: ['harmonicMinor', 'melodicMinor', 'phrygianDominant'] },
  {
    label: 'Pentatonic',
    scales: ['pentatonicMajor', 'pentatonicMinor', 'hirajoshi', 'japaneseIn'],
  },
  { label: 'Blues', scales: ['majorBlues', 'minorBlues'] },
  { label: 'Symmetric', scales: ['wholeTone'] },
];
