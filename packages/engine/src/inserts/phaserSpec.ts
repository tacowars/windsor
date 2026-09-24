/** Song-owned settings for the original phaser; preset selection writes values. */
import type { FieldNormaliser } from '../song/arrangementFields';
import { PHASER_BOUNDS, PHASER_DEFAULTS } from './phaserConstants';

export interface PhaserSpec {
  readonly kind: 'phaser';
  readonly rate: number;
  readonly center: number;
  readonly depth: number;
  readonly feedback: number;
  readonly feedbackCut: number;
  readonly stereo: number;
  readonly envelope: number;
  readonly bassKeep: number;
  readonly mix: number;
  readonly enabled: boolean;
}
export const DEFAULT_PHASER: PhaserSpec = {
  kind: 'phaser',
  ...PHASER_DEFAULTS,
};
export const PHASER_NUMBERS = Object.keys(PHASER_BOUNDS) as Array<keyof typeof PHASER_BOUNDS>;
export const PHASER_FIELDS = ['kind', ...Object.keys(PHASER_DEFAULTS)];

export function normalisePhaser(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): PhaserSpec {
  n.dropUnknown(raw, PHASER_FIELDS, path);
  const values = { ...PHASER_DEFAULTS };
  for (const name of PHASER_NUMBERS) {
    const [min, max] = PHASER_BOUNDS[name];
    values[name] = n.num(raw[name], values[name], min, max, `${path}.${name}`);
  }
  values.enabled = n.bool(raw.enabled, values.enabled, `${path}.enabled`);
  return { kind: 'phaser', ...values };
}
