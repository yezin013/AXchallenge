import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { type SessionData, type SessionId, SESSIONS } from './model';
import { computeOutcome } from './outcome';
import { buildSummaryXlsx } from './exportCsv';
import { type Store, initialData, parseBackup } from './store';
import { stamp, useDownload } from './components/ui';
import { type Jump, type JumpTarget, findMissing, revealTarget } from './missing';

export type Step = 'setup' | 'score' | 'summary' | 'sign';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'setup', label: '심사 설정' },
  { id: 'score', label: '점수 입력' },
  { id: 'summary', label: '최종 집계' },
  { id: 'sign', label: '서명·확정' },
];

// 디자인1 외 시안이 함께 쓰는 상태·계산·파일 처리
export function useJudging(store: Store) {
  const [state, dispatch] = store;
  const [sid, setSid] = useState<SessionId>('s1');
  const [step, setStepRaw] = useState<Step>('setup');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [showTop, setShowTop] = useState(false);
  const { anchor, download } = useDownload();
  const [jump, setJump] = useState<Jump | null>(null);
  const [printMode, setPrintMode] = useState<'summary' | 'eval'>('summary');

  useEffect(() => {
    if (jump) revealTarget(jump.target.elementId);
  }, [jump]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const cfg = SESSIONS[sid];
  const data = state.sessions[sid];
  const outcome = useMemo(() => computeOutcome(cfg, data), [cfg, data]);
  const outcomes = useMemo(
    () => ({ s1: computeOutcome(SESSIONS.s1, state.sessions.s1), s2: computeOutcome(SESSIONS.s2, state.sessions.s2) }),
    [state.sessions],
  );
  // 메뉴로 직접 이동하면 이전 바로 가기 위치는 잊는다
  const setStep = (s: Step) => {
    setJump(null);
    setStepRaw(s);
  };
  const missing = useMemo(() => findMissing(cfg, data, outcome), [cfg, data, outcome]);
  const onJump = (target: JumpTarget) => {
    setStepRaw(target.step);
    setJump((p) => ({ target, seq: (p?.seq ?? 0) + 1 }));
  };
  const update = (fn: (s: SessionData) => SessionData) => dispatch({ type: 'session', id: sid, update: fn });

  const active = data.judges.filter((j) => j.active);
  const signedValid = active.filter((j) => data.signatures[j.id]?.digest === outcome.digest).length;
  const setupDone =
    active.length > 0 &&
    active.every((j) => j.name.trim()) &&
    data.teams.filter((t) => !t.withdrawn).length > 0 &&
    data.teams.every((t) => t.withdrawn || (t.org.trim() && t.teamName.trim()));
  const stepDone: Record<Step, boolean> = {
    setup: setupDone,
    score: outcome.teamCount > 0 && outcome.pendingCount === 0,
    summary: outcome.ready,
    sign: data.locked,
  };

  const flash = (kind: 'ok' | 'bad', text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 4000);
  };

  const backup = () =>
    download(`결선심사_백업_${stamp()}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const exportCsv = () =>
    download(`${cfg.short.replace(' ', '')}_결선_최종집계표_${stamp()}.xlsx`, buildSummaryXlsx(cfg, data, outcome));
  const restore = async (f: File) => {
    const parsed = parseBackup(await f.text());
    if (parsed) {
      dispatch({ type: 'replace', data: parsed });
      flash('ok', `백업 파일을 불러왔습니다: ${f.name}`);
    } else flash('bad', '결선 심사 백업 파일이 아닙니다. 이 시스템에서 저장한 .json 파일을 고르세요.');
  };
  const reset = () => {
    dispatch({ type: 'replace', data: initialData() });
    flash('ok', '전체 데이터를 초기화했습니다.');
  };

  return {
    state, dispatch, sid, setSid, step, setStep, msg, showTop, anchor,
    cfg, data, outcome, outcomes, update, active, signedValid, stepDone, missing, onJump, jump,
    backup, exportCsv, restore, reset, printMode,
    print: () => {
      flushSync(() => setPrintMode('summary'));
      window.print();
    },
    printEval: () => {
      flushSync(() => setPrintMode('eval'));
      window.print();
      setPrintMode('summary');
    },
  };
}

export type Judging = ReturnType<typeof useJudging>;
