import {
  type AwardTier,
  type Judge,
  type SessionConfig,
  type SessionData,
  type Team,
  type TaskId,
  S1_AWARDS,
  S2_AWARDS,
  critPoints,
} from './model';

// 소수점 셋째 자리에서 반올림 → 둘째 자리까지 (심사계획(안) 3. 점수 처리)
export function round2(x: number): number {
  return Math.round(Number((x * 100).toPrecision(12))) / 100;
}

export type JudgeStatus = 'done' | 'pending' | 'recused';

export interface JudgeCell {
  judgeId: string;
  status: JudgeStatus;
  total: number | null;
  crit: Record<string, number | null>;
  // 운영진이 총점을 직접 고친 칸: raw = 고치기 전 지표 합계
  adjusted?: boolean;
  raw?: number;
}

export interface TeamResult {
  team: Team;
  cells: JudgeCell[];
  validCount: number;
  pendingCount: number;
  maxJudgeId: string | null;
  minJudgeId: string | null;
  score: number | null;
  method: 'trim' | 'mean' | null;
  critScores: Record<string, number | null>;
  complete: boolean;
}

// 결선 산식: (합계 − 최고점 − 최저점) ÷ (심사위원 수 − 2). 회피 위원은 빼고 같은 산식.
// 유효 점수가 3개 미만이면 최고·최저를 뺄 수 없으므로 산술평균으로 표시하고 경고한다.
export function trimmedMean(values: number[]): { value: number; method: 'trim' | 'mean' } | null {
  if (values.length === 0) return null;
  if (values.length < 3) {
    return { value: round2(values.reduce((a, b) => a + b, 0) / values.length), method: 'mean' };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { value: round2((sum - max - min) / (values.length - 2)), method: 'trim' };
}

export function activeJudges(data: SessionData): Judge[] {
  return data.judges.filter((j) => j.active);
}

export function computeTeam(cfg: SessionConfig, data: SessionData, team: Team): TeamResult {
  const judges = activeJudges(data);
  const cells: JudgeCell[] = judges.map((j) => {
    const entry = data.scores[j.id]?.[team.id];
    if (entry?.recused) {
      return { judgeId: j.id, status: 'recused', total: null, crit: {} };
    }
    const crit: Record<string, number | null> = {};
    let total = 0;
    let filled = 0;
    for (const c of cfg.criteria) {
      const lv = entry?.levels[c.key];
      if (lv === null || lv === undefined) {
        crit[c.key] = null;
      } else {
        const p = critPoints(cfg, c.max, lv);
        crit[c.key] = p;
        total += p;
        filled += 1;
      }
    }
    const done = filled === cfg.criteria.length;
    if (done && entry?.adj) return { judgeId: j.id, status: 'done', total: entry.adj.total, crit: Object.fromEntries(cfg.criteria.map((c) => [c.key, entry.adj?.crit[c.key] ?? 0])), adjusted: true, raw: round2(total) };
    return { judgeId: j.id, status: done ? 'done' : 'pending', total: done ? round2(total) : null, crit };
  });

  const valid = cells.filter((c) => c.status === 'done');
  const pendingCount = cells.filter((c) => c.status === 'pending').length;
  const tm = trimmedMean(valid.map((c) => c.total as number));

  let maxJudgeId: string | null = null;
  let minJudgeId: string | null = null;
  if (tm?.method === 'trim') {
    // 같은 점수가 여럿이면 하나만 제외 대상으로 표시
    let maxV = -Infinity;
    let minV = Infinity;
    for (const c of valid) {
      const t = c.total as number;
      if (t > maxV) {
        maxV = t;
        maxJudgeId = c.judgeId;
      }
    }
    for (const c of valid) {
      const t = c.total as number;
      if (t < minV && c.judgeId !== maxJudgeId) {
        minV = t;
        minJudgeId = c.judgeId;
      }
    }
    if (minJudgeId === null) {
      // 모든 점수가 같은 경우
      minJudgeId = valid.find((c) => c.judgeId !== maxJudgeId)?.judgeId ?? null;
    }
  }

  const critScores: Record<string, number | null> = {};
  for (const c of cfg.criteria) {
    const r = trimmedMean(valid.map((v) => v.crit[c.key] as number));
    critScores[c.key] = r ? r.value : null;
  }

  const complete = judges.length > 0 && pendingCount === 0 && valid.length > 0;
  return {
    team,
    cells,
    validCount: valid.length,
    pendingCount,
    maxJudgeId,
    minJudgeId,
    score: complete && tm ? tm.value : null,
    method: complete && tm ? tm.method : null,
    critScores,
    complete,
  };
}

export interface RankedTeam {
  result: TeamResult;
  rank: number;
  tied: boolean; // 규정으로도 가려지지 않은 동점
  manual: boolean; // 심사위원 협의로 순서를 정함
  decidedBy: string | null; // 총점이 같아 동점 규정으로 순서가 정해졌을 때 그 기준
}

function compareKeys(cfg: SessionConfig, usePrelim: boolean) {
  return (a: TeamResult, b: TeamResult): { diff: number; by: string | null } => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return { diff: sb - sa, by: null };
    for (const k of cfg.tieBreak) {
      const va = a.critScores[k] ?? -1;
      const vb = b.critScores[k] ?? -1;
      if (va !== vb) {
        const label = cfg.criteria.find((c) => c.key === k)?.label ?? k;
        return { diff: vb - va, by: `${label} 트림평균` };
      }
    }
    if (usePrelim) {
      const pa = a.team.prelimScore ?? -1;
      const pb = b.team.prelimScore ?? -1;
      if (pa !== pb) return { diff: pb - pa, by: '예선 점수' };
    }
    return { diff: 0, by: null };
  };
}

export function tieKey(group: TeamResult[]): string {
  return group.map((r) => r.team.id).sort().join("|");
}

// 경쟁 순위(1,2,2,4). 규정으로 못 가린 동점은 tieOrder(협의 결과)가 모두 다르게 지정되면 그 순서를 따른다.
export function rankTeams(
  cfg: SessionConfig,
  results: TeamResult[],
  usePrelim: boolean,
  orderField: 'tieOrder' | 'grandTieOrder' = 'tieOrder',
): RankedTeam[] {
  const cmp = compareKeys(cfg, usePrelim);
  const sorted = [...results].sort((a, b) => cmp(a, b).diff || a.team.order - b.team.order);

  // 동점 묶음 만들기
  const groups: TeamResult[][] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last && cmp(last[0], r).diff === 0) last.push(r);
    else groups.push([r]);
  }

  const out: RankedTeam[] = [];
  let position = 1;
  for (const g of groups) {
    if (g.length === 1) {
      const prev = out[out.length - 1];
      const by = prev ? cmp(prev.result, g[0]).by : null;
      out.push({ result: g[0], rank: position, tied: false, manual: false, decidedBy: by });
    } else {
      const key = tieKey(g);
      const orders = g.map((r) => {
        const o = r.team[orderField];
        return o && o.key === key ? o.order : null;
      });
      const allSet = orders.every((o) => o !== null);
      const distinct = new Set(orders).size === g.length;
      if (allSet && distinct) {
        const pos = new Map(g.map((r, i) => [r.team.id, orders[i] as number]));
        const byOrder = [...g].sort((a, b) => (pos.get(a.team.id) as number) - (pos.get(b.team.id) as number));
        byOrder.forEach((r, i) =>
          out.push({ result: r, rank: position + i, tied: false, manual: true, decidedBy: '심사위원 협의' }),
        );
      } else {
        for (const r of g) out.push({ result: r, rank: position, tied: true, manual: false, decidedBy: null });
      }
    }
    position += g.length;
  }
  return out;
}

export type AwardState =
  | { kind: 'award'; tier: AwardTier }
  | { kind: 'withheld'; tier: AwardTier }
  | { kind: 'decision' } // 동점이 수상 등급 경계에 걸려 협의 필요
  | { kind: 'none' };

function s1TierAt(position: number): AwardTier | null {
  return S1_AWARDS.find((a) => position >= a.fromRank && position <= a.toRank)?.tier ?? null;
}

function tieGroupSize(ranked: RankedTeam[], rt: RankedTeam): number {
  return rt.tied ? ranked.filter((x) => x.tied && x.rank === rt.rank).length : 1;
}

function applyWithheld(team: Team, tier: AwardTier | null): AwardState {
  if (!tier) return { kind: 'none' };
  return team.awardWithheld ? { kind: 'withheld', tier } : { kind: 'award', tier };
}

export function s1Award(ranked: RankedTeam[], rt: RankedTeam): AwardState {
  const size = tieGroupSize(ranked, rt);
  const tiers = new Set<string>();
  for (let p = rt.rank; p < rt.rank + size; p++) tiers.add(s1TierAt(p)?.key ?? 'none');
  if (tiers.size > 1) return { kind: 'decision' };
  return applyWithheld(rt.result.team, s1TierAt(rt.rank));
}

export interface S2TaskBlock {
  task: { id: TaskId; label: string };
  ranked: RankedTeam[];
  pending: TeamResult[];
}

export interface S2Outcome {
  blocks: S2TaskBlock[];
  firsts: RankedTeam[]; // 과제별 1위(확정된 경우만)
  grandRanked: RankedTeam[]; // 과제별 1위끼리 비교한 순서
  grandReady: boolean;
  awards: Map<string, AwardState>;
}

export function s2Outcome(cfg: SessionConfig, data: SessionData): S2Outcome {
  const tasks = cfg.tasks ?? [];
  const blocks: S2TaskBlock[] = tasks.map((task) => {
    const results = data.teams
      .filter((t) => t.task === task.id && !t.withdrawn)
      .map((t) => computeTeam(cfg, data, t));
    return {
      task,
      ranked: rankTeams(cfg, results.filter((r) => r.complete), true),
      pending: results.filter((r) => !r.complete),
    };
  });

  const awards = new Map<string, AwardState>();
  const firsts: RankedTeam[] = [];
  let firstsClear = true;

  for (const b of blocks) {
    if (b.pending.length > 0) firstsClear = false;
    const ones = b.ranked.filter((r) => r.rank === 1);
    if (ones.length === 1 && !ones[0].tied) firsts.push(ones[0]);
    else if (ones.length > 0) firstsClear = false;

    for (const rt of b.ranked) {
      const size = tieGroupSize(b.ranked, rt);
      const tierAt = (p: number) => (p === 1 ? 'first' : p === 2 ? 'excel' : p === 3 ? 'merit' : 'none');
      const keys = new Set<string>();
      for (let p = rt.rank; p < rt.rank + size; p++) keys.add(tierAt(p));
      if (keys.size > 1) {
        awards.set(rt.result.team.id, { kind: 'decision' });
      } else if (rt.rank === 2) {
        awards.set(rt.result.team.id, applyWithheld(rt.result.team, S2_AWARDS.excel));
      } else if (rt.rank === 3) {
        awards.set(rt.result.team.id, applyWithheld(rt.result.team, S2_AWARDS.merit));
      } else if (rt.rank > 3) {
        awards.set(rt.result.team.id, { kind: 'none' });
      }
    }
  }

  // 대상: 과제별 1위 중 결선 트림평균 최고점, 나머지 최우수상
  const grandRanked = rankTeams(
    cfg,
    firsts.map((f) => f.result),
    true,
    'grandTieOrder',
  );
  const grandTop = grandRanked.filter((g) => g.rank === 1);
  const grandReady = firstsClear && grandTop.length === 1 && !grandTop[0].tied;

  for (const g of grandRanked) {
    const id = g.result.team.id;
    if (!grandReady && g.rank === 1) awards.set(id, { kind: 'decision' });
    else if (g.rank === 1) awards.set(id, applyWithheld(g.result.team, S2_AWARDS.grand));
    else awards.set(id, applyWithheld(g.result.team, S2_AWARDS.top));
  }

  return { blocks, firsts, grandRanked, grandReady, awards };
}

// 서명 후 점수·명단이 바뀌었는지 확인하기 위한 지문 (FNV-1a)
export function digestOf(data: SessionData): string {
  const payload = JSON.stringify({
    judges: data.judges.filter((j) => j.active).map((j) => [j.id, j.name, j.isChair]),
    teams: data.teams.map((t) => [t.id, t.task, t.org, t.teamName, t.work, t.withdrawn, t.awardWithheld, t.tieOrder, t.grandTieOrder, t.prelimScore]),
    scores: data.judges
      .filter((j) => j.active)
      .map((j) => [j.id, data.teams.map((t) => data.scores[j.id]?.[t.id] ?? null)]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
