import { useEffect, useState } from 'react';
import { type Jump, levelId } from '../missing';
import { LEVELS, levelPoints, type ScoreEntry, type SessionConfig, type SessionData, type Team } from '../model';
import { judgeLabel, teamSub, teamTitle } from './ui';

interface Props {
  cfg: SessionConfig;
  data: SessionData;
  update: (fn: (s: SessionData) => SessionData) => void;
  jump: Jump | null;
}

function entryOf(data: SessionData, judgeId: string, teamId: string): ScoreEntry {
  return data.scores[judgeId]?.[teamId] ?? { levels: {}, recused: false };
}

function isDone(cfg: SessionConfig, e: ScoreEntry): boolean {
  return e.recused || cfg.criteria.every((c) => e.levels[c.key] !== null && e.levels[c.key] !== undefined);
}

export function ScoreView({ cfg, data, update, jump }: Props) {
  const judges = data.judges.filter((j) => j.active);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (jump?.target.step === 'score') setSel(jump.target.judgeId);
  }, [jump]);
  const judgeId = judges.find((j) => j.id === sel)?.id ?? judges[0]?.id ?? null;
  const locked = data.locked;

  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);

  const setEntry = (jid: string, tid: string, fn: (e: ScoreEntry) => ScoreEntry) =>
    update((s) => {
      const cur = s.scores[jid]?.[tid] ?? { levels: {}, recused: false };
      return { ...s, scores: { ...s.scores, [jid]: { ...(s.scores[jid] ?? {}), [tid]: fn(cur) } } };
    });

  if (judges.length === 0) {
    return <div className="card empty">[1. 심사 설정]에서 심사위원을 먼저 등록하시기 바랍니다.</div>;
  }
  if (teams.length === 0) {
    return <div className="card empty">[1. 심사 설정]에서 결선 진출팀을 먼저 등록하시기 바랍니다.</div>;
  }

  const progressOf = (jid: string) => teams.filter((t) => isDone(cfg, entryOf(data, jid, t.id))).length;
  const judge = judges.find((j) => j.id === judgeId);
  const judgeIdx = judges.findIndex((j) => j.id === judgeId);

  const groups: { label: string | null; teams: Team[] }[] = cfg.tasks
    ? cfg.tasks.map((tk) => ({ label: tk.label, teams: teams.filter((t) => t.task === tk.id) })).filter((g) => g.teams.length)
    : [{ label: null, teams }];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>점수 입력</h1>
          <p>심사위원 평가표를 확인하여 지표별 5단계 중 하나를 선택합니다. 입력 즉시 이 PC에 자동 저장됩니다.</p>
        </div>
      </div>
      {locked && (
        <div className="notices">
          <div className="notice warn">집계가 확정되어 잠겨 있습니다. 점수를 수정하려면 [4. 서명·확정]에서 잠금을 해제하시기 바랍니다.</div>
        </div>
      )}
      <div className="score-layout">
        <aside className="card judge-list" aria-label="심사위원 선택">
          <div className="card-head">
            <h2>심사위원</h2>
          </div>
          {judges.map((j, i) => {
            const done = progressOf(j.id);
            return (
              <button key={j.id} type="button" className="judge-item" aria-pressed={j.id === judgeId} onClick={() => setSel(j.id)}>
                <div className="who">
                  <strong>
                    {judgeLabel(j, i)}
                    {j.isChair && <span className="chair-tag">위원장</span>}
                  </strong>
                  <span>
                    입력 {done} / {teams.length}팀
                  </span>
                  <div className={`progress${done === teams.length ? ' full' : ''}`}>
                    <i style={{ width: `${(done / teams.length) * 100}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        <div>
          {judge &&
            groups.map((g) => (
              <section key={g.label ?? 'all'} style={{ marginBottom: 18 }}>
                {g.label && <h2 style={{ fontSize: 14, margin: '0 0 10px', color: 'var(--ink-2)' }}>과제 · {g.label}</h2>}
                <div className="team-cards">
                  {g.teams.map((t) => {
                    const e = entryOf(data, judge.id, t.id);
                    const done = isDone(cfg, e);
                    const total = cfg.criteria.reduce((sum, c) => {
                      const lv = e.levels[c.key];
                      return lv === null || lv === undefined ? sum : sum + levelPoints(c.max, lv);
                    }, 0);
                    return (
                      <article key={t.id} className={`team-card${e.recused ? ' recused' : done ? ' done' : ''}`}>
                        <header>
                          <div className="order">{t.order}</div>
                          <div className="t">
                            <strong>{teamTitle(t)}</strong>
                            <span>{teamSub(t)}</span>
                          </div>
                          <div className="total">
                            {e.recused ? <span className="badge">회피</span> : <b>{total}</b>}
                            {!e.recused && <span>/ 100점</span>}
                          </div>
                        </header>
                        {e.recused ? (
                          <div className="recused-box">
                            {judgeLabel(judge, judgeIdx)} 위원은 이 팀 심사를 회피하였습니다. 나머지 심사위원 점수로 집계합니다.
                          </div>
                        ) : (
                          <div className="crit-rows">
                            {cfg.criteria.map((c) => (
                              <div className="crit-row" key={c.key}>
                                <div className="lbl">
                                  <strong>{c.label}</strong>
                                  <span>배점 {c.max}</span>
                                </div>
                                <div className="levels" role="group" aria-label={`${teamTitle(t)} ${c.label}`}>
                                  {LEVELS.map((lv, li) => (
                                    <button
                                      key={lv.label}
                                      id={li === 0 ? levelId(judge.id, t.id, c.key) : undefined}
                                      type="button"
                                      disabled={locked}
                                      aria-pressed={e.levels[c.key] === li}
                                      onClick={() =>
                                        setEntry(judge.id, t.id, (cur) => ({
                                          ...cur,
                                          levels: { ...cur.levels, [c.key]: cur.levels[c.key] === li ? null : li },
                                        }))
                                      }
                                    >
                                      <b>{levelPoints(c.max, li)}</b>
                                      <span>{lv.label}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <footer>
                          {done ? <span className="badge ok"><i className="dot" />입력 완료</span> : <span className="badge warn"><i className="dot" />입력 중</span>}
                          <span style={{ flex: 1 }} />
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={e.recused}
                              disabled={locked}
                              onChange={(ev) => setEntry(judge.id, t.id, (cur) => ({ ...cur, recused: ev.target.checked }))}
                            />
                            이해충돌 회피
                          </label>
                          {!e.recused && (
                            <button
                              type="button"
                              className="btn sm ghost"
                              disabled={locked || Object.values(e.levels).every((v) => v === null)}
                              onClick={() => setEntry(judge.id, t.id, (cur) => ({ ...cur, levels: {} }))}
                            >
                              지우기
                            </button>
                          )}
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      </div>
    </>
  );
}
