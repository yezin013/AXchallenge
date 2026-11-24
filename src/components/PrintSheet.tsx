import type { AwardState, RankedTeam, TeamResult } from '../calc';
import type { Judge, SessionConfig, SessionData } from '../model';
import type { Outcome } from '../outcome';
import { fmtEventDate, judgeLabel } from './ui';
import { remark } from './SummaryView';

interface Props {
  cfg: SessionConfig;
  data: SessionData;
  outcome: Outcome;
  eventDate: string;
}

export function awardText(a: AwardState | undefined): string {
  if (!a || a.kind === 'none') return '-';
  if (a.kind === 'decision') return '협의 필요';
  if (a.kind === 'withheld') return `${a.tier.name} 미수여`;
  return `${a.tier.name}(${a.tier.honor})`;
}

function cellText(r: TeamResult, j: Judge): string {
  const c = r.cells.find((x) => x.judgeId === j.id);
  if (!c || c.status === 'pending') return '';
  if (c.status === 'recused') return '회피';
  return String(c.total);
}

function Rows({ cfg, list, judges, outcome, task }: { cfg: SessionConfig; list: RankedTeam[]; judges: Judge[]; outcome: Outcome; task?: string }) {
  return (
    <>
      {list.map((rt) => {
        const r = rt.result;
        const vals = r.cells.filter((c) => c.status === 'done').map((c) => c.total as number);
        return (
          <tr key={r.team.id}>
            <td>{rt.rank}{rt.tied ? '(동)' : ''}</td>
            {task !== undefined && <td>{task}</td>}
            <td className="l">{r.team.org}</td>
            <td className="l">{r.team.teamName}{r.team.work ? ` (${r.team.work})` : ''}</td>
            {judges.map((j) => (
              <td key={j.id}>{cellText(r, j)}</td>
            ))}
            <td>{vals.length ? Math.max(...vals) : ''}</td>
            <td>{vals.length ? Math.min(...vals) : ''}</td>
            <td><b>{r.score?.toFixed(2)}</b></td>
            <td>{awardText(outcome.awards.get(r.team.id))}</td>
            <td className="l">{remark(rt, cfg)}</td>
          </tr>
        );
      })}
    </>
  );
}

export function PrintSheet({ cfg, data, outcome, eventDate }: Props) {
  const judges = data.judges.filter((j) => j.active);
  const signers = [...judges].sort((a, b) => Number(b.isChair) - Number(a.isChair));
  const head = (withTask: boolean) => (
    <thead>
      <tr>
        <th style={{ width: 40 }}>{withTask ? '과제 순위' : '순위'}</th>
        {withTask && <th>과제</th>}
        <th>기관명</th>
        <th>팀명(작품명)</th>
        {judges.map((j, i) => (
          <th key={j.id}>위원{i + 1}<br />{j.name}</th>
        ))}
        <th>최고점</th>
        <th>최저점</th>
        <th>트림평균</th>
        <th>수상</th>
        <th>비고</th>
      </tr>
    </thead>
  );

  return (
    <div className="ps">
      <h1>
        2026년 공공 AI 대전환 챌린지 {cfg.short} 「{cfg.title}」 결선 점수 집계{cfg.tasks ? ' 및 수상 확정표' : '표'}
      </h1>
      <p className="sub">결선 일자: {fmtEventDate(eventDate)} · 심사위원 {judges.length}명</p>

      {outcome.s1 && (
        <div className="block">
          <table>
            {head(false)}
            <tbody>
              <Rows cfg={cfg} list={outcome.s1.ranked} judges={judges} outcome={outcome} />
            </tbody>
          </table>
        </div>
      )}

      {outcome.s2 && (
        <>
          <h2>&lt; 과제별 점수 집계 &gt;</h2>
          <table>
            {head(true)}
            <tbody>
              {outcome.s2.blocks.map((b) => (
                <Rows key={b.task.id} cfg={cfg} list={b.ranked} judges={judges} outcome={outcome} task={b.task.label} />
              ))}
            </tbody>
          </table>
          <h2>&lt; 대상 선정(과제별 1위 비교) &gt;</h2>
          <table className="block">
            <thead>
              <tr>
                <th>구분</th>
                {outcome.s2.blocks.map((b) => (
                  <th key={b.task.id}>{b.task.label} 1위</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['기관·팀명', '결선 트림평균', '수상 결정'] as const).map((row) => (
                <tr key={row}>
                  <td>{row}</td>
                  {outcome.s2?.blocks.map((b) => {
                    const f = outcome.s2?.firsts.find((x) => x.result.team.task === b.task.id);
                    const v = !f
                      ? '미확정'
                      : row === '기관·팀명'
                        ? `${f.result.team.org} ${f.result.team.teamName}`
                        : row === '결선 트림평균'
                          ? (f.result.score?.toFixed(2) ?? '')
                          : awardText(outcome.awards.get(f.result.team.id));
                    return <td key={b.task.id}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="note">
        ※ 산식: (심사위원 점수 합계 − 최고점 − 최저점) ÷ (심사위원 수 − 2), 소수점 셋째 자리에서 반올림. 회피 위원이 있는 팀은 나머지 위원 점수로 같은 산식 적용.
        <br />※ 동점: {cfg.tieBreakNote}
        {cfg.tasks ? <><br />※ 과제별 1위 중 최고점 대상(국무총리상), 나머지 최우수상(행정안전부장관상), 과제별 2위 우수상(NIA원장상), 3위 장려상(NIA원장상)</> : <><br />※ 결선 1위 대상(대통령상), 2위 최우수상(국무총리상), 3~4위 우수상(행정안전부장관상), 5~10위 장려상(NIA원장상)</>}
      </p>

      <div className="signs" style={{ ['--cols' as string]: String(Math.max(signers.length, 1)) }}>
        {signers.map((j) => {
          const sig = data.signatures[j.id];
          const ok = sig && sig.digest === outcome.digest;
          return (
            <div key={j.id}>
              <div className="role">{j.isChair ? '위원장' : '위원'}</div>
              <div className="nm">{judgeLabel(j, judges.indexOf(j))}</div>
              {ok ? <img src={sig.dataUrl} alt="" /> : <div className="blank">(서명)</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
