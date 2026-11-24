import { useEffect, useReducer } from 'react';
import { type AppData, type Judge, type SessionData, type SessionId, type Team, SESSIONS } from './model';

// 샘플 미리보기 빌드는 저장 공간을 따로 써서 실제 심사 데이터와 섞이지 않게 한다
export const DEMO = import.meta.env.VITE_DEMO === '1';
const KEY = DEMO ? 'ai-challenge-2026-final-judging-sample' : 'ai-challenge-2026-final-judging';

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function blankTeam(order: number, task: Team['task']): Team {
  return {
    id: uid('t'),
    order,
    task,
    org: '',
    teamName: '',
    work: '',
    presenter: '',
    prelimScore: null,
    withdrawn: false,
    awardWithheld: false,
    tieOrder: null,
    grandTieOrder: null,
  };
}

export function blankJudge(isChair: boolean): Judge {
  return { id: uid('j'), name: '', org: '', position: '', isChair, active: true };
}

function initialSession(id: SessionId): SessionData {
  const cfg = SESSIONS[id];
  const teams: Team[] = [];
  if (cfg.tasks) {
    let order = 1;
    for (const t of cfg.tasks) for (let i = 0; i < cfg.defaultTeams; i++) teams.push(blankTeam(order++, t.id));
  } else {
    for (let i = 1; i <= cfg.defaultTeams; i++) teams.push(blankTeam(i, null));
  }
  const judges = Array.from({ length: 5 }, (_, i) => blankJudge(i === 0));
  return { judges, teams, scores: {}, signatures: {}, locked: false };
}

export function initialData(): AppData {
  const data: AppData = { version: 1, eventDate: '2026-11-25', sessions: { s1: initialSession('s1'), s2: initialSession('s2') } };
  return DEMO ? fillSample(data) : data;
}

// 서명 화면 확인용 샘플: 이름은 모두 '샘플', 점수는 고정 난수로 채움
function fillSample(data: AppData): AppData {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const id of ['s1', 's2'] as const) {
    const s = data.sessions[id];
    s.judges = s.judges.map((j, i) => ({ ...j, name: `샘플위원${i + 1}`, org: '샘플기관', position: '위원' }));
    const topics = SESSIONS[id].topics;
    s.teams = s.teams.map((t, i) => ({ ...t, org: `샘플기관${i + 1}`, teamName: `샘플팀${i + 1}`, work: '샘플작품', prelimScore: 70 + i, topic: topics ? topics[i % (topics.length - 1)] : null }));
    s.judges.forEach((j, ji) => {
      s.scores[j.id] = {};
      s.teams.forEach((t, ti) => {
        const levels: Record<string, number | null> = {};
        SESSIONS[id].criteria.forEach((c) => {
          const lv = Math.min(4, Math.floor(rnd() * 3) + (ti > 5 ? 1 : 0));
          levels[c.key] = SESSIONS[id].scale === 'points' ? Math.round(c.max * (1 - lv * 0.2)) : lv;
        });
        s.scores[j.id][t.id] = { levels, recused: id === 's1' && ji === 4 && ti === 2, run: ti === 6 && ji === 1 ? 'partial' : 'ok', strengths: '샘플 강점 의견', improve: '샘플 보완 의견' };
      });
    });
  }
  return data;
}

function isAppData(v: unknown): v is AppData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { version?: unknown; sessions?: unknown };
  if (o.version !== 1 || typeof o.sessions !== 'object' || o.sessions === null) return false;
  const s = o.sessions as Record<string, unknown>;
  return ['s1', 's2'].every((k) => {
    const d = s[k] as Partial<SessionData> | undefined;
    return !!d && Array.isArray(d.judges) && Array.isArray(d.teams) && typeof d.scores === 'object';
  });
}

export function parseBackup(text: string): AppData | null {
  try {
    const v: unknown = JSON.parse(text);
    return isAppData(v) ? v : null;
  } catch {
    return null;
  }
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = parseBackup(raw);
      if (parsed) return parsed;
    }
  } catch {
    // 저장소 접근 불가(사생활 보호 모드 등) → 새로 시작
  }
  return initialData();
}

export type Action =
  | { type: 'replace'; data: AppData }
  | { type: 'eventDate'; value: string }
  | { type: 'session'; id: SessionId; update: (s: SessionData) => SessionData };

export function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'replace':
      return action.data;
    case 'eventDate':
      return { ...state, eventDate: action.value };
    case 'session':
      return { ...state, sessions: { ...state.sessions, [action.id]: action.update(state.sessions[action.id]) } };
  }
}

export type Store = readonly [AppData, (action: Action) => void];

export function useAppStore(): Store {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 저장 실패 시에도 화면은 계속 동작. 백업 파일 저장을 안내한다.
    }
  }, [state]);
  return [state, dispatch] as const;
}
