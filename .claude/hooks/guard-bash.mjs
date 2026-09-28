// PreToolUse guard for Bash. Enforces the rules in CLAUDE.md "Working a
// ticket" that Aotearoa204 learned by paying for them: a worker never
// merges, never runs the full gate (CI does), and nobody polls CI.
//
// Input: the hook JSON on stdin. `agent_id` is present only inside a
// sub-agent. Output: a deny decision on stdout plus exit code 2, or nothing.

import { readFileSync } from 'node:fs';
import process from 'node:process';

// CI polling is matched against the commands actually run, not against text
// that merely mentions them. A small shell-word lexer (not a shell grammar)
// splits the command line into simple commands and each command into words
// with the quotes removed. Heredoc bodies and comments are skipped. Leading
// assignments and shell keywords are dropped, and the rest is matched word
// by word, so a heredoc, a `--body-file` or a quoted `--body` that mentions
// a polling command passes while `gh run 'watch'` does not.

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`']);
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
const PREFIX_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', '!', '{', '(', 'command', 'exec', 'env',
]);

function createLexer(text) {
  const state = { i: 0, word: null, words: [], commands: [], heredocs: [] };

  const endWord = () => {
    if (state.word !== null) state.words.push(state.word);
    state.word = null;
  };
  const endCommand = () => {
    endWord();
    if (state.words.length > 0) state.commands.push(state.words);
    state.words = [];
  };
  const append = (chars) => {
    state.word = (state.word ?? '') + chars;
  };

  return { text, state, endWord, endCommand, append };
}

function readSingleQuoted(lexer) {
  const { text, state } = lexer;
  const close = text.indexOf("'", state.i + 1);
  const end = close === -1 ? text.length : close;
  lexer.append(text.slice(state.i + 1, end));
  state.i = end + 1;
}

// A `$( … )` or backtick substitution inside double quotes still runs, so
// its text is lexed as commands of its own. Returns the index after it.
function readQuotedSubstitution(lexer, start) {
  const { text, state } = lexer;
  const backtick = text[start] === '`';
  let end = start + (backtick ? 1 : 2);
  let depth = 1;
  while (end < text.length && depth > 0) {
    if (text[end] === '\\') end += 1;
    else if (backtick && text[end] === '`') depth = 0;
    else if (!backtick && text[end] === '(') depth += 1;
    else if (!backtick && text[end] === ')') depth -= 1;
    end += 1;
  }
  const inner = text.slice(start + (backtick ? 1 : 2), depth === 0 ? end - 1 : end);
  state.commands.push(...simpleCommands(inner));
  return end;
}

function readDoubleQuoted(lexer) {
  const { text, state } = lexer;
  let chars = '';
  state.i += 1;
  while (state.i < text.length && text[state.i] !== '"') {
    const c = text[state.i];
    if (c === '`' || (c === '$' && text[state.i + 1] === '(')) {
      state.i = readQuotedSubstitution(lexer, state.i);
      continue;
    }
    if (c === '\\' && DOUBLE_QUOTE_ESCAPES.has(text[state.i + 1])) state.i += 1;
    chars += text[state.i];
    state.i += 1;
  }
  lexer.append(chars);
  state.i += 1;
}

function readHeredocOpener(lexer) {
  const { text, state } = lexer;
  lexer.endWord();
  state.i += 2;
  const stripTabs = text[state.i] === '-';
  if (stripTabs) state.i += 1;
  while (text[state.i] === ' ' || text[state.i] === '\t') state.i += 1;
  const delimiter = createLexer(text);
  delimiter.state.i = state.i;
  while (delimiter.state.i < text.length && !/[\s;&|()<>`]/.test(text[delimiter.state.i])) {
    readChar(delimiter);
  }
  state.i = delimiter.state.i;
  state.heredocs.push({ terminator: delimiter.state.word ?? '', stripTabs });
}

function skipHeredocBodies(lexer) {
  const { text, state } = lexer;
  for (const { terminator, stripTabs } of state.heredocs) {
    while (state.i < text.length) {
      const lineEnd = text.indexOf('\n', state.i) === -1 ? text.length : text.indexOf('\n', state.i);
      const line = text.slice(state.i, lineEnd);
      state.i = lineEnd + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === terminator) break;
    }
  }
  state.heredocs = [];
}

function readSeparator(lexer) {
  const { text, state } = lexer;
  const c = text[state.i];
  lexer.endCommand();
  state.i += c === text[state.i + 1] && (c === '&' || c === '|' || c === ';') ? 2 : 1;
  if (c === '\n') skipHeredocBodies(lexer);
}

// One step of the lexer outside quotes: a quote, an escape, a separator, a
// heredoc opener, a comment, a blank or an ordinary character.
function readChar(lexer) {
  const { text, state } = lexer;
  const c = text[state.i];
  const next = text[state.i + 1];
  const prev = text[state.i - 1];
  if (c === "'") return readSingleQuoted(lexer);
  if (c === '"') return readDoubleQuoted(lexer);
  if (c === '\\') {
    if (next !== '\n') lexer.append(next ?? '');
    state.i += 2;
    return;
  }
  if (c === '$' && next === '(') {
    lexer.endCommand();
    state.i += 2;
    return;
  }
  if (c === '<' && next === '<' && text[state.i + 2] !== '<') return readHeredocOpener(lexer);
  const redirectAmpersand = c === '&' && (prev === '>' || prev === '<' || next === '>');
  if (SEPARATORS.has(c) && !redirectAmpersand) return readSeparator(lexer);
  if (c === '#' && state.word === null) {
    while (state.i < text.length && text[state.i] !== '\n') state.i += 1;
    return;
  }
  if (c === ' ' || c === '\t') lexer.endWord();
  else lexer.append(c);
  state.i += 1;
}

function simpleCommands(text) {
  const lexer = createLexer(text);
  while (lexer.state.i < text.length) readChar(lexer);
  lexer.endCommand();
  return lexer.state.commands;
}

function commandWords(words) {
  let start = 0;
  while (start < words.length && (PREFIX_WORDS.has(words[start]) || /^[A-Za-z_]\w*=/.test(words[start]))) {
    start += 1;
  }
  return words.slice(start);
}

function pollsCi(text) {
  return simpleCommands(text).some((words) => {
    const [tool, group, action, ...rest] = commandWords(words);
    if (tool !== 'gh') return false;
    if (group === 'run' && action === 'watch') return true;
    return group === 'pr' && action === 'checks' && rest.some((w) => w === '--watch' || w.startsWith('--watch='));
  });
}

const pollMessage =
  'Do not poll CI. Wait for the Codex review, then merge with `gh pr merge <N> --squash` (see CLAUDE.md, the main session).';

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

function denyReason(input) {
  const command = String(input.tool_input?.command ?? '');
  if (pollsCi(command)) return pollMessage;
  const rules = input.agent_id ? [...everywhere, ...workerOnly] : everywhere;
  return rules.find(([pattern]) => pattern.test(command))?.[1];
}

const reason = denyReason(JSON.parse(readFileSync(0, 'utf8')));
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
