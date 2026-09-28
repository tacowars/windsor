/** The toast stack's rules: order, repeats joining, the cap, removal and each tone's duration. */
import { describe, expect, it } from 'vitest';

import { TOAST_DURATION_MS } from './toastConstants';
import { addToast, emptyStack, removeToast, toastDuration } from './toastModel';

describe('the toast stack', () => {
  it('stacks messages oldest first, each with its own id', () => {
    let stack = emptyStack();
    stack = addToast(stack, 'saved', 'success').stack;
    stack = addToast(stack, 'import failed', 'error').stack;
    expect(stack.toasts.map((t) => [t.id, t.message, t.tone, t.count])).toEqual([
      [1, 'saved', 'success', 1],
      [2, 'import failed', 'error', 1],
    ]);
  });

  it('joins a repeat to the toast already showing it, and moves it to the newest place', () => {
    let stack = emptyStack();
    stack = addToast(stack, 'enable audio first', 'warning').stack;
    stack = addToast(stack, 'saved', 'success').stack;
    const again = addToast(stack, 'enable audio first', 'warning');
    expect(again.toast).toEqual({
      id: 1,
      message: 'enable audio first',
      tone: 'warning',
      count: 2,
    });
    expect(again.stack.toasts.map((t) => t.id)).toEqual([2, 1]);
    expect(again.stack.nextId).toBe(3);
    expect(again.dropped).toEqual([]);
  });

  it('keeps the same words in a different tone apart', () => {
    let stack = emptyStack();
    stack = addToast(stack, 'x', 'info').stack;
    stack = addToast(stack, 'x', 'error').stack;
    expect(stack.toasts).toHaveLength(2);
  });

  it('drops the oldest past the cap and says which', () => {
    let stack = emptyStack();
    for (const message of ['a', 'b', 'c']) stack = addToast(stack, message, 'info', 3).stack;
    const added = addToast(stack, 'd', 'info', 3);
    expect(added.stack.toasts.map((t) => t.message)).toEqual(['b', 'c', 'd']);
    expect(added.dropped.map((t) => t.message)).toEqual(['a']);
  });

  it('removes by id, and leaves the stack alone for an id already gone', () => {
    let stack = emptyStack();
    stack = addToast(stack, 'a', 'info').stack;
    stack = addToast(stack, 'b', 'info').stack;
    expect(removeToast(stack, 1).toasts.map((t) => t.message)).toEqual(['b']);
    expect(removeToast(stack, 9).toasts).toHaveLength(2);
  });

  it('keeps an error up until it is dismissed, and times the rest', () => {
    expect(toastDuration('error')).toBeNull();
    for (const tone of ['info', 'success', 'warning'] as const)
      expect(toastDuration(tone)).toBe(TOAST_DURATION_MS[tone]);
    expect(toastDuration('warning')! > toastDuration('info')!).toBe(true);
  });
});
