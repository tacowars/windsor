import { describe, expect, it } from 'vitest';
import { createScopeTap } from './scopeTap';

/** A node that records its links, and throws on disconnect once gone, as a disposed one does. */
class StubNode {
  readonly links = new Set<unknown>();
  connects = 0;
  gone = false;
  connect(to: unknown): void {
    this.connects++;
    this.links.add(to);
  }
  disconnect(from: unknown): void {
    if (this.gone || !this.links.has(from)) {
      throw new DOMException('not connected', 'InvalidAccessError');
    }
    this.links.delete(from);
  }
}

const asNode = (n: StubNode | null): AudioNode | null => n as unknown as AudioNode | null;

const setup = () => {
  const analyser = {} as AnalyserNode;
  const tap = createScopeTap(() => analyser);
  return { analyser, follow: (n: StubNode | null) => tap.follow(asNode(n)) };
};

describe('createScopeTap', () => {
  it('connects on the first call and is a no-op on the same node', () => {
    const { analyser, follow } = setup();
    const a = new StubNode();
    follow(a);
    follow(a);
    expect(a.connects).toBe(1);
    expect(a.links.has(analyser)).toBe(true);
  });

  it('disconnects the previous node before connecting a new one', () => {
    const { analyser, follow } = setup();
    const a = new StubNode();
    const b = new StubNode();
    follow(a);
    follow(b);
    expect(a.links.has(analyser)).toBe(false);
    expect(b.links.has(analyser)).toBe(true);
  });

  it('moves on when the previous node was already disconnected by its disposal', () => {
    const { analyser, follow } = setup();
    const a = new StubNode();
    const b = new StubNode();
    follow(a);
    a.gone = true;
    expect(() => follow(b)).not.toThrow();
    expect(b.links.has(analyser)).toBe(true);
  });

  it('rethrows anything else a disconnect throws', () => {
    const { follow } = setup();
    const a = new StubNode();
    follow(a);
    a.disconnect = () => {
      throw new Error('boom');
    };
    expect(() => follow(null)).toThrow('boom');
  });

  it('leaves the analyser unfed on null', () => {
    const { analyser, follow } = setup();
    const a = new StubNode();
    follow(a);
    follow(null);
    expect(a.links.has(analyser)).toBe(false);
    follow(null);
    follow(a);
    expect(a.links.has(analyser)).toBe(true);
  });

  it('connects nothing until there is an analyser', () => {
    let analyser: AnalyserNode | null = null;
    const tap = createScopeTap(() => analyser);
    const a = new StubNode();
    tap.follow(asNode(a));
    expect(a.connects).toBe(0);
    analyser = {} as AnalyserNode;
    tap.follow(asNode(a));
    expect(a.links.has(analyser)).toBe(true);
  });
});
