import { describe, expect, it } from 'vitest';
import { S2, type SessionData } from '../model';
import { blankJudge, blankTeam } from '../store';
import { FIELD_MAX, buildJudgeView, configOf, diffApp, validConfig, validEntry } from './protocol';

function session(): SessionData {
  const judges = [0, 1, 2].map((i) => ({ ...blankJudge(i === 0), name: `위원${i + 1}` }));
  const teams = [1, 2].map((i) => ({ ...blankTeam(i, 'baton' as const), org: `기관${i}`, teamName: `팀${i}`, prelimScore: 80 + i }));
  const scores: SessionData['scores'] = {};
  judges.forEach((j, ji) => {
    scores[j.id] = {};
    teams.forEach((t, ti) => {
      scores[j.id][t.id] = { levels: { use: ji, done: ti, spread: 0 }, recused: false };
    });
  });
  return { judges, teams, scores, signatures: {}, locked: false };
}

describe('심사위원 화면 정보', () => {
  it('다른 위원의 점수와 예선 점수를 보내지 않는다', () => {
    const d = session();
    const me = d.judges[1].id;
    const access = Object.fromEntries(d.judges.map((j) => [j.id, { code: 'x', submittedAt: '2026-11-25T01:00:00Z' }]));
    const v = buildJudgeView('s2', d, '2026-11-25', me, access);
    expect(v).not.toBeNull();
    expect(Object.keys(v?.scores ?? {})).toEqual(Object.keys(d.scores[me]));
    expect(v?.scores).toEqual(d.scores[me]);
    expect(v?.teams.every((t) => t.prelimScore === null)).toBe(true);
    const text = JSON.stringify(v);
    for (const j of d.judges) if (j.id !== me) expect(text).not.toContain(j.id);
  });

  it('전원이 제출하기 전에는 결과를 주지 않는다', () => {
    const d = session();
    const access = { [d.judges[0].id]: { code: 'a', submittedAt: '2026-11-25T01:00:00Z' } };
    const v = buildJudgeView('s2', d, '2026-11-25', d.judges[0].id, access);
    expect(v?.result).toBeNull();
    expect(v?.submittedCount).toBe(1);
    expect(v?.judgeCount).toBe(3);
  });

  it('명단에서 빠진 위원은 화면을 받을 수 없다', () => {
    const d = session();
    d.judges[2] = { ...d.judges[2], active: false };
    expect(buildJudgeView('s2', d, '2026-11-25', d.judges[2].id, {})).toBeNull();
  });
});

describe('입력값 검사', () => {
  it('지표에 없는 키나 범위를 벗어난 등급을 거부한다', () => {
    expect(validEntry(S2, { levels: { use: 0 }, recused: false })).toBe(true);
    expect(validEntry(S2, { levels: { creative: 0 }, recused: false })).toBe(false);
    expect(validEntry(S2, { levels: { use: 5 }, recused: false })).toBe(false);
    expect(validEntry(S2, { levels: { use: 0 }, recused: 'no' })).toBe(false);
  });
});

describe('변경분 계산', () => {
  it('바뀐 점수 칸만 보낸다', () => {
    const d = session();
    const prev = { version: 1 as const, eventDate: '2026-11-25', sessions: { s1: d, s2: d } };
    const j = d.judges[0].id;
    const t = d.teams[0].id;
    const s2 = { ...d, scores: { ...d.scores, [j]: { ...d.scores[j], [t]: { levels: { use: 4 }, recused: false } } } };
    const next = { ...prev, sessions: { ...prev.sessions, s2 } };
    expect(diffApp(prev, next)).toEqual([{ kind: 'score', sid: 's2', jid: j, tid: t, entry: { levels: { use: 4 }, recused: false } }]);
  });

  it('명단이 바뀌면 설정 저장을 맨 앞에 넣는다', () => {
    const d = session();
    const prev = { version: 1 as const, eventDate: '2026-11-25', sessions: { s1: d, s2: d } };
    const next = { ...prev, sessions: { ...prev.sessions, s1: { ...d, judges: [...d.judges] } } };
    expect(diffApp(prev, next)).toEqual([{ kind: 'config' }]);
  });
});

describe('저장 크기 상한', () => {
  it('세션2 점수는 등급만 받고 의견 글은 거부한다', () => {
    expect(validEntry(S2, { levels: { use: 0 }, recused: false, strengths: '' })).toBe(true);
    expect(validEntry(S2, { levels: { use: 0 }, recused: false, strengths: '가'.repeat(10) })).toBe(false);
    expect(validEntry(S2, { levels: { use: 0 }, recused: false, run: 'ok' })).toBe(false);
  });

  it('명단·팀 칸이 200자를 넘으면 설정을 거부한다', () => {
    const d = session();
    const app = { version: 1 as const, eventDate: '2026-11-25', sessions: { s1: d, s2: d } };
    expect(validConfig(configOf(app, 1))).toBe(true);
    const long = { ...d, teams: d.teams.map((t, i) => (i === 0 ? { ...t, work: '가'.repeat(FIELD_MAX + 1) } : t)) };
    expect(validConfig(configOf({ ...app, sessions: { s1: d, s2: long } }, 1))).toBe(false);
  });
});
