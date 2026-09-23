/** Per-bank variation; injectable randomness never enters shared simulation. */
export class SfxSelection {
  private bag: number[] = [];
  private last = -1;

  constructor(
    private readonly count: number,
    private readonly mode: 'shuffle' | 'round-robin' = 'shuffle',
    private readonly random: () => number = Math.random,
  ) {
    if (!Number.isInteger(count) || count < 1) throw new Error('Empty SFX bank');
  }

  next(): number {
    if (this.mode === 'round-robin') return (this.last = (this.last + 1) % this.count);
    if (this.bag.length === 0) this.refill();
    return (this.last = this.bag.pop()!);
  }

  private refill(): void {
    this.bag = Array.from({ length: this.count }, (_, i) => i);
    for (let i = this.count - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
    }
    const end = this.count - 1;
    if (this.count > 1 && this.bag[end] === this.last) {
      [this.bag[0], this.bag[end]] = [this.bag[end]!, this.bag[0]!];
    }
  }
}
