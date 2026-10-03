/**
 * The console stylesheet, as the tests that check it read it (windsor#472).
 * Several tables in TypeScript copy a colour, a size or a selector's value
 * from `console.css`, and their tests pin the copy against it. This module
 * opens the file once and answers the few questions those tests ask. It is
 * not a CSS parser: a rule is found by its selector at the start of a line,
 * and a property by its name at the start of a line inside that rule.
 *
 * Imported only by tests; the app never reads its own stylesheet.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';

/** The whole of `console.css`. */
export const CONSOLE_CSS = readFileSync(new URL('./console.css', import.meta.url), 'utf8');

/** The `--name: #rrggbb;` custom properties, first definition of each name. */
export function cssHexProperties(css = CONSOLE_CSS): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (match[1] && match[2] && !found.has(match[1])) found.set(match[1], match[2]);
  }
  return found;
}

/** The custom properties whose names start with `prefix` (`--harmony-`) that a `var(…)` reads. */
export function cssVarsRead(prefix: string, css = CONSOLE_CSS): Set<string> {
  const names = css.matchAll(new RegExp(`var\\((${escape(prefix)}[a-z-]+)\\)`, 'g'));
  return new Set([...names].map((m) => m[1] ?? ''));
}

/** The body of the rule whose selector starts a line, or `''` when there is none. */
export function cssRule(selector: string, css = CONSOLE_CSS): string {
  return new RegExp(`\\n${escape(selector)} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

/** A property's value within a rule body, or `''` when the body does not set it. */
export function cssValue(body: string, property: string): string {
  return new RegExp(`\\n\\s*${escape(property)}: ([^;]*);`).exec(body)?.[1] ?? '';
}

/**
 * Opening braces less closing ones, comments and strings aside: 0 for a
 * balanced sheet. #610's Euclidean block once lost its closing brace and every
 * later rule became a nested selector matching nothing, so the console
 * rendered unstyled while everything stayed green.
 */
export function braceBalance(css = CONSOLE_CSS): number {
  const code = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  return code.split('{').length - code.split('}').length;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
