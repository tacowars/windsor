#!/usr/bin/env node
/* global process, console, URL */
/**
 * Fails when vitest no longer uses the change provider in `vitest.config.ts`
 * (windsor#456). A PR's test selection runs through that provider, which
 * vitest takes from the experimental `experimental.vcsProvider` option
 * (docs/log/2026-10-02-ci-runs-affected-tests-on-prs.md). If a vitest
 * upgrade renames or drops the option, vitest falls back to its own provider
 * without a word: the tests that scan source trees (`SCANNED_BY`) stop being
 * added on PRs, and a git failure lists no test, which `--passWithNoTests`
 * passes.
 *
 * The probe checks the provider by its behaviour, through vitest itself:
 * `vitest list` against a base ref that does not exist. The config's provider
 * throws git's error, so vitest exits non-zero naming the ref. Vitest's own
 * provider swallows git's exit status, lists nothing and exits 0.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PROBE_REF = 'windsor-vitest-provider-probe-no-such-ref';

const result = spawnSync('npx', ['vitest', 'list', '--filesOnly'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, VERIFY_CHANGED_SINCE: PROBE_REF },
});
if (result.error) {
  console.error(`check-vitest-provider: could not run vitest: ${result.error.message}`);
  process.exit(1);
}
const output = `${result.stdout}${result.stderr}`;

// Our provider's own failure: non-zero exit, with git's complaint about the
// probe ref. Any other non-zero exit is a broken run, not a pass.
if (result.status !== 0 && output.includes(`${PROBE_REF}...HEAD`)) {
  console.log('check-vitest-provider: vitest uses the config change provider');
  process.exit(0);
}

if (result.status === 0) {
  const listed = result.stdout.split('\n').filter(Boolean).length;
  console.error(
    `check-vitest-provider: vitest exited 0 against a missing base ref, listing ${listed} test files.\n` +
      'It is not using the change provider in vitest.config.ts (experimental.vcsProvider):\n' +
      'check whether a vitest upgrade renamed or dropped the option.',
  );
} else {
  console.error(output);
  console.error(
    `check-vitest-provider: vitest exited ${result.status} without the provider's git error.`,
  );
}
process.exit(1);
