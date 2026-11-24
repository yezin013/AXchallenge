// 운영진 점수 조정 계산 (최종 집계표)
import { critPoints, type Adjustment, type ScoreEntry, type SessionConfig } from './model';

// 총점을 지표별 점수에 배분한다. 올릴 때는 지표마다 남은 여유(배점 − 현재 점수)에 비례해 올리고,
// 내릴 때는 현재 점수에 비례해 내린다. 결과는 정수이고 합이 정확히 total 이다.
export function distributeTotal(scores: number[], total: number, maxima: number[]): number[] {
  const cap = maxima.reduce((n, v) => n + v, 0);
  if (!Number.isInteger(total) || total < 0 || total > cap) throw new Error('총점 범위를 확인하시기 바랍니다.');
  const base = scores.map((v, i) => Math.max(0, Math.min(maxima[i], Number(v) || 0)));
  const sum = base.reduce((n, v) => n + v, 0);
  const raw = base.map((v, i) => (total >= sum ? v + (cap === sum ? 0 : ((total - sum) * (maxima[i] - v)) / (cap - sum)) : sum ? (v * total) / sum : 0));
  const out = raw.map(Math.floor);
  const order = raw.map((v, i) => ({ i, f: v - out[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
  let left = total - out.reduce((n, v) => n + v, 0);
  for (const { i } of order) {
    if (left > 0 && out[i] < maxima[i]) {
      out[i] += 1;
      left -= 1;
    }
  }
  // 반올림 몫이 배점에 막힌 경우: 여유가 있는 지표에 마저 넣는다
  for (let i = 0; left > 0 && i < out.length; i++) {
    const room = Math.min(left, maxima[i] - out[i]);
    out[i] += room;
    left -= room;
  }
  return out;
}

// 집계에 들어가는 점수 합: 3명 이상이면 최고·최저 하나씩 제외, 그보다 적으면 전부
function countedSum(values: number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  return values.length < 3 ? sum : sum - Math.max(...values) - Math.min(...values);
}

// 팀의 최종 점수(트림평균)가 target 에 가장 가깝게 되도록 위원별 총점을 고친다.
// 먼저 전원을 같은 폭으로 옮겨 위원 간 차이를 유지하고, 남는 1점 단위는 한 명씩 조정한다.
// 반환: 새 위원별 총점 (입력과 같은 순서). 점수는 정수 0~max.
export function planTeamFinal(totals: number[], target: number, max: number): number[] {
  const n = totals.length;
  if (n === 0) return [];
  const m = n < 3 ? n : n - 2;
  const want = Math.max(0, Math.min(m * max, Math.round(target * m)));
  const out = totals.map((v) => Math.round(v));
  const shift = Math.trunc((want - countedSum(out)) / m);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(max, out[i] + shift));
  for (let guard = 0; guard < 100 * n + 10; guard++) {
    const cur = countedSum(out);
    if (cur === want) break;
    const step = cur < want ? 1 : -1;
    // 점수가 낮은 위원부터(내릴 때는 높은 위원부터) 1점씩 옮겨 보고, 집계 합이 원하는 쪽으로 움직이는 첫 위원을 고른다
    const idx = out.map((_, i) => i).sort((a, b) => (out[a] - out[b]) * step || a - b);
    let moved = false;
    for (const i of idx) {
      const v = out[i] + step;
      if (v < 0 || v > max) continue;
      out[i] = v;
      if ((countedSum(out) - cur) * step > 0) {
        moved = true;
        break;
      }
      out[i] = v - step;
    }
    if (!moved) {
      // 한 명만 옮겨서는 합이 안 바뀌는 경우(점수가 같은 위원이 여럿): 반대쪽 끝 위원을 먼저 옮겨
      // 제외되는 최고·최저 자리로 보내면, 다음 차례에 다른 위원을 옮길 때 합이 바뀐다
      const i = [...idx].reverse().find((k) => out[k] + step >= 0 && out[k] + step <= max);
      if (i === undefined) break;
      out[i] += step;
    }
  }
  return out;
}

// 조정 전(심사위원이 낸) 지표별 점수와 총점
export function rawCrit(cfg: SessionConfig, e: ScoreEntry): number[] {
  return cfg.criteria.map((c) => {
    const lv = e.levels[c.key];
    return lv === null || lv === undefined ? 0 : critPoints(cfg, c.max, lv);
  });
}

// 지금 집계에 쓰이는 지표별 점수 (조정이 있으면 조정값)
export function currentCrit(cfg: SessionConfig, e: ScoreEntry): number[] {
  const adj = e.adj;
  return adj ? cfg.criteria.map((c) => adj.crit[c.key] ?? 0) : rawCrit(cfg, e);
}

// 조정 내용을 점수에 반영한 새 entry. 직전 조정은 이력(adjLog)으로 옮긴다. adj = null 이면 원래 점수로 되돌린다
export function applyAdjustment(e: ScoreEntry, adj: Adjustment | null): ScoreEntry {
  const log = [...(e.adjLog ?? []), ...(e.adj ? [e.adj] : [])].slice(-30);
  return { ...e, adj, adjLog: log.length ? log : undefined };
}

export function makeAdjustment(cfg: SessionConfig, crit: number[], reason: string): Adjustment {
  return {
    total: crit.reduce((a, b) => a + b, 0),
    crit: Object.fromEntries(cfg.criteria.map((c, i) => [c.key, crit[i]])),
    reason: reason.trim(),
    at: new Date().toISOString(),
  };
}
