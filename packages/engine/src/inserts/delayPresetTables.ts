/** Original starting points, not factory presets from another device. */
import type { DelaySpec } from './delaySpec';
export const DELAY_PRESET_TABLE: readonly {
  id: string;
  label: string;
  settings: Partial<Omit<DelaySpec, 'kind' | 'mix' | 'outputDb' | 'enabled'>>;
}[] = [
  {
    id: 'trance',
    label: 'Stereo trance',
    settings: {
      mode: 'stereo',
      leftDivision: '1/8D',
      rightDivision: '1/4',
      feedback: 0.45,
      highpass: 180,
      lowpass: 12000,
      drive: 0,
    },
  },
  {
    id: 'bounce',
    label: 'Dotted ping pong',
    settings: {
      mode: 'ping-pong',
      leftDivision: '1/8D',
      rightDivision: '1/8D',
      feedback: 0.65,
      highpass: 160,
      lowpass: 7000,
      drive: 3,
    },
  },
  {
    id: 'dub',
    label: 'Long dub',
    settings: {
      mode: 'ping-pong',
      leftDivision: '1/2D',
      rightDivision: '1/4T',
      feedback: 0.94,
      highpass: 120,
      lowpass: 3600,
      drive: 9,
    },
  },
  {
    id: 'space',
    label: 'Mid / side space',
    settings: {
      mode: 'mid-side',
      leftDivision: '1/4',
      rightDivision: '1/2D',
      feedback: 0.7,
      highpass: 240,
      lowpass: 6500,
      drive: 2,
    },
  },
];
