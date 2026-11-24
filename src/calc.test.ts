import { describe, expect, it } from 'vitest';
import { computeTeam, rankTeams, round2, s1Award, s2Outcome, trimmedMean, digestOf } from './calc';
import { S1, S2, levelPoints, type SessionData, type Team } from './model';
import { blankJudge, blankTeam } from './store';

// levels: 0=매우우수 ... 4=매우미흡. 세션1은 점수 직접 기재라 같은 비율(100·80·60·40·20%)의 점수로 바꿔 넣는다
function session(judgeCount: number, teams: Team[]): SessionData {
  const judges = Array.from({ length: judgeCount }, (_, i) => ({ ...blankJudge(i === 0), name: `위원${i + 1}` }));
  return { judges, teams, scores: {}, signatures: {}, locked: false };
}
function setAll(d: SessionData, judgeIdx: number, team: Team, keys: string[], levels: number[]) {
  const j = d.judges[judgeIdx];
  d.scores[j.id] = d.scores[j.id] ?? {};
  const lv: Record<string, number | null> = {};
  keys.forEach((k, i) => {
    const c1 = keys === S1K && S1.scale === 'points' ? S1.criteria.find((c) => c.key === k) : undefined;
    lv[k] = c1 ? levelPoints(c1.max, levels[i]) : levels[i];
  });
  d.scores[j.id][team.id] = { levels: lv, recused: false };
}
const S1K = ['need', 'creative', 'use', 'done', 'spread'];
const S2K = S2.criteria.map((c) => c.key);

describe('산식', () => {
  it('반올림은 둘째 자리', () => {
    expect(round2(84.335)).toBe(84.34);
    expect(round2(256 / 3)).toBe(85.33);
  });
  it('5인 트림평균 = (합계-최고-최저)/3', () => {
    expect(trimmedMean([90, 80, 70, 60, 100])).toEqual({ value: 80, method: 'trim' });
  });
  it('4인(1인 회피)이면 ÷2', () => {
    expect(trimmedMean([90, 80, 70, 60])).toEqual({ value: 75, method: 'trim' });
  });
  it('2인 이하는 산술평균으로 표시', () => {
    expect(trimmedMean([90, 80])).toEqual({ value: 85, method: 'mean' });
  });
});

describe('팀 점수', () => {
  it('세션1 5단계 점수 환산과 트림평균', () => {
    const t = blankTeam(1, null);
    const d = session(5, [t]);
    setAll(d, 0, t, S1K, [0, 0, 0, 0, 0]); // 100
    setAll(d, 1, t, S1K, [1, 1, 1, 1, 1]); // 80
    setAll(d, 2, t, S1K, [2, 2, 2, 2, 2]); // 60
    setAll(d, 3, t, S1K, [1, 0, 1, 1, 1]); // 16+30+16+12+12 = 86
    setAll(d, 4, t, S1K, [4, 4, 4, 4, 4]); // 20
    const r = computeTeam(S1, d, t);
    expect(r.complete).toBe(true);
    expect(r.score).toBe(round2((80 + 60 + 86) / 3));
    expect(r.cells.find((c) => c.judgeId === r.maxJudgeId)?.total).toBe(100);
    expect(r.cells.find((c) => c.judgeId === r.minJudgeId)?.total).toBe(20);
  });
  it('회피 위원 제외, 미입력 위원 있으면 미완료', () => {
    const t = blankTeam(1, null);
    const d = session(5, [t]);
    for (let i = 0; i < 4; i++) setAll(d, i, t, S1K, [1, 1, 1, 1, 1]);
    expect(computeTeam(S1, d, t).complete).toBe(false);
    d.scores[d.judges[4].id] = { [t.id]: { levels: {}, recused: true } };
    const r = computeTeam(S1, d, t);
    expect(r.complete).toBe(true);
    expect(r.validCount).toBe(4);
    expect(r.score).toBe(80);
  });
  it('제외(비활성) 위원 점수는 집계에서 빠짐', () => {
    const t = blankTeam(1, null);
    const d = session(6, [t]);
    for (let i = 0; i < 5; i++) setAll(d, i, t, S1K, [1, 1, 1, 1, 1]);
    setAll(d, 5, t, S1K, [4, 4, 4, 4, 4]);
    d.judges[5].active = false;
    expect(computeTeam(S1, d, t).score).toBe(80);
  });
});

describe('세션1 순위·수상', () => {
  it('동점이면 창의성 트림평균으로 가림', () => {
    const a = blankTeam(1, null);
    const b = blankTeam(2, null);
    const d = session(3, [a, b]);
    for (let i = 0; i < 3; i++) {
      setAll(d, i, a, S1K, [3, 0, 3, 2, 2]); // 8+30+8+9+9 = 64 (창의성 30)
      setAll(d, i, b, S1K, [0, 1, 3, 2, 4]); // 20+24+8+9+3 = 64 (창의성 24)
    }
    const res = [a, b].map((t) => computeTeam(S1, d, t));
    expect(res[0].score).toBe(64);
    expect(res[1].score).toBe(64);
    const ranked = rankTeams(S1, res, false);
    expect(ranked[0].result.team.id).toBe(a.id);
    expect(ranked[1].decidedBy).toBe('창의성 트림평균');
    expect(ranked[1].rank).toBe(2);
  });
  it('완전 동점이 수상 경계에 걸리면 협의 필요, 협의 순서 입력 시 해소', () => {
    const teams = [blankTeam(1, null), blankTeam(2, null)];
    const d = session(3, teams);
    for (let i = 0; i < 3; i++) for (const t of teams) setAll(d, i, t, S1K, [1, 1, 1, 1, 1]);
    let ranked = rankTeams(S1, teams.map((t) => computeTeam(S1, d, t)), false);
    expect(ranked.every((r) => r.tied && r.rank === 1)).toBe(true);
    expect(s1Award(ranked, ranked[0]).kind).toBe('decision');
    const key = [teams[0].id, teams[1].id].sort().join('|');
    teams[0].tieOrder = { key, order: 2 };
    teams[1].tieOrder = { key, order: 1 };
    ranked = rankTeams(S1, teams.map((t) => computeTeam(S1, d, t)), false);
    expect(ranked[0].result.team.id).toBe(teams[1].id);
    expect(ranked[0].manual).toBe(true);
    const aw = s1Award(ranked, ranked[0]);
    expect(aw.kind === 'award' && aw.tier.name).toBe('대상');
    const aw2 = s1Award(ranked, ranked[1]);
    expect(aw2.kind === 'award' && aw2.tier.name).toBe('최우수상');
  });
  it('순위별 수상 구분: 1 대상, 2 최우수, 3~4 우수, 5~10 장려', () => {
    const teams = Array.from({ length: 10 }, (_, i) => blankTeam(i + 1, null));
    const d = session(3, teams);
    // 점수를 서로 다르게: 팀 i 는 확산가능성만 다르게 하면 동점이 남으므로 단계 조합을 다르게
    const combos = [
      [0, 0, 0, 0, 0], [0, 0, 0, 0, 1], [0, 0, 0, 1, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1], [1, 1, 1, 1, 2], [1, 1, 1, 2, 2], [1, 1, 2, 2, 2], [1, 2, 2, 2, 2],
    ];
    teams.forEach((t, i) => {
      for (let j = 0; j < 3; j++) setAll(d, j, t, S1K, combos[i]);
    });
    const ranked = rankTeams(S1, teams.map((t) => computeTeam(S1, d, t)), false);
    const names = ranked.map((r) => {
      const a = s1Award(ranked, r);
      return a.kind === 'award' ? a.tier.name : a.kind;
    });
    expect(names).toEqual(['대상', '최우수상', '우수상', '우수상', '장려상', '장려상', '장려상', '장려상', '장려상', '장려상']);
  });
});

describe('세션2 과제별 순위·대상', () => {
  it('과제별 1위 중 최고점 대상, 나머지 최우수, 2위 우수, 3위 장려', () => {
    const tasks = ['baton', 'clerk', 'rule'] as const;
    const teams: Team[] = [];
    let o = 1;
    for (const tk of tasks) for (let i = 0; i < 3; i++) teams.push(blankTeam(o++, tk));
    const d = session(5, teams);
    const lv: Record<string, number[]> = {};
    // 업무바통 1위가 가장 높게
    const plan = [
      [0, 0, 0], [1, 1, 1], [2, 2, 2],
      [0, 0, 1], [1, 1, 2], [2, 2, 3],
      [0, 1, 1], [1, 2, 2], [2, 3, 3],
    ];
    teams.forEach((t, i) => (lv[t.id] = plan[i]));
    for (let j = 0; j < 5; j++) for (const t of teams) setAll(d, j, t, S2K, lv[t.id]);
    const out = s2Outcome(S2, d);
    expect(out.grandReady).toBe(true);
    const name = (t: Team) => {
      const a = out.awards.get(t.id);
      return a && a.kind === 'award' ? a.tier.name : a?.kind;
    };
    expect(teams.map(name)).toEqual(['대상', '우수상', '장려상', '최우수상', '우수상', '장려상', '최우수상', '우수상', '장려상']);
  });
  it('과제 내 총점·지표 동점이면 예선 점수로 가림', () => {
    const a = blankTeam(1, 'baton');
    const b = blankTeam(2, 'baton');
    a.prelimScore = 70;
    b.prelimScore = 80;
    const d = session(3, [a, b]);
    for (let j = 0; j < 3; j++) for (const t of [a, b]) setAll(d, j, t, S2K, [1, 1, 1]);
    const out = s2Outcome(S2, d);
    expect(out.blocks[0].ranked[0].result.team.id).toBe(b.id);
    expect(out.blocks[0].ranked[1].decidedBy).toBe('예선 점수');
  });
  it('입력 미완료 과제가 있으면 대상 미확정', () => {
    const a = blankTeam(1, 'baton');
    const b = blankTeam(2, 'clerk');
    const d = session(3, [a, b]);
    for (let j = 0; j < 3; j++) setAll(d, j, a, S2K, [0, 0, 0]);
    for (let j = 0; j < 2; j++) setAll(d, j, b, S2K, [0, 0, 0]);
    expect(s2Outcome(S2, d).grandReady).toBe(false);
  });
});

describe('서명 지문', () => {
  it('점수가 바뀌면 지문이 달라짐', () => {
    const t = blankTeam(1, null);
    const d = session(3, [t]);
    setAll(d, 0, t, S1K, [1, 1, 1, 1, 1]);
    const before = digestOf(d);
    setAll(d, 0, t, S1K, [1, 1, 1, 1, 2]);
    expect(digestOf(d)).not.toBe(before);
  });
});

describe('협의 순서 유효성', () => {
  it('다른 동점 묶음에서 정한 협의 순서는 적용하지 않음', () => {
    const teams = [blankTeam(1, null), blankTeam(2, null)];
    const d = session(3, teams);
    for (let i = 0; i < 3; i++) for (const t of teams) setAll(d, i, t, S1K, [1, 1, 1, 1, 1]);
    teams[0].tieOrder = { key: 'other|group', order: 1 };
    teams[1].tieOrder = { key: 'other|group', order: 2 };
    const ranked = rankTeams(S1, teams.map((t) => computeTeam(S1, d, t)), false);
    expect(ranked.every((r) => r.tied)).toBe(true);
  });
});
