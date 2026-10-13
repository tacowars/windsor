import { makeMacro, makePatch } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { ccInertReason, ccStatusText } from './ccStatus';

const patch = makePatch({
  macros: [
    makeMacro({ name: 'Accent', mappings: [{ target: 'filter.cutoff', min: 400, max: 3200 }] }),
    makeMacro({ name: ' ', mappings: [{ target: 'filter.resonance', min: 0, max: 1 }] }),
  ],
});

describe('ccInertReason', () => {
  it('names a macro the patch does not define', () => {
    expect(ccInertReason(patch, 'voice.macros.2.value')).toBe('no Macro 3 in this patch');
    expect(ccInertReason(undefined, 'voice.macros.0.value')).toBe('no Macro 1 in this patch');
    expect(ccInertReason(patch, 'voice.macros.0.value')).toBeUndefined();
  });

  it('names the macro that maps a voice target, or its catalog label when unnamed', () => {
    expect(ccInertReason(patch, 'voice.filter.cutoff')).toBe('mapped by Accent');
    expect(ccInertReason(patch, 'voice.filter.resonance')).toBe('mapped by Macro 2');
    expect(ccInertReason(patch, 'voice.ops.0.level')).toBeUndefined();
  });

  it('never makes a strip or insert target inert', () => {
    expect(ccInertReason(patch, 'strip.level')).toBeUndefined();
    expect(ccInertReason(patch, 'insert.d1.feedback')).toBeUndefined();
  });
});

describe('ccStatusText', () => {
  it('words every status but a live value', () => {
    expect(ccStatusText({ kind: 'live', value: 1, held: true })).toBeNull();
    expect(ccStatusText({ kind: 'waiting', marker: null })).toBe('Waiting for pickup');
    expect(ccStatusText({ kind: 'automated' })).toBe('Automated');
    expect(ccStatusText({ kind: 'inert', reason: 'mapped by Accent' })).toBe(
      'Inert · mapped by Accent',
    );
    expect(ccStatusText({ kind: 'noSlot' })).toBe('No voice slot');
  });
});
