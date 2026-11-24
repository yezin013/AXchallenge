import { LEVELS, critPoints, levelPoints, RUN_CHECKS, type SessionConfig, type SessionData } from '../model';
import type { Outcome } from '../outcome';
import { entryOf, entryTotal } from '../scoreOps';
import { judgeLabel } from './ui';

// 위원별 평가표 인쇄 — 세션별 첨부 양식을 따른다
const box = (on: boolean) => (on ? '■' : '□');

export function EvalSheets({ cfg, data, outcome }: { cfg: SessionConfig; data: SessionData; outcome: Outcome }) {
  return cfg.opinion ? <TeamSheets cfg={cfg} data={data} outcome={outcome} /> : <JudgeSheets cfg={cfg} data={data} outcome={outcome} />;
}

// 세션2 결선 평가표(심사계획(안) 붙임5): 위원 1명이 한 장에 9팀을 모두 기재
function JudgeSheets({ cfg, data, outcome }: { cfg: SessionConfig; data: SessionData; outcome: Outcome }) {
  const judges = data.judges.filter((j) => j.active);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  return (
    <div className="ev">
      {judges.map((j, k) => {
        const sig = data.signatures[j.id];
        const signed = sig && sig.digest === outcome.digest;
        return (
          <section key={j.id} className="ev-page">
            <h1>{cfg.short} 「{cfg.title}」 결선 평가표</h1>
            <table className="ev-info">
              <tbody>
                <tr>
                  <th>심사위원</th>
                  <td>{judgeLabel(j, k)}</td>
                  <th>서명</th>
                  <td className="sig">{signed ? <img src={sig.dataUrl} alt="" /> : <span>(서명)</span>}</td>
                </tr>
              </tbody>
            </table>
            <table className="ev-score">
              <thead>
                <tr>
                  <th>순번</th>
                  {cfg.tasks && <th>과제</th>}
                  <th>기관·팀명</th>
                  {cfg.criteria.map((c) => <th key={c.key}>{c.label}<br />({c.max})</th>)}
                  <th>총점<br />(100)</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const e = entryOf(data, j.id, t.id);
                  return (
                    <tr key={t.id}>
                      <td>{t.order}</td>
                      {cfg.tasks && <td>{cfg.tasks.find((tk) => tk.id === t.task)?.label}</td>}
                      <td className="l">{t.org} {t.teamName}</td>
                      {cfg.criteria.map((c) => {
                        const v = e.levels[c.key];
                        return <td key={c.key}>{e.recused || v === null || v === undefined ? '' : (e.adj?.crit[c.key] ?? critPoints(cfg, c.max, v))}</td>;
                      })}
                      <td><b>{e.recused ? '' : (e.adj?.total ?? entryTotal(cfg, e))}</b></td>
                      <td>{e.recused ? '회피' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {cfg.scale === 'level' && (
            <table className="ev-scale">
              <thead>
                <tr>
                  <th>지표</th>
                  {LEVELS.map((lv) => <th key={lv.label}>{lv.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {cfg.criteria.map((c) => (
                  <tr key={c.key}>
                    <th>{c.label}({c.max})</th>
                    {LEVELS.map((lv, li) => <td key={lv.label}>({levelPoints(c.max, li)}점)</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            )}
            <p className="ev-note">※ {cfg.scale === 'level' ? '지표별 5단계 점수 중 하나를 기재하며, ' : ''}이해충돌로 회피하는 팀은 비고란에 '회피'로 기재함</p>
          </section>
        );
      })}
    </div>
  );
}

// 세션1 심사평가표(심사평가표 양식 붙임1): 위원·팀마다 한 장
function TeamSheets({ cfg, data, outcome }: { cfg: SessionConfig; data: SessionData; outcome: Outcome }) {
  const judges = data.judges.filter((j) => j.active);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  const sheets = judges.flatMap((j, k) => teams.map((t) => ({ j, k, t, e: entryOf(data, j.id, t.id) }))).filter((x) => !x.e.recused);

  return (
    <div className="ev">
      {sheets.map(({ j, k, t, e }) => {
        const sig = data.signatures[j.id];
        const signed = sig && sig.digest === outcome.digest;
        const total = entryTotal(cfg, e);
        return (
          <section key={`${j.id}-${t.id}`} className="ev-page">
            <h1>{cfg.short} 「{cfg.title}」 심사평가표</h1>
            <table className="ev-info">
              <tbody>
                {cfg.tasks ? (
                  <tr>
                    <th>과제</th>
                    <td colSpan={3}>{cfg.tasks.map((tk) => `${box(t.task === tk.id)} ${tk.label}`).join('   ')}</td>
                  </tr>
                ) : (
                  <tr>
                    <th>구분</th>
                    <td colSpan={3}>□ 예선   ■ 결선</td>
                  </tr>
                )}
                <tr>
                  <th>출품작(도구명)</th>
                  <td>{t.work}</td>
                  <th>기관·팀명</th>
                  <td>{t.org} {t.teamName}</td>
                </tr>
                {cfg.topics && (
                  <tr>
                    <th>주제 유형</th>
                    <td colSpan={3}>{cfg.topics.map((tp) => `${box(t.topic === tp)} ${tp}`).join('   ')}</td>
                  </tr>
                )}
                <tr>
                  <th>심사위원</th>
                  <td>{judgeLabel(j, k)}</td>
                  <th>서명</th>
                  <td className="sig">{signed ? <img src={sig.dataUrl} alt="" /> : <span>(서명)</span>}</td>
                </tr>
              </tbody>
            </table>

            <table className="ev-score">
              <thead>
                <tr>
                  <th>평가 항목</th>
                  <th>배점</th>
                  <th>평가 기준</th>
                  {LEVELS.map((lv) => <th key={lv.label}>{lv.label}</th>)}
                  <th>점수</th>
                </tr>
              </thead>
              <tbody>
                {cfg.criteria.map((c) => {
                  const v = e.levels[c.key];
                  return (
                    <tr key={c.key}>
                      <th>{c.label}</th>
                      <td>{c.max}</td>
                      <td className="l pre">{c.desc}</td>
                      {LEVELS.map((lv, li) => (
                        <td key={lv.label} className={v === li ? 'on' : ''}>{v === li ? `■ ${levelPoints(c.max, li)}점` : `(${levelPoints(c.max, li)}점)`}</td>
                      ))}
                      <td><b>{v === null || v === undefined ? '' : levelPoints(c.max, v)}</b></td>
                    </tr>
                  );
                })}
                <tr>
                  <th>총점</th>
                  <td>100</td>
                  <td colSpan={LEVELS.length + 1} />
                  <td><b>{total}</b></td>
                </tr>
              </tbody>
            </table>
            <p className="ev-note">※ 지표별 5단계 중 하나를 선택하여 해당 점수를 기재함</p>

            <table className="ev-opinion">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>심사 의견</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>주요 강점</th>
                  <td className="l">{e.strengths}</td>
                </tr>
                <tr>
                  <th>보완 필요사항</th>
                  <td className="l">{e.improve}</td>
                </tr>
                <tr>
                  <th>구동 확인 결과</th>
                  <td className="l">
                    {RUN_CHECKS.map((r) => `${box(e.run === r.id)} ${r.label}${r.id === 'fail' ? `(사유: ${e.run === 'fail' ? (e.runReason ?? '') : '          '})` : ''}`).join('   ')}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
