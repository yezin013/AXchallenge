// 온라인(서버 저장) 모드에서 화면과 서버 함수가 주고받는 형식. 서버·화면이 같이 쓰므로 브라우저 전용 코드를 넣지 않는다.
import type { AwardState } from '../calc';
import {
  type AppData,
  type Judge,
  RUN_CHECKS,
  type ScoreEntry,
  type SessionConfig,
  type SessionData,
  type SessionId,
  type Signature,
  type Team,
  ADJ_REASON_MAX,
  COMMENT_MAX,
  LEVELS,
  validPoints,
  SESSIONS,
} from '../model';
import { computeOutcome } from '../outcome';
import { isDone } from '../scoreOps';

export const SIDS: SessionId[] = ['s1', 's2'];

export interface SessionConfigData {
  judges: Judge[];
  teams: Team[];
  locked: boolean;
}

// 운영진만 바꾸는 설정(명단·팀·잠금). rev 로 동시 수정 충돌을 막는다.
export interface ConfigDoc {
  rev: number;
  eventDate: string;
  sessions: Record<SessionId, SessionConfigData>;
}

export type ScoreMap = Record<string, ScoreEntry>; // teamId → 평가

export interface JudgeAccess {
  code: string;
  submittedAt: string | null;
}

export interface AdminState {
  config: ConfigDoc | null; // null = 아직 한 번도 저장하지 않음
  scores: Record<SessionId, Record<string, ScoreMap>>; // [sid][judgeId][teamId]
  signatures: Record<SessionId, Record<string, Signature>>;
  access: Record<SessionId, Record<string, JudgeAccess>>;
}

export function configOf(app: AppData, rev: number): ConfigDoc {
  const sessions = {} as Record<SessionId, SessionConfigData>;
  for (const sid of SIDS) {
    const s = app.sessions[sid];
    sessions[sid] = { judges: s.judges, teams: s.teams, locked: s.locked };
  }
  return { rev, eventDate: app.eventDate, sessions };
}

export function appOf(config: ConfigDoc, scores: AdminState['scores'], signatures: AdminState['signatures']): AppData {
  const sessions = {} as Record<SessionId, SessionData>;
  for (const sid of SIDS) {
    const c = config.sessions[sid];
    sessions[sid] = { judges: c.judges, teams: c.teams, locked: c.locked, scores: scores[sid] ?? {}, signatures: signatures[sid] ?? {} };
  }
  return { version: 1, eventDate: config.eventDate, sessions };
}

/* ── 입력값 검사 (서버에서 사용) ─────────────────────────── */
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

// 운영진 점수 조정: 지표별 정수 점수(0~배점), 합 = 총점, 사유 필수
function validAdjustment(cfg: SessionConfig, v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  const crit = a.crit as Record<string, unknown> | null;
  if (typeof crit !== 'object' || crit === null) return false;
  let sum = 0;
  for (const c of cfg.criteria) {
    const p = crit[c.key];
    if (!(Number.isInteger(p) && (p as number) >= 0 && (p as number) <= c.max)) return false;
    sum += p as number;
  }
  if (Object.keys(crit).length !== cfg.criteria.length) return false;
  return a.total === sum && typeof a.reason === 'string' && a.reason.trim().length > 0 && a.reason.length <= ADJ_REASON_MAX && str(a.at, 40);
}

export function validEntry(cfg: SessionConfig, v: unknown): v is ScoreEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.recused !== 'boolean' || typeof e.levels !== 'object' || e.levels === null) return false;
  const keys = cfg.criteria.map((c) => c.key);
  for (const [k, lv] of Object.entries(e.levels as Record<string, unknown>)) {
    if (!keys.includes(k)) return false;
    if (lv === null) continue;
    if (cfg.scale === 'points') {
      const max = cfg.criteria.find((c) => c.key === k)?.max ?? 0;
      if (!validPoints(max, lv)) return false;
    } else if (!(Number.isInteger(lv) && (lv as number) >= 0 && (lv as number) < LEVELS.length)) return false;
  }
  if (e.adj !== undefined && e.adj !== null && !validAdjustment(cfg, e.adj)) return false;
  if (e.adjLog !== undefined && !(Array.isArray(e.adjLog) && e.adjLog.length <= 30 && e.adjLog.every((a) => validAdjustment(cfg, a)))) return false;
  if (!cfg.opinion) {
    // 의견 칸이 없는 세션(세션2)은 등급만 받는다
    const empty = (x: unknown) => x === undefined || x === null || x === '';
    return empty(e.strengths) && empty(e.improve) && empty(e.runReason) && empty(e.run);
  }
  if (e.strengths !== undefined && !str(e.strengths, 4000)) return false;
  if (e.improve !== undefined && !str(e.improve, 4000)) return false;
  if (e.runReason !== undefined && !str(e.runReason, 1000)) return false;
  if (e.run !== undefined && e.run !== null && !RUN_CHECKS.some((r) => r.id === e.run)) return false;
  return true;
}

// 명단·팀 칸 글자 수 상한 (저장소 사용량이 입력 내용과 상관없이 정해진 범위 안에 있도록)
export const FIELD_MAX = 200;
const MAX_ROWS = 30;
const optStr = (v: unknown, max: number) => v === undefined || v === null || str(v, max);

function validJudge(v: unknown): boolean {
  const j = v as Partial<Judge> | null;
  return !!j && str(j.id, 64) && str(j.name, FIELD_MAX) && str(j.org, FIELD_MAX) && str(j.position, FIELD_MAX) && typeof j.isChair === 'boolean' && typeof j.active === 'boolean';
}

function validTeam(v: unknown): boolean {
  const t = v as Partial<Team> | null;
  return (
    !!t &&
    str(t.id, 64) &&
    typeof t.order === 'number' &&
    str(t.org, FIELD_MAX) &&
    str(t.teamName, FIELD_MAX) &&
    str(t.work, FIELD_MAX) &&
    str(t.presenter, FIELD_MAX) &&
    optStr(t.topic, FIELD_MAX) &&
    optStr(t.finalComment, COMMENT_MAX) &&
    (t.prelimScore === null || typeof t.prelimScore === 'number')
  );
}

export function validConfig(v: unknown): v is ConfigDoc {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<ConfigDoc>;
  if (typeof c.rev !== 'number' || !str(c.eventDate, 20) || typeof c.sessions !== 'object' || c.sessions === null) return false;
  return SIDS.every((sid) => {
    const s = (c.sessions as Record<string, Partial<SessionConfigData>>)[sid];
    return (
      !!s &&
      Array.isArray(s.judges) &&
      Array.isArray(s.teams) &&
      typeof s.locked === 'boolean' &&
      s.judges.length <= MAX_ROWS &&
      s.teams.length <= MAX_ROWS &&
      s.judges.every(validJudge) &&
      s.teams.every(validTeam)
    );
  });
}

/* ── 심사위원에게 보내는 화면 정보: 다른 위원의 점수는 넣지 않는다 ─────────────────────────── */
export interface JudgeResultRow {
  teamId: string;
  order: number;
  task: Team['task'];
  org: string;
  teamName: string;
  work: string;
  score: number | null; // 트림평균
  rank: number | null;
  tied: boolean;
  award: string;
  myTotal: number | null;
}

export interface JudgeView {
  sid: SessionId;
  eventDate: string;
  judge: Judge;
  judgeIndex: number;
  teams: Team[];
  scores: ScoreMap;
  submittedAt: string | null;
  locked: boolean;
  signature: Signature | null;
  submittedCount: number;
  judgeCount: number;
  // 참여 위원 전원이 제출한 뒤에만 채운다
  result: { rows: JudgeResultRow[]; digest: string; ready: boolean } | null;
}

function awardLabel(a: AwardState | undefined): string {
  if (!a || a.kind === 'none') return '';
  if (a.kind === 'decision') return '협의 필요';
  if (a.kind === 'withheld') return `${a.tier.name}(미수여)`;
  return a.tier.name;
}

// 위원에게는 예선 점수를 보내지 않는다 (심사계획(안): 예선 점수·순위 비공개)
function judgeTeam(t: Team): Team {
  // 최종 총평도 운영진만 본다
  return { ...t, prelimScore: null, finalComment: undefined };
}

export function buildJudgeView(
  sid: SessionId,
  data: SessionData,
  eventDate: string,
  judgeId: string,
  access: Record<string, JudgeAccess>,
): JudgeView | null {
  const cfg = SESSIONS[sid];
  const active = data.judges.filter((j) => j.active);
  const judgeIndex = active.findIndex((j) => j.id === judgeId);
  if (judgeIndex < 0) return null;
  const judge = active[judgeIndex];
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  const submittedCount = active.filter((j) => access[j.id]?.submittedAt).length;
  const allSubmitted = active.length > 0 && submittedCount === active.length;

  let result: JudgeView['result'] = null;
  if (allSubmitted) {
    const outcome = computeOutcome(cfg, data);
    const ranked = [...(outcome.s1?.ranked ?? []), ...(outcome.s2?.blocks.flatMap((b) => b.ranked) ?? [])];
    const rows: JudgeResultRow[] = teams.map((t) => {
      const r = ranked.find((x) => x.result.team.id === t.id);
      const mine = r?.result.cells.find((c) => c.judgeId === judgeId);
      return {
        teamId: t.id,
        order: t.order,
        task: t.task,
        org: t.org,
        teamName: t.teamName,
        work: t.work,
        score: r?.result.score ?? null,
        rank: r?.rank ?? null,
        tied: r?.tied ?? false,
        award: awardLabel(outcome.awards.get(t.id)),
        myTotal: mine?.total ?? null,
      };
    });
    result = { rows, digest: outcome.digest, ready: outcome.ready };
  }

  return {
    sid,
    eventDate,
    judge,
    judgeIndex,
    teams: teams.map(judgeTeam),
    // 운영진 조정 점수와 이력(adj·adjLog)은 심사위원에게 보내지 않는다
    scores: Object.fromEntries(Object.entries(data.scores[judgeId] ?? {}).map(([tid, { adj: _adj, adjLog: _log, ...e }]) => [tid, e])),
    submittedAt: access[judgeId]?.submittedAt ?? null,
    locked: data.locked,
    signature: data.signatures[judgeId] ?? null,
    submittedCount,
    judgeCount: active.length,
    result,
  };
}

export function allScored(sid: SessionId, data: SessionData, judgeId: string): boolean {
  const cfg = SESSIONS[sid];
  const mine = data.scores[judgeId] ?? {};
  return data.teams.filter((t) => !t.withdrawn).every((t) => isDone(cfg, mine[t.id] ?? { levels: {}, recused: false }));
}

/* ── 운영진 화면 변경분 → 서버 요청 ─────────────────────────── */
export type Op =
  | { kind: 'config' }
  | { kind: 'score'; sid: SessionId; jid: string; tid: string; entry: ScoreEntry | null }
  | { kind: 'sig'; sid: SessionId; jid: string; sig: Signature | null };

export function diffApp(prev: AppData, next: AppData): Op[] {
  const ops: Op[] = [];
  let config = prev.eventDate !== next.eventDate;
  for (const sid of SIDS) {
    const a = prev.sessions[sid];
    const b = next.sessions[sid];
    if (a === b) continue;
    if (a.judges !== b.judges || a.teams !== b.teams || a.locked !== b.locked) config = true;
    if (a.scores !== b.scores) {
      const jids = new Set([...Object.keys(a.scores), ...Object.keys(b.scores)]);
      for (const jid of jids) {
        const ja = a.scores[jid] ?? {};
        const jb = b.scores[jid] ?? {};
        if (ja === jb) continue;
        const tids = new Set([...Object.keys(ja), ...Object.keys(jb)]);
        for (const tid of tids) if (ja[tid] !== jb[tid]) ops.push({ kind: 'score', sid, jid, tid, entry: jb[tid] ?? null });
      }
    }
    if (a.signatures !== b.signatures) {
      const jids = new Set([...Object.keys(a.signatures), ...Object.keys(b.signatures)]);
      for (const jid of jids) if (a.signatures[jid] !== b.signatures[jid]) ops.push({ kind: 'sig', sid, jid, sig: b.signatures[jid] ?? null });
    }
  }
  if (config) ops.unshift({ kind: 'config' });
  return ops;
}
