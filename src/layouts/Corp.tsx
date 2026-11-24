import { Fragment, useEffect, useRef, useState } from 'react';
import { type Jump, levelId, runId, runReasonId } from '../missing';
import { EvalSheets } from '../components/EvalSheets';
import type { AwardState, RankedTeam } from '../calc';
import { LEVELS, levelPoints, RUN_CHECKS, SESSIONS, type SessionConfig, type SessionData } from '../model';
import { entryOf, entryTotal, isDone, setLevel, setNote, setRecused, toggleLevel } from '../scoreOps';
import { PointsInput } from '../components/PointsInput';
import { STEPS, type Step, useJudging } from '../useJudging';
import type { Outcome } from '../outcome';
import { SetupView } from '../components/SetupView';
import { SignView } from '../components/SignView';
import { PrintSheet } from '../components/PrintSheet';
import { TieResolver } from '../components/SummaryView';
import { FinalBoard } from '../components/FinalBoard';
import { ConfirmButton, Icon, fmtEventDate, judgeLabel, teamSub, teamTitle } from '../components/ui';
import { type Store, useAppStore } from '../store';
import { AccessPanel } from '../online/AccessPanel';
import { MaterialsPanel } from '../online/MaterialViews';
import type { RemoteAdmin, SyncStatus } from '../online/useRemoteAdmin';

type Update = (fn: (s: SessionData) => SessionData) => void;

const SECTION: Record<Step, { title: string; desc: string }> = {
  setup: { title: '심사위원 및 결선 진출팀 등록', desc: '심사위원은 심사 중에도 추가하거나 제외할 수 있습니다.' },
  score: { title: '심사위원별 점수 입력', desc: '지표별로 5단계(매우 우수·우수·보통·미흡·매우 미흡) 중 하나를 선택합니다.' },
  summary: { title: '최종 집계 및 수상 결과', desc: '심사위원 총점에서 최고점과 최저점을 제외한 평균으로 순위와 수상이 자동으로 결정됩니다.' },
  sign: { title: '심사위원 서명 및 집계 확정', desc: '심사위원 전원이 서명하면 집계를 확정합니다. 서명 후 점수가 변경되면 서명은 무효 처리됩니다.' },
};

/* ── 점수 입력: 위원 탭 + 게시판형 표 ─────────────────────────── */
export function ScoreBoard({ cfg, data, update, jump, onPrintEval }: { cfg: SessionConfig; data: SessionData; update: Update; jump: Jump | null; onPrintEval?: () => void }) {
  const judges = data.judges.filter((j) => j.active);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  const [jSel, setJSel] = useState<string | null>(null);
  useEffect(() => {
    if (jump?.target.step === 'score') setJSel(jump.target.judgeId);
  }, [jump]);
  const judge = judges.find((j) => j.id === jSel) ?? judges[0];
  if (!judge || teams.length === 0) return <div className="cp-empty">[심사 설정]에서 심사위원과 결선 진출팀을 먼저 등록하시기 바랍니다.</div>;

  return (
    <>
      <div className="cp-tabs" role="group" aria-label="심사위원 선택" style={{ ['--n' as string]: judges.length }}>
        {judges.map((j, k) => {
          const n = teams.filter((t) => isDone(cfg, entryOf(data, j.id, t.id))).length;
          return (
            <button key={j.id} type="button" aria-pressed={j.id === judge.id} onClick={() => setJSel(j.id)}>
              {judgeLabel(j, k)}
              <span className={n === teams.length ? 'ok' : ''}>({n}/{teams.length})</span>
            </button>
          );
        })}
      </div>
      <div className="cp-count">
        <span>전체 <b>{teams.length}</b>팀 · 입력 완료 <b>{teams.filter((t) => isDone(cfg, entryOf(data, judge.id, t.id))).length}</b>팀</span>
        <span className="legend">{cfg.scale === 'points' ? '지표별 점수를 배점 이내로 직접 입력 (소수 첫째 자리까지)' : '점수 버튼: 왼쪽부터 매우 우수 → 매우 미흡'}</span>
        {onPrintEval && <button type="button" className="btn sm" onClick={onPrintEval}>심사평가표 인쇄</button>}
      </div>
      <div className="cp-tw">
        <table className="cp-board">
          <thead>
            <tr>
              <th className="n">발표</th>
              <th className="t">기관 · 팀</th>
              {cfg.criteria.map((c) => <th key={c.key} title={c.desc}>{c.label} <small>({c.max})</small></th>)}
              <th className="s">합계</th>
              <th className="r">회피</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const e = entryOf(data, judge.id, t.id);
              const done = isDone(cfg, e);
              const off = data.locked || e.recused;
              return (
                <Fragment key={t.id}>
                <tr className={`main${e.recused ? ' rec' : ''}${cfg.opinion ? '' : ' solo'}`}>
                  <td className="n">{t.order}</td>
                  <td className="t">
                    <b>{teamTitle(t)}</b>
                    <small>{cfg.tasks ? `${cfg.tasks.find((k) => k.id === t.task)?.label} · ` : ''}{teamSub(t)}</small>
                  </td>
                  {cfg.criteria.map((c) => (
                    <td key={c.key}>
                      {cfg.scale === 'points' ? (
                        <PointsInput key={judge.id + t.id + c.key} value={e.levels[c.key]} max={c.max} disabled={off} label={`${teamTitle(t)} ${c.label}`} onChange={(v) => setLevel(update, judge.id, t.id, c.key, v)} />
                      ) : (
                      <div className="cp-seg" role="group" aria-label={`${teamTitle(t)} ${c.label}`}>
                        {LEVELS.map((lv, li) => (
                          <button key={lv.label} id={li === 0 ? levelId(judge.id, t.id, c.key) : undefined} type="button" title={lv.label} disabled={off} aria-pressed={e.levels[c.key] === li} onClick={() => toggleLevel(update, judge.id, t.id, c.key, li)}>
                            {levelPoints(c.max, li)}
                          </button>
                        ))}
                      </div>
                      )}
                    </td>
                  ))}
                  <td className="s">{e.recused ? <span className="mute">회피</span> : done ? <><b>{entryTotal(cfg, e)}</b>{e.adj && <small className="adj-note">조정 {e.adj.total}</small>}</> : <span className="mute">입력 중</span>}</td>
                  <td className="r">
                    <input type="checkbox" checked={e.recused} disabled={data.locked} onChange={(ev) => setRecused(update, judge.id, t.id, ev.target.checked)} aria-label={`${teamTitle(t)} 회피`} />
                  </td>
                </tr>
                {cfg.opinion && !e.recused && (
                  <tr className="note">
                    <td />
                    <td colSpan={cfg.criteria.length + 3}>
                      <div className="cp-note">
                        <div className="run">
                          <span className="lb">구동 확인 결과</span>
                          <div className="cp-run" role="group" aria-label={`${teamTitle(t)} 구동 확인 결과`}>
                            {RUN_CHECKS.map((r, ri) => (
                              <button key={r.id} id={ri === 0 ? runId(judge.id, t.id) : undefined} type="button" disabled={data.locked} aria-pressed={e.run === r.id} onClick={() => setNote(update, judge.id, t.id, { run: e.run === r.id ? null : r.id })}>
                                {r.label}
                              </button>
                            ))}
                          </div>
                          {e.run === 'fail' && (
                            <input id={runReasonId(judge.id, t.id)} className={`input${e.runReason?.trim() ? '' : ' invalid'}`} value={e.runReason ?? ''} placeholder="구동 불가 사유" disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { runReason: ev.target.value })} aria-label="구동 불가 사유" />
                          )}
                        </div>
                        <label>
                          <span className="lb">주요 강점</span>
                          <textarea className="input" rows={2} value={e.strengths ?? ''} disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { strengths: ev.target.value })} />
                        </label>
                        <label>
                          <span className="lb">보완 필요사항</span>
                          <textarea className="input" rows={2} value={e.improve ?? ''} disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { improve: ev.target.value })} />
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── 구동 확인 결과 요약 (심사평가표 하단 항목) ─────────────────────────── */
function RunSummary({ cfg, data }: { cfg: SessionConfig; data: SessionData }) {
  const judges = data.judges.filter((j) => j.active);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  return (
    <div className="cp-tbl">
      <table className="tbl cp-run-tbl">
        <thead>
          <tr>
            <th className="c">발표</th>
            {cfg.tasks && <th>과제</th>}
            <th>기관 · 팀</th>
            {RUN_CHECKS.map((r) => <th key={r.id} className="c">{r.label}</th>)}
            <th className="c">미선택</th>
            <th>구동 불가 사유</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const es = judges.map((j, k) => ({ j, k, e: entryOf(data, j.id, t.id) })).filter((x) => !x.e.recused);
            const n = (id: string | null) => es.filter((x) => (x.e.run ?? null) === id).length;
            const reasons = es.filter((x) => x.e.run === 'fail' && x.e.runReason?.trim()).map((x) => `${judgeLabel(x.j, x.k)}: ${x.e.runReason}`);
            return (
              <tr key={t.id}>
                <td className="c">{t.order}</td>
                {cfg.tasks && <td>{cfg.tasks.find((k) => k.id === t.task)?.label}</td>}
                <td><b>{teamTitle(t)}</b> <small className="sub">{t.org}</small></td>
                {RUN_CHECKS.map((r) => <td key={r.id} className={`c${r.id !== 'ok' && n(r.id) ? ' bad' : ''}`}>{n(r.id) || '–'}</td>)}
                <td className={`c${n(null) ? ' warn' : ''}`}>{n(null) || '–'}</td>
                <td>{reasons.join(' / ') || '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── 최종 집계 ─────────────────────────── */
const TIERS = ['대상', '최우수상', '우수상', '장려상'];

function AwardBoxes({ outcome, ranked }: { outcome: Outcome; ranked: RankedTeam[] }) {
  return (
    <ul className="cp-awards">
      {TIERS.map((name) => {
        const rows = ranked.filter((r) => {
          const a: AwardState | undefined = outcome.awards.get(r.result.team.id);
          return a?.kind === 'award' && a.tier.name === name;
        });
        const a = rows[0] ? outcome.awards.get(rows[0].result.team.id) : undefined;
        return (
          <li key={name}>
            <div className="h">
              <b>{name}</b>
              <span>{rows.length}팀</span>
            </div>
            <p>{a?.kind === 'award' ? `${a.tier.honor} · ${a.tier.prize}` : '해당 팀 없음'}</p>
            <ol>
              {rows.map((r) => <li key={r.result.team.id}><span>{teamTitle(r.result.team)}{r.result.team.task && <small>{SESSIONS.s2.tasks?.find((k) => k.id === r.result.team.task)?.label}</small>}</span><em>{r.result.score?.toFixed(2)}</em></li>)}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}

function Results({ cfg, data, update, onDirty }: { cfg: SessionConfig; data: SessionData; update: Update; onDirty: (n: number) => void }) {
  return (
    <>
      <FinalBoard cfg={cfg} data={data} update={update} onDirty={onDirty}>
        {(outcome, staged) => (
          <>
            {(outcome.pendingCount > 0 || outcome.ties.length > 0) && (
              <div className="notices">
                {outcome.pendingCount > 0 && <div className="notice warn">점수 입력이 완료되지 않은 팀 {outcome.pendingCount}팀은 순위에서 제외되어 있습니다.</div>}
                {/* 동점 협의 순서는 실제 점수에 저장되므로, 미반영 조정안이 있을 때는 막아 둔다 */}
                {staged === 0 && outcome.ties.map((g) => <TieResolver key={g.key + g.field} group={g} update={update} />)}
              </div>
            )}
            <h3 className="cp-h3">수상 결과{staged > 0 ? ' (미리보기)' : ''}</h3>
            <AwardBoxes outcome={outcome} ranked={[...(outcome.s1?.ranked ?? []), ...(outcome.s2?.blocks.flatMap((b) => b.ranked) ?? [])]} />
          </>
        )}
      </FinalBoard>
      {cfg.opinion && (
        <>
          <h3 className="cp-h3">구동 확인 결과</h3>
          <RunSummary cfg={cfg} data={data} />
        </>
      )}
    </>
  );
}

const SYNC: Record<SyncStatus, string> = { loading: '불러오는 중', saved: '서버 저장 완료', saving: '저장 중…', offline: '연결 끊김' };

export interface OnlineAdmin {
  remote: RemoteAdmin;
  logout: () => void;
  code: string;
}

// 오프라인 단일 파일: 이 PC 브라우저에 저장
export function OfflineCorpApp() {
  return <CorpApp store={useAppStore()} />;
}

export function CorpApp({ store, online }: { store: Store; online?: OnlineAdmin }) {
  const j = useJudging(store);
  const fileRef = useRef<HTMLInputElement>(null);
  const step = STEPS.find((s) => s.id === j.step) ?? STEPS[0];
  const sec = SECTION[j.step];
  const [dirty, setDirty] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const guard = (fn: () => void) => () => {
    if (dirty > 0) setBlocked(true);
    else fn();
  };
  useEffect(() => {
    if (dirty === 0) setBlocked(false);
  }, [dirty]);

  return (
    <>
      <div className="screen-only cp">
        <header className="cp-gnb">
          <div className="cp-in">
            {online ? (
              <button type="button" className="cp-logo" onClick={guard(online.logout)} title="메인 화면으로 이동">
                <b>결선 심사 시스템</b>
                <span>2026 공공 AI 대전환 챌린지</span>
              </button>
            ) : (
              <div className="cp-logo">
                <b>결선 심사 시스템</b>
                <span>2026 공공 AI 대전환 챌린지</span>
              </div>
            )}
            <nav aria-label="주 메뉴">
              {STEPS.map((s) => (
                <button key={s.id} type="button" aria-current={j.step === s.id ? 'page' : undefined} onClick={guard(() => j.setStep(s.id))}>{s.label}</button>
              ))}
            </nav>
            <div className="cp-util">
              {online && <span className={`ol-sync ${online.remote.status}`} role="status">{SYNC[online.remote.status]}</span>}
              <button type="button" onClick={guard(j.backup)}>백업 저장</button>
              <button type="button" onClick={guard(() => fileRef.current?.click())}>불러오기</button>
              <button type="button" className="print" onClick={guard(j.print)}>집계표 인쇄</button>
              {online && <button type="button" onClick={guard(online.logout)}>로그아웃</button>}
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void j.restore(f); }} />
            </div>
          </div>
        </header>


        <div className="cp-loc">
          <div className="cp-in">
            <div className="cp-cur" aria-live="polite">
              <b>{step.label}</b>
              <span className={j.stepDone[j.step] ? 'ok' : 'ing'}>{j.stepDone[j.step] ? '완료' : '진행 중'}</span>
            </div>
            <div className="cp-loc-r">
              <span>심사일 {fmtEventDate(j.state.eventDate)}</span>
              <button type="button" onClick={j.exportCsv}>엑셀 저장</button>
              <ConfirmButton className="cp-reset" confirmText="다시 누르면 초기화" onConfirm={j.reset}>초기화</ConfirmButton>
            </div>
          </div>
        </div>

        <div className="cp-in ol-sess-row">
        <div className="cp-sess" role="group" aria-label="세션 선택">
          {(['s1', 's2'] as const).map((id) => (
            <button key={id} type="button" aria-pressed={j.sid === id} onClick={guard(() => j.setSid(id))}>{SESSIONS[id].short}</button>
          ))}
        </div>
        </div>

        <main className="cp-in cp-main">
          {blocked && dirty > 0 && <div className="notice bad" role="alert">반영하지 않은 조정안이 {dirty}건 있습니다. 최종 집계표에서 먼저 반영하거나 취소하시기 바랍니다.</div>}
          <div className="cp-title">
            <h2>{sec.title}</h2>
            <p>{sec.desc}</p>
          </div>
          {j.msg && <div className="notices"><div className={`notice ${j.msg.kind}`} role="status">{j.msg.text}</div></div>}
          {online?.remote.notice && <div className="notices"><div className="notice warn" role="alert">{online.remote.notice}</div></div>}
          {j.step === 'setup' && (
            <>
              <SetupView cfg={j.cfg} data={j.data} other={j.state.sessions[j.sid === 's1' ? 's2' : 's1']} eventDate={j.state.eventDate} onEventDate={(v) => j.dispatch({ type: 'eventDate', value: v })} update={j.update} />
              {online && <AccessPanel cfg={j.cfg} data={j.data} remote={online.remote} />}
              {online && <MaterialsPanel key={j.sid} cfg={j.cfg} data={j.data} code={online.code} />}
            </>
          )}
          {j.step === 'score' && online && <AccessPanel cfg={j.cfg} data={j.data} remote={online.remote} />}
          {j.step === 'score' && <ScoreBoard key={j.sid} cfg={j.cfg} data={j.data} update={j.update} jump={j.jump} onPrintEval={j.printEval} />}
          {j.step === 'summary' && <Results key={j.sid} cfg={j.cfg} data={j.data} update={j.update} onDirty={setDirty} />}
          {j.step === 'sign' && <SignView cfg={j.cfg} data={j.data} outcome={j.outcome} update={j.update} onPrint={j.print} missing={j.missing} onJump={j.onJump} />}
        </main>

        <footer className="cp-foot">
          <div className="cp-in">
            <b>2026 공공 AI 대전환 챌린지 결선 심사 시스템</b>
            <p>{online ? '입력 내용은 서버에 자동 저장됩니다. 인터넷 연결이 끊길 경우에 대비하여 단계마다 [백업 저장]을 하시기 바랍니다.' : '인터넷 연결 없이 동작합니다. 입력 내용은 이 PC의 브라우저에 자동 저장되며, 다른 PC로 옮길 경우 백업 파일을 사용하시기 바랍니다.'}</p>
          </div>
        </footer>

        <button type="button" className={`to-top${j.showTop ? ' show' : ''}`} onClick={() => window.scrollTo({ top: 0 })} aria-label="맨 위로 이동" title="맨 위로" tabIndex={j.showTop ? 0 : -1}>
          <Icon name="up" />
        </button>
      </div>
      <div className="print-only">
        {j.printMode === 'eval' ? <EvalSheets cfg={j.cfg} data={j.data} outcome={j.outcome} /> : <PrintSheet cfg={j.cfg} data={j.data} outcome={j.outcome} eventDate={j.state.eventDate} />}
      </div>
      {j.anchor}
    </>
  );
}
