/** The persistence request: once per page, on the first write, a refusal reported and never fatal. */
import { describe, expect, it } from 'vitest';

import { persistOnce } from './storagePersistence';

describe('persistOnce', () => {
  it('asks once however many writes follow, and is quiet when granted', async () => {
    let asked = 0;
    let refusals = 0;
    const ensure = persistOnce(
      () => {
        asked++;
        return Promise.resolve(true);
      },
      () => refusals++,
    );
    await Promise.all([ensure(), ensure()]);
    await ensure();
    expect(asked).toBe(1);
    expect(refusals).toBe(0);
  });

  it('reports a refusal, a failure, or a browser without the request, once each', async () => {
    for (const persist of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error('no')),
      null,
    ]) {
      let refusals = 0;
      const ensure = persistOnce(persist, () => refusals++);
      await ensure();
      await ensure();
      expect(refusals).toBe(1);
    }
  });
});
