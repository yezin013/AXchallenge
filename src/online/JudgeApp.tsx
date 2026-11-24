import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SESSIONS, critPoints, type ScoreEntry, type SessionData } from '../model';
import { entryTotal, isDone } from '../scoreOps';
import { JudgeTeamPage } from './JudgeTeamPage';
import { useMaterials } from './MaterialViews';
import { SignaturePad } from '../components/SignView';
import { ConfirmButton, fmtDateTime, fmtEventDate, teamSub, teamTitle } from '../components/ui';
import { api } from './client';
import { type Cell, buildXlsx } from '../xlsx';
import type { JudgeView } from './protocol';

const POLL_MS = 4000;

// 운영진 화면과 같은 상단 메뉴. 심사위원은 본인 점수와 (전원 제출 뒤) 최종 결과만 본다.
type JudgeStep = 'score' | 'total' | 'sign';
const JSTEPS: { id: JudgeStep; label: string }[] = [
  { id: 'score', label: '점수 입력' },
  { id: 'total', label: '합산 점수' },
  { id: 'sign', label: '서명·확정' },
];

// 심사위원 화면: 본인 점수 입력 → 제출 → (전원 제출 후) 최종 결과 확인·서명
export function JudgeApp({ code, sid, logout, sessions, onPick }: { code: string; sid: string; logout: () => void; sessions?: string[]; onPick?: (sid: string) => void }) {
  const [step, setStep] = useState<JudgeStep>('score');
  const [view, setView] = useState<JudgeView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 안내 창: done = 점수 제출 완료, toSign = 서명·확정으로 이동, signed = 서명 완료
  const [dlg, setDlg] = useState<'done' | 'toSign' | 'signed' | null>(null);
  const pending = useRef(new Map<string, ScoreEntry>());
  const timer = useRef<number | undefined>(undefined);
  const lastEdit = useRef(0);

  const ver = useRef<number | null>(null); // 서버 변경 번호: 같으면 서버가 작은 응답만 보낸다

  const reload = useCallback(
    async (force = false) => {
      const q = force || ver.current === null ? '' : `?since=${ver.current}`;
      const v = await api<(JudgeView & { ver: number; unchanged?: undefined }) | { ver: number; unchanged: true }>(`/api/judge${q}`, code, undefined, sid);
      if (!v.unchanged && pending.current.size === 0 && Date.now() - lastEdit.current > 1500) {
        ver.current = v.ver;
        setView(v);
      }
      setErr(null);
    },
    [code, sid],
  );

  const send = useCallback(async () => {
    for (const [tid, entry] of [...pending.current]) {
      try {
        await api('/api/judge', code, { op: 'score', tid, entry }, sid);
        if (pending.current.get(tid) === entry) pending.current.delete(tid);
      } catch (e) {
        setErr(e instanceof Error ? e.message : '저장되지 않았습니다. 잠시 후 다시 시도하시기 바랍니다.');
        timer.current = window.setTimeout(() => void send(), 3000);
        return;
      }
    }
    setErr(null);
  }, [code, sid]);

  useEffect(() => {
    reload().catch((e: unknown) => setErr(e instanceof Error ? e.message : '심사 자료를 불러오지 못하였습니다.'));
    const id = window.setInterval(() => {
      if (pending.current.size > 0) return;
      reload().catch((e: unknown) => setErr(e instanceof Error ? e.message : '서버 연결이 원활하지 않습니다.'));
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  // 세션 옮기기: 아직 안 보낸 점수를 먼저 저장하고 옮긴다
  const switchSession = async (next: string) => {
    if (!onPick || busy || next === sid) return;
    window.clearTimeout(timer.current);
    setBusy(true);
    await send();
    setBusy(false);
    if (pending.current.size === 0) onPick(next);
  };

  const materials = useMaterials(code, sid, true).list;
  const cfg = view ? SESSIONS[view.sid] : null;
  const data: SessionData | null = useMemo(
    () =>
      view && {
        judges: [view.judge],
        teams: view.teams,
        scores: { [view.judge.id]: view.scores },
        signatures: {},
        locked: view.locked || !!view.submittedAt,
      },
    [view],
  );

  if (!view || !cfg || !data) {
    return (
      <div className="ol-center">
        {err ?? '심사 자료를 불러오고 있습니다.'}
        {err && <button type="button" className="btn" onClick={logout}>처음으로</button>}
      </div>
    );
  }

  const me = view.judge;
  const update = (fn: (s: SessionData) => SessionData) => {
    const next = fn(data).scores[me.id] ?? {};
    for (const [tid, e] of Object.entries(next)) if (view.scores[tid] !== e) pending.current.set(tid, e);
    lastEdit.current = Date.now();
    setView({ ...view, scores: next });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void send(), 400);
  };

  const doneCount = view.teams.filter((t) => isDone(cfg, view.scores[t.id] ?? { levels: {}, recused: false })).length;
  const allDone = doneCount === view.teams.length && view.teams.length > 0;
  const post = async (body: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      await send();
      await api('/api/judge', code, body, sid);
      lastEdit.current = 0;
      await reload(true);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : '요청을 처리하지 못하였습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  // 본인 점수표를 엑셀 파일(.xlsx)로 내려받는다 (다른 심사위원 점수·순위는 들어가지 않음)
  const saveXlsx = () => {
    const head = ['발표', ...(cfg.tasks ? ['과제'] : []), '기관명', '팀명', '작품명', ...cfg.criteria.map((c) => `${c.label}(${c.max})`), '합계'];
    const body: Cell[][] = [...view.teams]
      .sort((x, y) => x.order - y.order)
      .map((t) => {
        const e = view.scores[t.id] ?? { levels: {}, recused: false };
        return [
          t.order,
          ...(cfg.tasks ? [cfg.tasks.find((k) => k.id === t.task)?.label ?? ''] : []),
          t.org,
          t.teamName,
          t.work,
          ...cfg.criteria.map((c) => {
            const lv = e.levels[c.key];
            return e.recused || lv === undefined || lv === null ? '' : critPoints(cfg, c.max, lv);
          }),
          e.recused ? '회피' : isDone(cfg, e) ? entryTotal(cfg, e) : '입력 중',
        ];
      });
    const name = me.name || `위원${view.judgeIndex + 1}`;
    const rows: Cell[][] = [[`${cfg.short} ${cfg.title} · ${name} 위원 점수표`], [], head, ...body, [], ['제출', view.submittedAt ? fmtDateTime(view.submittedAt) : '미제출']];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(buildXlsx(rows, { sheet: `${cfg.short} 점수표`, titleRows: [0], headerRows: [2] }));
    link.download = `${cfg.short.replace(' ', '')}_${name}_점수표.xlsx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const sigValid = !!view.signature && view.signature.digest === view.result?.digest;
  const cur = JSTEPS.find((s) => s.id === step) ?? JSTEPS[0];
  const done: Record<JudgeStep, boolean> = { score: !!view.submittedAt, total: allDone, sign: sigValid };
  const waiting = (
    <div className="notice warn" role="status">
      {view.submittedAt
        ? `서명은 심사위원 전원 제출 후 가능합니다. (현재 ${view.submittedCount}/${view.judgeCount}명 제출)`
        : `[점수 입력]에서 평가 점수를 먼저 제출하시기 바랍니다. 서명은 심사위원 전원 제출 후 가능합니다. (현재 ${view.submittedCount}/${view.judgeCount}명 제출)`}
    </div>
  );

  return (
    <div className="cp">
      <header className="cp-gnb">
        <div className="cp-in">
          <button type="button" className="cp-logo" onClick={logout} title="메인 화면으로 이동">
            <b>결선 심사 시스템</b>
            <span>2026 공공 AI 대전환 챌린지</span>
          </button>
          <nav aria-label="주 메뉴">
            {JSTEPS.map((s) => (
              <button key={s.id} type="button" aria-current={step === s.id ? 'page' : undefined} onClick={() => setStep(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="cp-util">
            <span className="ol-who ol-who-first">{me.name || `위원 ${view.judgeIndex + 1}`} 위원</span>
            <button type="button" className="ol-out" onClick={logout}>로그아웃</button>
          </div>
        </div>
      </header>

      <div className="cp-loc">
        <div className="cp-in">
          <div className="cp-cur" aria-live="polite">
            <b>{cur.label}</b>
            <span className={done[step] ? 'ok' : 'ing'}>{done[step] ? '완료' : '진행 중'}</span>
          </div>
          <div className="cp-loc-r">
            <span>심사일 {fmtEventDate(view.eventDate)}</span>
            <span>제출 현황 {view.submittedCount}/{view.judgeCount}명</span>
            <button type="button" onClick={saveXlsx} title="본인 점수표를 엑셀 파일로 저장">
              엑셀 저장
            </button>
          </div>
        </div>
      </div>

      <div className="cp-in ol-sess-row">
        {sessions && sessions.length > 1 ? (
          <div className="cp-sess ol-sess-pick" role="group" aria-label="세션 선택">
            {sessions.map((s) => (
              <button key={s} type="button" aria-pressed={s === sid} disabled={busy} onClick={() => void switchSession(s)}>
                {SESSIONS[s as keyof typeof SESSIONS].short}
              </button>
            ))}
          </div>
        ) : (
          <span className="ol-sess-now">{cfg.short}</span>
        )}
      </div>

      <main className="cp-in cp-main">
        <div className="notices">
          {err && <div className="notice warn" role="alert">{err}</div>}
          {view.locked && <div className="notice ok">집계가 확정되었습니다. 심사에 협조하여 주셔서 감사합니다.</div>}
        </div>

        {step === 'score' && !view.submittedAt && (
          <>
            <div className="cp-title">
              <h2>평가 점수 입력</h2>
              <p>{cfg.scale === 'points' ? '평가지표별 점수를 배점 이내로 직접 입력합니다.' : '평가지표별로 5단계 중 하나를 선택합니다.'} 입력 내용은 자동 저장되며, 다른 심사위원의 점수는 공개되지 않습니다.</p>
            </div>
            <JudgeTeamPage cfg={cfg} data={data} update={update} materials={materials} />
            <div className="ol-submit">
              <span>
                평가 완료 <b>{doneCount}</b> / {view.teams.length}팀
              </span>
              <ConfirmButton className="primary" disabled={!allDone || busy} confirmText="제출 후 수정 불가 · 다시 누르면 제출" onConfirm={() => void post({ op: 'submit' }).then((ok) => ok && setDlg('done'))}>
                점수 제출
              </ConfirmButton>
            </div>
            {!allDone && <p className="ol-hint">전 팀 평가를 완료한 후 제출할 수 있습니다. 이해관계가 있는 팀은 [평가 회피]에 표시하시기 바랍니다.</p>}
          </>
        )}

        {step === 'score' && view.submittedAt && (
          <>
            <div className="cp-title">
              <h2>제출 점수 확인</h2>
              <p>{fmtDateTime(view.submittedAt)} 제출 완료. 수정이 필요한 경우 운영진에 제출 취소를 요청하시기 바랍니다.</p>
            </div>
            <JudgeTeamPage cfg={cfg} data={data} update={update} materials={materials} />
          </>
        )}

        {step === 'total' && (
          <>
            <div className="cp-title">
              <h2>합산 점수</h2>
              <p>본인이 입력한 팀별 합산 점수입니다. 다른 심사위원의 점수는 공개되지 않습니다.</p>
            </div>
            <div className="cp-tbl">
              <table className="tbl jt-sum">
                <thead>
                  <tr>
                    <th className="c">발표</th>
                    {cfg.tasks && <th>과제</th>}
                    <th>기관 · 팀</th>
                    {cfg.criteria.map((c) => (
                      <th key={c.key} className="c">
                        {c.label} <small>({c.max})</small>
                      </th>
                    ))}
                    <th className="c">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.teams]
                    .sort((a, b) => a.order - b.order)
                    .map((t) => {
                      const e = view.scores[t.id] ?? { levels: {}, recused: false };
                      return (
                        <tr key={t.id}>
                          <td className="c">{t.order}</td>
                          {cfg.tasks && <td>{cfg.tasks.find((k) => k.id === t.task)?.label}</td>}
                          <td>
                            <b>{teamTitle(t)}</b> <small className="sub">{teamSub(t)}</small>
                          </td>
                          {cfg.criteria.map((c) => {
                            const lv = e.levels[c.key];
                            return (
                              <td key={c.key} className="c">
                                {e.recused || lv === undefined || lv === null ? '–' : critPoints(cfg, c.max, lv)}
                              </td>
                            );
                          })}
                          <td className="c">
                            <b>{e.recused ? '회피' : isDone(cfg, e) ? entryTotal(cfg, e) : '입력 중'}</b>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="ol-submit">
              <span>합산 점수를 확인하셨으면 서명·확정으로 이동하시기 바랍니다.</span>
              <button type="button" className="btn primary" onClick={() => setDlg('toSign')}>
                서명·확정으로 이동
              </button>
            </div>
          </>
        )}

        {step === 'sign' && (
          <>
            <div className="cp-title">
              <h2>서명·확정</h2>
              <p>심사위원 전원 제출 후 서명합니다. 서명 후 결과가 변경되면 다시 서명하여야 합니다.</p>
            </div>
            {!view.result ? (
              waiting
            ) : (
              <article className="sign-card ol-sign">
                {sigValid && view.signature ? (
                  <>
                    <img className="sign-img" src={view.signature.dataUrl} alt="본인 서명" />
                    <footer>
                      <span className="meta">{fmtDateTime(view.signature.signedAt)} 서명 완료</span>
                    </footer>
                  </>
                ) : (
                  <>
                    {view.signature && <div className="notice bad" style={{ margin: 10, fontSize: 12 }}>서명 후 결과가 변경되었습니다. 다시 서명하여 주시기 바랍니다.</div>}
                    {!view.result.ready && <div className="notice warn" style={{ margin: 10, fontSize: 12 }}>동점 처리 등 운영진 확인이 완료된 후 서명할 수 있습니다.</div>}
                    <SignaturePad disabled={!view.result.ready || view.locked || busy} onSave={(url) => void post({ op: 'sign', dataUrl: url }).then((ok) => ok && setDlg('signed'))} />
                  </>
                )}
              </article>
            )}
          </>
        )}
      </main>

      {dlg && (
        <div className="lp-layer" onClick={(e) => e.target === e.currentTarget && setDlg(null)}>
          <div className="ol-card lp-card done-card" role="dialog" aria-modal="true" aria-labelledby="done-title">
            <p className="ol-eyebrow">{cfg.short} · {cfg.title}</p>
            {dlg === 'done' && (
              <>
                <h1 id="done-title">점수 입력이 완료되었습니다</h1>
                <p className="ol-hint">
                  {view.teams.length}팀의 평가 점수가 제출되었습니다. 합산 점수를 확인하신 후 서명·확정으로 이동하시기 바랍니다. (현재 {view.submittedCount}/{view.judgeCount}명 제출)
                </p>
                <button type="button" className="btn primary" autoFocus onClick={() => { setDlg(null); setStep('total'); }}>
                  합산 점수 확인
                  <span aria-hidden="true">↗</span>
                </button>
              </>
            )}
            {dlg === 'toSign' && (
              <>
                <h1 id="done-title">서명·확정으로 이동합니다</h1>
                <p className="ol-hint">
                  {!view.submittedAt
                    ? '아직 점수를 제출하지 않으셨습니다. [점수 입력]에서 점수를 제출한 후 서명하실 수 있습니다.'
                    : view.result?.ready
                      ? '심사위원 전원이 점수를 제출하였습니다. 서명·확정에서 서명하여 주시기 바랍니다.'
                      : `서명은 심사위원 전원 제출과 운영진 확인이 끝난 후 가능합니다. (현재 ${view.submittedCount}/${view.judgeCount}명 제출)`}
                </p>
                <button type="button" className="btn primary" autoFocus onClick={() => { setDlg(null); setStep('sign'); }}>
                  서명·확정으로 이동
                  <span aria-hidden="true">↗</span>
                </button>
              </>
            )}
            {dlg === 'signed' && (
              <>
                <h1 id="done-title">서명이 완료되었습니다</h1>
                <p className="ol-hint">심사 결과 확인 서명이 저장되었습니다. 심사에 협조하여 주셔서 감사합니다.</p>
              </>
            )}
            <button type="button" className="btn lp-back" autoFocus={dlg === 'signed'} onClick={() => setDlg(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
