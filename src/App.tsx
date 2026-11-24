import { useEffect, useMemo, useRef, useState } from 'react';
import { type SessionData, type SessionId, SESSIONS } from './model';
import { computeOutcome } from './outcome';
import { type Jump, type JumpTarget, findMissing, revealTarget } from './missing';
import { buildSummaryXlsx } from './exportCsv';
import { DEMO, initialData, parseBackup, useAppStore } from './store';
import { SetupView } from './components/SetupView';
import { ScoreView } from './components/ScoreView';
import { SummaryView } from './components/SummaryView';
import { SignView } from './components/SignView';
import { PrintSheet } from './components/PrintSheet';
import { ConfirmButton, Icon, fmtEventDate, stamp, useDownload } from './components/ui';

type Step = 'setup' | 'score' | 'summary' | 'sign';
const STEPS: { id: Step; label: string }[] = [
  { id: 'setup', label: '심사 설정' },
  { id: 'score', label: '점수 입력' },
  { id: 'summary', label: '최종 집계' },
  { id: 'sign', label: '서명·확정' },
];

export function App() {
  const [state, dispatch] = useAppStore();
  const [sid, setSid] = useState<SessionId>('s1');
  const [step, setStepRaw] = useState<Step>(DEMO ? 'sign' : 'setup');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [showTop, setShowTop] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { anchor, download } = useDownload();
  const [jump, setJump] = useState<Jump | null>(null);

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
  const update = (fn: (s: SessionData) => SessionData) => dispatch({ type: 'session', id: sid, update: fn });
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

  return (
    <>
      <div className="screen-only">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <div className="brand-mark">AI</div>
              <div className="brand-text">
                <strong>2026 공공 AI 대전환 챌린지 · 결선 심사{DEMO ? ' (샘플 미리보기)' : ''}</strong>
                <span>{fmtEventDate(state.eventDate)} · 2026 정부혁신박람회</span>
              </div>
            </div>
            <nav className="session-switch" aria-label="세션 선택">
              {(['s1', 's2'] as const).map((id) => (
                <button key={id} type="button" aria-pressed={sid === id} onClick={() => setSid(id)}>
                  {SESSIONS[id].short} · {SESSIONS[id].title}
                </button>
              ))}
            </nav>
            <div className="top-actions">
              <button type="button" className="btn sm" onClick={backup} title="두 세션 전체 데이터를 파일로 저장">백업 저장</button>
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>백업 불러오기</button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const parsed = parseBackup(await f.text());
                  if (parsed) {
                    dispatch({ type: 'replace', data: parsed });
                    flash('ok', `백업 파일을 불러왔습니다: ${f.name}`);
                  } else flash('bad', '결선 심사 백업 파일이 아닙니다.');
                }}
              />
            </div>
          </div>
        </header>

        <div className="subbar">
          <div className="subbar-inner">
            <nav className="steps" aria-label="진행 단계">
              {STEPS.map((s, i) => (
                <button key={s.id} type="button" aria-current={step === s.id ? 'page' : undefined} onClick={() => setStep(s.id)}>
                  <span className={`n${stepDone[s.id] && step !== s.id ? ' done' : ''}`}>{stepDone[s.id] && step !== s.id ? '✓' : i + 1}</span>
                  {s.label}
                </button>
              ))}
            </nav>
            <div className="session-meta">
              <span>심사위원 <b>{active.length}</b>명</span>
              <span>입력 완료 <b>{outcome.teamCount - outcome.pendingCount}</b>/{outcome.teamCount}팀</span>
              <span>서명 <b>{signedValid}</b>/{active.length}</span>
              {data.locked ? <span className="badge ok">확정됨</span> : <span className="badge brand">진행 중</span>}
            </div>
          </div>
        </div>

        <main>
          {DEMO && (
            <div className="notices">
              <div className="notice warn">
                서명 화면 확인용 샘플입니다. 샘플위원·샘플팀 점수가 미리 채워져 있어 바로 서명해 볼 수 있습니다. 실제 심사에는 쓰지 마세요(실제 심사 파일과 데이터는 따로 저장됩니다).
              </div>
            </div>
          )}
          {msg && (
            <div className="notices">
              <div className={`notice ${msg.kind}`} role="status">{msg.text}</div>
            </div>
          )}
          {step === 'setup' && (
            <SetupView
              cfg={cfg}
              data={data}
              other={state.sessions[sid === 's1' ? 's2' : 's1']}
              eventDate={state.eventDate}
              onEventDate={(v) => dispatch({ type: 'eventDate', value: v })}
              update={update}
            />
          )}
          {step === 'score' && <ScoreView cfg={cfg} data={data} update={update} jump={jump} />}
          {step === 'summary' && (
            <SummaryView cfg={cfg} data={data} outcome={outcome} signedValid={signedValid} update={update} onExport={exportCsv} onPrint={() => window.print()} />
          )}
          {step === 'sign' && <SignView cfg={cfg} data={data} outcome={outcome} update={update} onPrint={() => window.print()} missing={missing} onJump={onJump} />}

          <section className="card" style={{ marginTop: 28 }}>
            <div className="card-head">
              <h2>데이터 관리</h2>
              <span className="hint">
                입력 내용은 이 PC 브라우저에 자동 저장됩니다. 다른 PC로 옮기거나 만일에 대비해 수시로 [백업 저장]을 눌러 파일로 보관하세요.
              </span>
              <div className="right">
                <ConfirmButton
                  className="sm danger"
                  confirmText="모든 세션 데이터 삭제 · 한 번 더"
                  onConfirm={() => {
                    dispatch({ type: 'replace', data: initialData() });
                    flash('ok', DEMO ? '샘플 데이터로 되돌렸습니다.' : '전체 데이터를 초기화했습니다.');
                  }}
                >
                  {DEMO ? '샘플 처음 상태로' : '전체 초기화'}
                </ConfirmButton>
              </div>
            </div>
          </section>
        </main>

        <button
          type="button"
          className={`to-top${showTop ? ' show' : ''}`}
          onClick={() => window.scrollTo({ top: 0 })}
          aria-label="맨 위로 이동"
          title="맨 위로"
          tabIndex={showTop ? 0 : -1}
        >
          <Icon name="up" />
        </button>
      </div>

      <div className="print-only">
        <PrintSheet cfg={cfg} data={data} outcome={outcome} eventDate={state.eventDate} />
      </div>
      {anchor}
    </>
  );
}
