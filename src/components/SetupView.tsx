import type { SessionConfig, SessionData, Team, TaskId } from '../model';
import { blankJudge, blankTeam, uid } from '../store';
import { ConfirmButton } from './ui';
import { judgeNameId, teamFieldId } from '../missing';

interface Props {
  cfg: SessionConfig;
  data: SessionData;
  other: SessionData;
  eventDate: string;
  onEventDate: (v: string) => void;
  update: (fn: (s: SessionData) => SessionData) => void;
}

function hasScores(data: SessionData, judgeId: string): boolean {
  const s = data.scores[judgeId];
  return !!s && Object.values(s).some((e) => e.recused || Object.values(e.levels).some((v) => v !== null));
}

export function SetupView({ cfg, data, other, eventDate, onEventDate, update }: Props) {
  const locked = data.locked;
  const active = data.judges.filter((j) => j.active);

  const setJudge = (id: string, patch: Partial<SessionData['judges'][number]>) =>
    update((s) => ({ ...s, judges: s.judges.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

  const setChair = (id: string) =>
    update((s) => ({ ...s, judges: s.judges.map((j) => ({ ...j, isChair: j.id === id })) }));

  const removeJudge = (id: string) =>
    update((s) => {
      let judges = s.judges.filter((j) => j.id !== id);
      const scores = { ...s.scores };
      delete scores[id];
      const signatures = { ...s.signatures };
      delete signatures[id];
      if (!judges.some((j) => j.isChair && j.active)) {
        const first = judges.find((j) => j.active);
        if (first) judges = judges.map((j) => ({ ...j, isChair: j.id === first.id }));
      }
      return { ...s, judges, scores, signatures };
    });

  const toggleActive = (id: string, activeNow: boolean) =>
    update((s) => {
      const signatures = { ...s.signatures };
      delete signatures[id];
      let judges = s.judges.map((j) => (j.id === id ? { ...j, active: !activeNow, isChair: activeNow ? false : j.isChair } : j));
      if (!judges.some((j) => j.isChair && j.active)) {
        const first = judges.find((j) => j.active);
        if (first) judges = judges.map((j) => ({ ...j, isChair: j.id === first.id }));
      }
      return { ...s, judges, signatures };
    });

  const importJudges = () =>
    update((s) => ({
      ...s,
      judges: other.judges.filter((j) => j.active).map((j) => ({ ...j, id: uid('j') })),
      scores: {},
      signatures: {},
    }));

  const setTeam = (id: string, patch: Partial<Team>) =>
    update((s) => ({ ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const addTeam = (task: TaskId | null) =>
    update((s) => {
      const order = s.teams.reduce((m, t) => Math.max(m, t.order), 0) + 1;
      return { ...s, teams: [...s.teams, blankTeam(order, task)] };
    });

  const removeTeam = (id: string) =>
    update((s) => {
      const scores: SessionData['scores'] = {};
      for (const [jid, m] of Object.entries(s.scores)) {
        const copy = { ...m };
        delete copy[id];
        scores[jid] = copy;
      }
      return { ...s, teams: s.teams.filter((t) => t.id !== id), scores };
    });

  const otherActive = other.judges.filter((j) => j.active && j.name.trim());
  const namedCount = active.filter((j) => j.name.trim()).length;
  const anyScore = data.judges.some((j) => hasScores(data, j.id));

  const groups: { task: { id: TaskId; label: string } | null; teams: Team[] }[] = cfg.tasks
    ? cfg.tasks.map((task) => ({ task, teams: data.teams.filter((t) => t.task === task.id) }))
    : [{ task: null, teams: data.teams }];

  const expected = cfg.tasks ? `과제별 ${cfg.defaultTeams}팀 (총 ${cfg.defaultTeams * cfg.tasks.length}팀)` : `총 ${cfg.defaultTeams}팀`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>심사 설정</h1>
          <p>
            심사위원과 결선 진출팀을 등록합니다. 결선 대상: {expected}
          </p>
        </div>
        <div className="spacer" />
        <label className="switch" style={{ gap: 10 }}>
          결선 일자
          <input
            className="input"
            type="date"
            value={eventDate}
            onChange={(e) => onEventDate(e.target.value)}
            style={{ width: 160 }}
            aria-label="결선 일자"
          />
        </label>
      </div>

      {locked && (
        <div className="notices">
          <div className="notice warn">집계가 확정되어 잠겨 있습니다. 수정이 필요한 경우 [4. 서명·확정]에서 잠금을 해제하시기 바랍니다.</div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>심사위원</h2>
          <span className="badge brand">참여 {active.length}명</span>
          <span className="hint">위원장은 1명을 지정합니다. 심사 도중 빠지는 심사위원을 ‘제외’ 처리하면 점수는 집계에서 제외되고 기록은 유지됩니다.</span>
          <div className="right">
            {otherActive.length > 0 && (
              <ConfirmButton
                className="sm"
                disabled={locked}
                confirmText={anyScore ? '입력 점수 삭제 · 다시 누르면 복사' : '다시 누르면 복사'}
                onConfirm={importJudges}
              >
                {cfg.id === 's1' ? '세션 2' : '세션 1'} 심사위원 명단 복사
              </ConfirmButton>
            )}
            <button
              type="button"
              className="btn sm primary"
              disabled={locked}
              onClick={() => update((s) => ({ ...s, judges: [...s.judges, blankJudge(!s.judges.some((j) => j.isChair && j.active))] }))}
            >
              + 심사위원 추가
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 50 }}>No.</th>
                <th style={{ width: 80 }} className="c">위원장</th>
                <th>성명</th>
                <th>소속</th>
                <th>직위</th>
                <th style={{ width: 90 }} className="c">상태</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {data.judges.map((j, i) => (
                <tr key={j.id} className={j.active ? '' : 'muted'}>
                  <td>{i + 1}</td>
                  <td className="c">
                    <input
                      type="radio"
                      name={`chair-${cfg.id}`}
                      checked={j.isChair}
                      disabled={locked || !j.active}
                      onChange={() => setChair(j.id)}
                      aria-label={`${j.name || `위원 ${i + 1}`} 위원장 지정`}
                    />
                  </td>
                  <td>
                    <input
                      id={judgeNameId(j.id)}
                      className={`input${j.active && !j.name.trim() ? ' invalid' : ''}`}
                      value={j.name}
                      placeholder="성명"
                      disabled={locked}
                      onChange={(e) => setJudge(j.id, { name: e.target.value })}
                      aria-label="성명"
                    />
                  </td>
                  <td>
                    <input className="input" value={j.org} placeholder="소속 기관" disabled={locked} onChange={(e) => setJudge(j.id, { org: e.target.value })} aria-label="소속" />
                  </td>
                  <td>
                    <input className="input" value={j.position} placeholder="직위" disabled={locked} onChange={(e) => setJudge(j.id, { position: e.target.value })} aria-label="직위" />
                  </td>
                  <td className="c">{j.active ? <span className="badge ok">참여</span> : <span className="badge">제외</span>}</td>
                  <td>
                    <div className="row-actions">
                      {hasScores(data, j.id) ? (
                        <button type="button" className="btn sm" disabled={locked} onClick={() => toggleActive(j.id, j.active)}>
                          {j.active ? '제외' : '다시 참여'}
                        </button>
                      ) : (
                        <ConfirmButton className="sm danger" disabled={locked} confirmText="삭제 확인" onConfirm={() => removeJudge(j.id)}>
                          삭제
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.judges.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">등록된 심사위원이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(namedCount < active.length || active.length < 3) && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            {namedCount < active.length && <div className="notice warn">참여 심사위원 중 성명이 입력되지 않은 심사위원이 있습니다. 서명 전까지 입력하시기 바랍니다.</div>}
            {active.length < 3 && (
              <div className="notice bad">참여 심사위원이 3명 미만인 경우 최고·최저점을 제외한 트림평균을 산출할 수 없습니다(산술평균으로 표시).</div>
            )}
          </div>
        )}
      </section>

      {groups.map(({ task, teams }) => (
        <section className="card" key={task?.id ?? 'all'}>
          <div className="card-head">
            <h2>{task ? `과제 · ${task.label}` : '결선 진출팀'}</h2>
            <span className={`badge ${teams.filter((t) => !t.withdrawn).length === cfg.defaultTeams ? 'ok' : 'warn'}`}>
              {teams.filter((t) => !t.withdrawn).length} / {cfg.defaultTeams}팀
            </span>
            <span className="hint">발표 순서대로 입력합니다. 불참(기권) 팀은 순위·시상에서 제외됩니다.</span>
            <div className="right">
              <button type="button" className="btn sm" disabled={locked} onClick={() => addTeam(task?.id ?? null)}>
                + 팀 추가
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>발표순</th>
                  <th>기관명</th>
                  <th>팀명</th>
                  <th>작품명(도구명)</th>
                  {cfg.topics && <th style={{ width: 150 }}>주제 유형</th>}
                  <th style={{ width: 120 }}>발표자</th>
                  {cfg.tasks && <th style={{ width: 100 }} className="r" title="결선 동점 처리 시에만 사용">예선 점수</th>}
                  <th style={{ width: 90 }} className="c">불참(기권)</th>
                  <th style={{ width: 90 }} className="c" title="심사위원회가 수준 미달로 판단한 경우">상 미수여</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {[...teams]
                  .sort((a, b) => a.order - b.order)
                  .map((t) => (
                    <tr key={t.id} className={t.withdrawn ? 'muted' : ''}>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={t.order}
                          disabled={locked}
                          onChange={(e) => setTeam(t.id, { order: Number(e.target.value) || 1 })}
                          aria-label="발표 순서"
                        />
                      </td>
                      <td>
                        <input id={teamFieldId(t.id, 'org')} className={`input${!t.org.trim() ? ' invalid' : ''}`} value={t.org} placeholder="기관명" disabled={locked} onChange={(e) => setTeam(t.id, { org: e.target.value })} aria-label="기관명" />
                      </td>
                      <td>
                        <input id={teamFieldId(t.id, 'teamName')} className={`input${!t.teamName.trim() ? ' invalid' : ''}`} value={t.teamName} placeholder="팀명" disabled={locked} onChange={(e) => setTeam(t.id, { teamName: e.target.value })} aria-label="팀명" />
                      </td>
                      <td>
                        <input className="input" value={t.work} placeholder="작품명" disabled={locked} onChange={(e) => setTeam(t.id, { work: e.target.value })} aria-label="작품명" />
                      </td>
                      {cfg.topics && (
                        <td>
                          <select className="select" value={t.topic ?? ''} disabled={locked} onChange={(e) => setTeam(t.id, { topic: e.target.value || null })} aria-label="주제 유형">
                            <option value="">선택</option>
                            {cfg.topics.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                          </select>
                        </td>
                      )}
                      <td>
                        <input className="input" value={t.presenter} placeholder="발표자" disabled={locked} onChange={(e) => setTeam(t.id, { presenter: e.target.value })} aria-label="발표자" />
                      </td>
                      {cfg.tasks && (
                        <td className="r">
                          <input
                            className="input num"
                            type="number"
                            step="0.01"
                            min={0}
                            max={100}
                            value={t.prelimScore ?? ''}
                            disabled={locked}
                            onChange={(e) => setTeam(t.id, { prelimScore: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label="예선 점수"
                          />
                        </td>
                      )}
                      <td className="c">
                        <input type="checkbox" checked={t.withdrawn} disabled={locked} onChange={(e) => setTeam(t.id, { withdrawn: e.target.checked })} aria-label="불참(기권)" />
                      </td>
                      <td className="c">
                        <input type="checkbox" checked={t.awardWithheld} disabled={locked} onChange={(e) => setTeam(t.id, { awardWithheld: e.target.checked })} aria-label="상 미수여" />
                      </td>
                      <td>
                        <div className="row-actions">
                          <ConfirmButton className="sm danger" disabled={locked} confirmText="삭제 확인" onConfirm={() => removeTeam(t.id)}>
                            삭제
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty">등록된 팀이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card-head">
          <h2>적용 기준</h2>
          <span className="hint">{cfg.source}</span>
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="tbl crit-tbl">
              <colgroup>
                <col style={{ width: 110 }} />
                <col style={{ width: 64 }} />
                <col />
                {[0, 1, 2, 3, 4].map((k) => <col key={k} style={{ width: 84 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>지표</th>
                  <th className="num">배점</th>
                  <th>평가 기준</th>
                  <th className="lv">매우 우수</th>
                  <th className="lv">우수</th>
                  <th className="lv">보통</th>
                  <th className="lv">미흡</th>
                  <th className="lv">매우 미흡</th>
                </tr>
              </thead>
              <tbody>
                {cfg.criteria.map((c) => (
                  <tr key={c.key}>
                    <td><b>{c.label}</b></td>
                    <td className="num">{c.max}</td>
                    <td style={{ color: 'var(--ink-2)', whiteSpace: 'pre-line' }}>{c.desc}</td>
                    {[1, 0.8, 0.6, 0.4, 0.2].map((r) => (
                      <td key={r} className="lv">{Math.round(c.max * r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="src">
            산식: (심사위원 점수 합계 − 최고점 − 최저점) ÷ (심사위원 수 − 2), 소수점 셋째 자리 반올림 · 회피 심사위원이 있는 팀은 나머지 심사위원 점수로 동일 산식 적용 · 결선 점수만으로 순위 결정
            <br />
            동점: {cfg.tieBreakNote}
          </div>
        </div>
      </section>
    </>
  );
}
