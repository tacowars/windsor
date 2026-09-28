// Regression cases for guard-bash.mjs, run with `node --test .claude/hooks/`.
// Vitest does not collect this file (its include globs are under packages/
// and scripts/lib/). Each case pipes a hook payload into the real hook.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL, fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('./guard-bash.mjs', import.meta.url));
const POLL = /^Do not poll CI\. Wait for the Codex review/;
const BOARD = /^Nobody writes the board/;
const MERGE = /^A worker never merges/;
const VERIFY = /^A worker runs the tests beside its change/;
const SUITE = /^Run the test files you touched/;
const BUILD = /^A worker does not build/;

function decide(command, worker = false) {
  const payload = { tool_input: { command }, ...(worker ? { agent_id: 'a' } : {}) };
  const run = spawnSync('node', [hook], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (run.status === 0) return null;
  assert.equal(run.status, 2);
  return JSON.parse(run.stdout).hookSpecificOutput.permissionDecisionReason;
}

const denied = [
  ['gh run watch 123', POLL],
  ['git push && gh run watch --exit-status', POLL],
  ['gh run list | head -1; gh run watch', POLL],
  ['echo $(gh run watch 1)', POLL],
  ['echo "$(gh run watch 1)"', POLL],
  ['echo `gh run watch 1`', POLL],
  // Bash runs a backtick substitution inside double quotes.
  ['gh issue create --body "Do not run `gh run watch` here"', POLL],
  ['gh pr checks 5 --watch', POLL],
  ["gh pr checks 5 '--watch'", POLL],
  ["gh run 'watch' 123", POLL],
  ['gh "run" watch 123', POLL],
  ['gh r\\un watch 123', POLL],
  ['GH_HOST=github.com gh run watch 123', POLL],
  ['if true; then gh run watch 123; fi', POLL],
  ['while true; do gh run watch 1; done', POLL],
  ['env GH_HOST=x gh run watch 1', POLL],
  ['sleep 1 & gh run watch 1', POLL],
  ["printf '%s\\n' 'example <<EOF'\ngh run watch 123", POLL],
  ["cat > f <<'EOF'\nhello\nEOF\ngh run watch 1", POLL],
  ['cat > f <<-EOF\n\thello\n\tEOF\ngh run watch 1', POLL],
  ['gh project item-add 6 --url x', BOARD],
];

const deniedInWorker = [
  ['gh pr merge 5 --squash', MERGE],
  ['gh api -X PUT repos/o/r/pulls/5/merge', MERGE],
  ['npm run verify', VERIFY],
  ['npm run verify:quick', VERIFY],
  ['npm test', SUITE],
  ['npx vitest run', SUITE],
  ['npm run build', BUILD],
];

const allowed = [
  'git status',
  'gh pr checks 5',
  'gh run view 123',
  'gh issue create --title t --body-file x',
  'gh issue create --title t --body "Do not run gh run watch here"',
  "gh issue create --title t --body 'Do not run `gh run watch` here'",
  "gh issue create --title t --body 'then gh run watch 123'",
  "cat > f <<'EOF'\nthen gh run watch 123\nEOF",
  'cat > f <<EOF\ngh pr checks 5 --watch\nEOF\necho done',
  'echo hi # gh run watch 1',
  'echo gh run watch',
  'ls 2>&1 | grep watch',
];

test('polling and the board are denied everywhere', () => {
  for (const [command, reason] of denied) {
    assert.match(decide(command) ?? 'allowed', reason, command);
    assert.match(decide(command, true) ?? 'allowed', reason, command);
  }
});

test('the worker-only guards deny in a worker and allow in the main session', () => {
  for (const [command, reason] of deniedInWorker) {
    assert.match(decide(command, true) ?? 'allowed', reason, command);
    assert.equal(decide(command), null, command);
  }
});

test('text that only mentions a polling command is allowed', () => {
  for (const command of allowed) {
    assert.equal(decide(command), null, command);
    assert.equal(decide(command, true), null, command);
  }
});

test('a worker may run the test files it touched', () => {
  assert.equal(decide('npx vitest run packages/app/src/a.test.ts', true), null);
});
