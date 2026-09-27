/** Original starting points, not measured pedal matches. Mix and enabled remain user-owned. */
import { DEFAULT_PHASER } from './phaserSpec';
import type { PhaserSpec } from './phaserSpec';
export type PhaserSettings = Omit<PhaserSpec, 'kind' | 'mix' | 'enabled'>;
const classic: PhaserSettings = {
  rate: DEFAULT_PHASER.rate,
  center: DEFAULT_PHASER.center,
  depth: DEFAULT_PHASER.depth,
  feedback: DEFAULT_PHASER.feedback,
  feedbackCut: DEFAULT_PHASER.feedbackCut,
  stereo: DEFAULT_PHASER.stereo,
  envelope: DEFAULT_PHASER.envelope,
  bassKeep: DEFAULT_PHASER.bassKeep,
};
export const PHASER_PRESETS: readonly {
  id: string;
  label: string;
  settings: PhaserSettings;
}[] = [
  { id: 'classic', label: 'Classic swirl', settings: classic },
  {
    id: 'color',
    label: 'Deep color',
    settings: { ...classic, center: 420, depth: 2.4, feedback: 0.7, feedbackCut: 500 },
  },
  {
    id: 'acid',
    label: 'Acid motion',
    settings: {
      ...classic,
      rate: 0.35,
      center: 500,
      depth: 1.4,
      feedback: 0.65,
      feedbackCut: 450,
      envelope: 1.8,
      bassKeep: 0.85,
      stereo: 20,
    },
  },
  {
    id: 'space',
    label: 'Space pad',
    settings: {
      ...classic,
      rate: 0.06,
      center: 750,
      depth: 2.8,
      feedback: 0.45,
      feedbackCut: 180,
      stereo: 120,
      bassKeep: 0.2,
    },
  },
  {
    id: 'hollow',
    label: 'Hollow orbit',
    settings: {
      ...classic,
      rate: 0.12,
      center: 600,
      depth: 2.5,
      feedback: -0.65,
      feedbackCut: 250,
      stereo: 180,
      envelope: -0.5,
      bassKeep: 0.4,
    },
  },
];
