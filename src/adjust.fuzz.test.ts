import { expect, it } from 'vitest';
import { planTeamFinal } from './adjust';
import { trimmedMean } from './calc';

it('무작위 점수·목표에서도 가장 가까운 최종 점수가 된다', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 3000; k++) {
    const n = 1 + Math.floor(rnd() * 7);
    const totals = Array.from({ length: n }, () => Math.floor(rnd() * 101));
    const target = Math.round(rnd() * 10000) / 100;
    const out = planTeamFinal(totals, target, 100);
    const m = n < 3 ? n : n - 2;
    const want = Math.round(target * m) / m;
    expect(Math.abs((trimmedMean(out)?.value ?? -1) - want)).toBeLessThan(0.006);
    for (const v of out) expect(Number.isInteger(v) && v >= 0 && v <= 100).toBe(true);
  }
});
