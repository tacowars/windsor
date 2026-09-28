/** The persistence request: once per page, on the first write, a refusal reported and never fatal. */
import { describe, expect, it } from 'vitest';

import { PERSIST_REFUSED, persistOnce } from './storagePersistence';

describe('persistOnce', () => {
  it('asks once however many writes follow, and is quiet when granted', async () => {
    let asked = 0;
    const reports: string[] = [];
    const ensure = persistOnce(
      () => {
        asked++;
        return Promise.resolve(true);
      },
      (m) => reports.push(m),
    );
    await Promise.all([ensure(), ensure()]);
    await ensure();
    expect(asked).toBe(1);
    expect(reports).toEqual([]);
  });

  it('reports a refusal, a failure, or a browser without the request, once each', async () => {
    for (const persist of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error('no')),
      null,
    ]) {
      const reports: string[] = [];
      const ensure = persistOnce(persist, (m) => reports.push(m));
      await ensure();
      await ensure();
      expect(reports).toEqual([PERSIST_REFUSED]);
    }
  });
});
