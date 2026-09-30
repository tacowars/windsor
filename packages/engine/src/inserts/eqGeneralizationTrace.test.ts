/**
 * The reading of V8's `--trace-generalization` output that
 * `eqAllocation.test.ts` relies on (windsor#198): what counts as a
 * representation change, and that split or interleaved records neither
 * invent one nor hide one.
 */
import { describe, expect, it } from 'vitest';
import { representationChanges } from '../__fixtures__/generalizationTrace';

const SCRIPT = 'eq-processor.js';

describe('representationChanges', () => {
  it('counts a field that changes representation in the script', () => {
    const fade =
      '[generalizing]fade:s{Any;mutable}->d{Any;mutable} (+5 maps) [~step+39 at eq-processor.js:559]';
    expect(representationChanges(`${fade}\n`, SCRIPT)).toEqual([fade]);
  });

  it('ignores a first write, a constness change and a field-type change', () => {
    const output = [
      '[generalizing]q:v{None;const}->s{Any;const} (uninitialized field) [~EqProcessor+1 at eq-processor.js:863]',
      '[generalizing]w:d{Any;const}->d{Any;mutable} (field type generalization) [~step+2 at eq-processor.js:198]',
      '[generalizing]outL:h{Class(0x19c62b69cf91);const}->h{Any;mutable} (field type generalization) [~process+151 at eq-processor.js:735]',
    ].join('\n');
    expect(representationChanges(output, SCRIPT)).toEqual([]);
  });

  it("ignores another script's change", () => {
    const output =
      '[generalizing]x:s{Any;const}->t{Any;const} (+1 maps) [~promisify+276 at node:internal/util:513]\n';
    expect(representationChanges(output, SCRIPT)).toEqual([]);
  });

  it('reads the two records Linux CI interleaved in one line as no change', () => {
    const output =
      '[generalizing]type:s{ at eq-processor.js:446[generalizing]freq:d{Any;const}->d{Any;const} (uninitialized field) [new ~EqBand+115 at eq-processor.js:446]\n' +
      'Any;const}->s{Any;const} (uninitialized field) [new ~EqBand+115 at eq-processor.js:446]\n';
    expect(representationChanges(output, SCRIPT)).toEqual([]);
  });

  it('finds a change whose record was split across lines or lost its location', () => {
    const split =
      '[generalizing]gain:s{Any;mutable}->d{Any;mutable} (+2 maps) [~set+9 at eq-proc' +
      '[generalizing]q:d{Any;const}->d{Any;const} (uninitialized field) [new ~EqBand+115 at eq-processor.js:446]\n' +
      'essor.js:470]\n';
    expect(representationChanges(split, SCRIPT)).toHaveLength(1);
    expect(representationChanges(split, SCRIPT)[0]).toMatch(/^\[generalizing\]gain:s/);
  });
});
