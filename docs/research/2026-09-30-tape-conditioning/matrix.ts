import { CONDITIONING as K, EXPERIMENT as E, REFERENCE as R } from './conditioningConstants';
export type Case = {
  id: string;
  domain: 'center' | 'corner' | 'boundary';
  rate: number;
  controls: number[];
  policy: (typeof K.policies)[number];
  bins: number[];
  amplitude: number;
  sign: number;
  level?: number;
  history?: number;
};
export function matrix(): Case[] {
  const corners = K.endpoints.flatMap((d) =>
    K.endpoints.flatMap((w) => K.endpoints.map((s) => [d, w, s])),
  );
  const rows: Case[] = [];
  const add = (base: Omit<Case, 'id' | 'policy' | 'rate'>) => {
    for (const rate of E.rates)
      for (const policy of K.policies) {
        const row = { ...base, rate, policy };
        rows.push({
          ...row,
          id: [
            base.domain,
            base.controls.join(':'),
            base.bins.join('+'),
            base.amplitude,
            base.sign,
            base.level ?? '',
            base.history ?? '',
            rate,
            policy,
          ].join('/'),
        });
      }
  };
  for (const level of K.boundaryLevels)
    add({
      domain: 'boundary',
      controls: K.center,
      bins: [0],
      amplitude: 1,
      sign: 1,
      level,
      history: 0,
    });
  for (const controls of corners)
    for (const level of K.cornerLevels)
      add({ domain: 'boundary', controls, bins: [0], amplitude: 1, sign: 1, level, history: 0 });
  for (const history of K.histories)
    for (const level of K.historyLevels)
      add({
        domain: 'boundary',
        controls: K.center,
        bins: [0],
        amplitude: 1,
        sign: 1,
        level,
        history,
      });
  for (const controls of corners)
    for (const bin of K.anchorBins)
      for (const sign of R.histories)
        add({ domain: 'corner', controls, bins: [bin], amplitude: 1, sign });
  for (const bins of [...E.bins.map((b) => [b]), R.twoToneBins])
    for (const amplitude of R.normalLevels)
      for (const sign of R.histories)
        add({ domain: 'center', controls: K.center, bins, amplitude, sign });
  return rows;
}
