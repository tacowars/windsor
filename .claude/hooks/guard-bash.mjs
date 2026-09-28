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

// CI polling is matched against the commands actually run: heredoc bodies
// and quoted text are dropped, the rest is split on pipes, `;`, `&&`, `||`,
// `$(`, backticks and newlines, and a pattern must match at the start of a
// segment. A heredoc or an issue body that merely mentions a polling
// command passes.
const pollMessage =
  'Do not poll CI. Wait for the Codex review, then merge with `gh pr merge <N> --squash` (see CLAUDE.md, the main session).';
const polling = [/^gh\s+run\s+watch\b/, /^gh\s+pr\s+checks\b.*--watch\b/];

function stripHeredocBodies(text) {
  const kept = [];
  let terminator = null;
  for (const line of text.split('\n')) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    const opener = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line);
    if (opener) terminator = opener[2];
  }
  return kept.join('\n');
}

function commandSegments(text) {
  return stripHeredocBodies(text)
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .split(/\n|;|&&|\|\||\||\$\(|`/)
    .map((segment) => segment.trim().replace(/^[({]\s*/, ''));
}

const segments = commandSegments(command);
const polls = polling.some((pattern) => segments.some((segment) => pattern.test(segment)));

const everywhere = [
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
const reason = polls ? pollMessage : rules.find(([pattern]) => pattern.test(command))?.[1];

if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(2);
}
