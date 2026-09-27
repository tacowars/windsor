/**
 * The after-write command list has one meaning in two languages (#620
 * decision 7): the Node script prints it, the console shows it. The copy in
 * `src/libraryConstants.ts` carries this equality test against the source.
 */
import { describe, expect, it } from 'vitest';

import { AFTER_WRITE_COMMANDS as CONSOLE_COMMANDS } from '../src/libraryConstants';
import { AFTER_WRITE_COMMANDS } from './afterWriteCommands.mjs';

describe('AFTER_WRITE_COMMANDS', () => {
  it('is the same list the console shows', () => {
    expect([...CONSOLE_COMMANDS]).toEqual(AFTER_WRITE_COMMANDS);
    expect(AFTER_WRITE_COMMANDS[0]).toMatch(/^node packages\/app\/sweep-headroom\.mjs/);
  });
});
