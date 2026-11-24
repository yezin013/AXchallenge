import { describe, expect, it } from 'vitest';
import { findMissing } from './missing';
import { computeOutcome } from './outcome';
import { S1, S2, type SessionData } from './model';
import { blankJudge, blankTeam } from './store';

function base(): SessionData {
  const j = { ...blankJudge(true), name: '위원1' };
  const t = { ...blankTeam(1, null), org: '기관', teamName: '팀' };
  const levels = Object.fromEntries(S1.criteria.map((c) => [c.key, 0]));
  return { judges: [j], teams: [t], scores: { [j.id]: { [t.id]: { levels, recused: false } } }, signatures: {}, locked: false };
}
// 의견 칸(구동 확인 결과 등)을 쓰는 평가표 설정으로 검사한다. 통합본(11/18) 기준 세션1·2 결선 평가표에는 의견 칸이 없다
const OP = { ...S1, opinion: true };
const labels = (d: SessionData) => findMissing(OP, d, computeOutcome(OP, d)).map((m) => m.label);

describe('미입력 항목', () => {
  it('점수를 다 넣어도 구동 확인 결과가 없으면 알린다', () => {
    expect(labels(base())).toEqual(['위원1 위원 · 발표 1번 팀 — 구동 확인 결과 미선택']);
  });
  it('구동 불가를 고르고 사유가 비면 알린다', () => {
    const d = base();
    const e = d.scores[d.judges[0].id][d.teams[0].id];
    e.run = 'fail';
    expect(labels(d)).toEqual(['위원1 위원 · 발표 1번 팀 — 구동 불가 사유 미입력']);
    e.runReason = '실행 오류';
    expect(labels(d)).toEqual([]);
  });
  it('회피한 팀은 점수·구동 확인을 묻지 않는다', () => {
    const d = base();
    d.scores[d.judges[0].id][d.teams[0].id] = { levels: {}, recused: true };
    expect(labels(d)).toEqual([]);
  });
  it('빠진 지표 이름을 알려 준다', () => {
    const d = base();
    const e = d.scores[d.judges[0].id][d.teams[0].id];
    e.run = 'ok';
    e.levels.creative = null;
    expect(labels(d)).toEqual(['위원1 위원 · 발표 1번 팀 — 창의성 미입력']);
  });
});

describe('세션2 결선', () => {
  it('결선 평가표(붙임5)에 없는 구동 확인 결과는 묻지 않는다', () => {
    const j = { ...blankJudge(true), name: '위원1' };
    const t = { ...blankTeam(1, 'baton' as const), org: '기관', teamName: '팀' };
    const levels = Object.fromEntries(S2.criteria.map((c) => [c.key, 0]));
    const d: SessionData = { judges: [j], teams: [t], scores: { [j.id]: { [t.id]: { levels, recused: false } } }, signatures: {}, locked: false };
    expect(findMissing(S2, d, computeOutcome(S2, d))).toEqual([]);
  });
});
