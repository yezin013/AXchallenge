import { describe, expect, it } from 'vitest';
import { distributeTotal, planTeamFinal } from './adjust';
import { trimmedMean } from './calc';

const MAX = [40, 30, 30];

describe('총점을 지표별 점수에 배분', () => {
  it('합이 정확히 총점이고 배점을 넘지 않는다', () => {
    for (const total of [0, 1, 37, 64, 88, 99, 100]) {
      const out = distributeTotal([32, 24, 18], total, MAX);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      out.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(MAX[i]);
      });
    }
  });
  it('총점이 같으면 그대로 둔다', () => {
    expect(distributeTotal([32, 24, 18], 74, MAX)).toEqual([32, 24, 18]);
  });
  it('만점·0점', () => {
    expect(distributeTotal([32, 24, 18], 100, MAX)).toEqual([40, 30, 30]);
    expect(distributeTotal([32, 24, 18], 0, MAX)).toEqual([0, 0, 0]);
  });
  it('범위 밖 총점은 거부', () => {
    expect(() => distributeTotal([32, 24, 18], 101, MAX)).toThrow();
    expect(() => distributeTotal([32, 24, 18], 70.5, MAX)).toThrow();
  });
});

describe('팀 최종 점수에 맞춰 위원별 총점 조정', () => {
  const final = (v: number[]) => trimmedMean(v)?.value;
  it('5명: 트림평균이 목표가 된다', () => {
    const out = planTeamFinal([100, 80, 60, 86, 20], 90, 100);
    expect(final(out)).toBe(90);
    out.forEach((v) => {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
  it('7명·모두 같은 점수에서도 목표가 된다', () => {
    expect(final(planTeamFinal([80, 80, 80, 80, 80, 80, 80], 83, 100))).toBe(83);
    expect(final(planTeamFinal([80, 80, 80, 80, 80, 80, 80], 77.4, 100))).toBe(77.4);
  });
  it('딱 떨어지지 않는 목표는 가장 가까운 점수로', () => {
    // 5명이면 3명 평균이라 1/3 단위: 85.5 → 85.67 (합 257)
    expect(final(planTeamFinal([90, 85, 80, 70, 60], 85.5, 100))).toBe(85.67);
  });
  it('위원 간 순서를 유지한다(같은 폭 이동)', () => {
    expect(planTeamFinal([90, 80, 70, 60, 50], 80, 100)).toEqual([100, 90, 80, 70, 60]);
  });
  it('0점·만점 경계', () => {
    expect(final(planTeamFinal([90, 85, 80, 70, 60], 100, 100))).toBe(100);
    expect(final(planTeamFinal([90, 85, 80, 70, 60], 0, 100))).toBe(0);
  });
  it('2명 이하(산술평균)', () => {
    expect(final(planTeamFinal([70, 80], 90, 100))).toBe(90);
  });
});
