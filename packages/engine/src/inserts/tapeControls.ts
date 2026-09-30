/** Materialize the legacy Wear macro when an independent motion dial is first edited. */
import type { TapeSpec } from './tapeSpec';
import type { TAPE_BOUNDS } from './tapeConstants';
export type TapeNumber = keyof typeof TAPE_BOUNDS;
export function tapeControlValue(spec: TapeSpec, field: TapeNumber): number {
  if (!spec.split && (field === 'wow' || field === 'flutter' || field === 'dropouts'))
    return spec.wear;
  return spec[field];
}
export function setTapeControl(spec: TapeSpec, field: TapeNumber, value: number): TapeSpec {
  if (field === 'wow' || field === 'flutter' || field === 'dropouts') {
    return {
      ...spec,
      wow: tapeControlValue(spec, 'wow'),
      flutter: tapeControlValue(spec, 'flutter'),
      dropouts: tapeControlValue(spec, 'dropouts'),
      split: true,
      [field]: value,
    };
  }
  return { ...spec, [field]: value };
}
