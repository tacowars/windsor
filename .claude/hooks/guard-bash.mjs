// PreToolUse guard for Bash. Enforces the rules in CLAUDE.md "Working a
// ticket" that Aotearoa204 learned by paying for them: a worker never
// merges, never runs the full gate (CI does), and nobody polls CI.
//
// Input: the hook JSON on stdin. `agent_id` is present only inside a
// sub-agent. Output: a deny decision on stdout plus exit code 2, or nothing.

import { readFileSync } from 'node:fs';
import process from 'node:process';

const input = JSON.parse(readFileSync(0, 'utf8'));
const command = String(input.tool_input?.command ?? '');
const inWorker = Boolean(input.agent_id);

const everywhere = [
  [/\bgh\s+run\s+watch\b/, 'Do not poll CI. Merge with `gh pr merge --squash --auto` and let GitHub wait.'],
  [/\bgh\s+pr\s+checks\b[^\n|;&]*--watch/, 'Do not poll CI. Read `gh pr checks` once, or use auto-merge.'],
  [/\bgh\s+project\s+item-(add|edit|delete|archive)\b/, 'Nobody writes the board. GitHub moves items from issue and PR events.'],
];

const workerOnly = [
  [/\bgh\s+pr\s+merge\b/, 'A worker never merges. End your turn with the PR URL; the main session merges.'],
  [/pulls\/\d+\/merge\b/, 'A worker never merges. End your turn with the PR URL; the main session merges.'],
  [/\bnpm\s+run\s+verify(:quick)?\b/, 'A worker runs the tests beside its change, typecheck and lint. CI runs `verify`.'],
  [/\bnpm\s+(run\s+)?test\b(?![-:\w])/, 'Run the test files you touched: `npx vitest run <paths>`. CI runs the suite.'],
  [/\bvitest\s+run\s*(\||;|&&|$)/, 'Run the test files you touched: `npx vitest run <paths>`. CI runs the suite.'],
  [/\bnpm\s+run\s+build\b/, 'A worker does not build. CI runs `verify`, which ends in the build.'],
];

const rules = inWorker ? [...everywhere, ...workerOnly] : everywhere;
const hit = rules.find(([pattern]) => pattern.test(command));

if (hit) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: hit[1],
      },
    }),
  );
  process.exit(2);
}
