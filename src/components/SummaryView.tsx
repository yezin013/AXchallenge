import type { RankedTeam, TeamResult } from '../calc';
import type { Judge, SessionConfig, SessionData } from '../model';
import type { Outcome, TieGroup } from '../outcome';
import { AwardTag, RankBadge, TeamLabel, judgeLabel, teamTitle } from './ui';
import { tieId } from '../missing';

interface Props {
  cfg: SessionConfig;
  data: SessionData;
  outcome: Outcome;
  signedValid: number;
  update: (fn: (s: SessionData) => SessionData) => void;
  onExport: () => void;
  onPrint: () => void;
}

function JudgeCells({ r, judges }: { r: TeamResult; judges: Judge[] }) {
  return (
    <>
      {judges.map((j) => {
        const c = r.cells.find((x) => x.judgeId === j.id);
        if (!c || c.status === 'pending') return <td key={j.id} className="num" style={{ color: 'var(--warn)' }}>미입력</td>;
        if (c.status === 'recused') return <td key={j.id} className="num" style={{ color: 'var(--ink-3)' }}>회피</td>;
        const isMax = r.maxJudgeId === j.id;
        const isMin = r.minJudgeId === j.id;
        return (
          <td key={j.id} className="num">
            <span className={isMax || isMin ? 'cell-x' : 'cell-in'}>{c.total}</span>
            {(isMax || isMin) && <span className="cell-tag">{isMax ? '최고 제외' : '최저 제외'}</span>}
          </td>
        );
      })}
    </>
  );
}

function maxMin(r: TeamResult): [string, string] {
  const vals = r.cells.filter((c) => c.status === 'done').map((c) => c.total as number);
  if (!vals.length) return ['–', '–'];
  return [String(Math.max(...vals)), String(Math.min(...vals))];
}

export function remark(rt: RankedTeam, cfg: SessionConfig): string {
  const notes: string[] = [];
  if (rt.result.method === 'mean') notes.push('유효 점수 3개 미만 → 산술평균');
  const recused = rt.result.cells.filter((c) => c.status === 'recused').length;
  if (recused) notes.push(`회피 ${recused}명`);
  if (rt.tied) notes.push('동점');
  if (rt.decidedBy && rt.decidedBy !== '심사위원 협의') notes.push(`동점 → ${rt.decidedBy}로 결정`);
  if (rt.manual) notes.push('동점 → 심사위원 협의로 결정');
  if (rt.result.team.awardWithheld) notes.push('상 미수여');
  if (cfg.tasks && rt.result.team.prelimScore !== null && rt.decidedBy === '예선 점수') notes.push(`예선 ${rt.result.team.prelimScore}점`);
  return notes.join(' · ');
}

export function TieResolver({ group, update }: { group: TieGroup; update: Props['update'] }) {
  const k = group.teams.length;
  return (
    <div id={tieId(group.key, group.field)} tabIndex={-1} className={`notice ${group.affectsAward ? 'bad' : 'warn'}`} style={{ display: 'block' }}>
      <b>{group.scope} 동점 {k}팀</b> — 총점과 동점 규정 지표가 모두 동일합니다.{' '}
      {group.affectsAward ? '수상 등급이 달라지므로 심사위원 협의 결과에 따라 순서를 정하여 주시기 바랍니다.' : '수상 등급이 동일하여 공동 순위로 처리합니다. 협의를 통해 순서를 정하면 반영됩니다.'}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
        {group.teams.map((t) => {
          const cur = t.team[group.field];
          const val = cur && cur.key === group.key ? String(cur.order) : '';
          return (
            <label key={t.team.id} className="switch" style={{ color: 'inherit' }}>
              <b>{teamTitle(t.team)}</b>
              <select
                className="select"
                style={{ width: 90, height: 30 }}
                value={val}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    teams: s.teams.map((x) =>
                      x.id === t.team.id ? { ...x, [group.field]: e.target.value ? { key: group.key, order: Number(e.target.value) } : null } : x,
                    ),
                  }))
                }
                aria-label={`${teamTitle(t.team)} 협의 순서`}
              >
                <option value="">순서</option>
                {Array.from({ length: k }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}번째
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function RankTable({
  cfg,
  judges,
  ranked,
  pending,
  outcome,
  showCrit,
}: {
  cfg: SessionConfig;
  judges: Judge[];
  ranked: RankedTeam[];
  pending: TeamResult[];
  outcome: Outcome;
  showCrit: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="c" style={{ width: 60 }}>순위</th>
            <th className="c" style={{ width: 56 }}>발표</th>
            <th>기관 · 팀명</th>
            {judges.map((j, i) => (
              <th key={j.id} className="num">
                {judgeLabel(j, i)}
                {j.isChair && <span className="chair-tag">장</span>}
              </th>
            ))}
            <th className="num">최고점</th>
            <th className="num">최저점</th>
            <th className="num">트림평균</th>
            {showCrit && cfg.criteria.map((c) => <th key={c.key} className="num" title="지표별 트림평균(동점 처리용)">{c.label}</th>)}
            <th>수상</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((rt) => {
            const [mx, mn] = maxMin(rt.result);
            const aw = outcome.awards.get(rt.result.team.id);
            return (
              <tr key={rt.result.team.id} className={aw?.kind === 'award' && aw.tier.key === 'grand' ? 'grand' : ''}>
                <td className="c"><RankBadge rank={rt.rank} tied={rt.tied} /></td>
                <td className="c">{rt.result.team.order}</td>
                <td><TeamLabel team={rt.result.team} /></td>
                <JudgeCells r={rt.result} judges={judges} />
                <td className="num">{mx}</td>
                <td className="num">{mn}</td>
                <td className="num score">{rt.result.score?.toFixed(2)}</td>
                {showCrit && cfg.criteria.map((c) => <td key={c.key} className="num">{rt.result.critScores[c.key]?.toFixed(2) ?? '–'}</td>)}
                <td><AwardTag state={aw} /></td>
                <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{remark(rt, cfg)}</td>
              </tr>
            );
          })}
          {pending.map((r) => {
            const [mx, mn] = maxMin(r);
            return (
              <tr key={r.team.id} className="muted">
                <td className="c">–</td>
                <td className="c">{r.team.order}</td>
                <td><TeamLabel team={r.team} /></td>
                <JudgeCells r={r} judges={judges} />
                <td className="num">{mx}</td>
                <td className="num">{mn}</td>
                <td className="num">–</td>
                {showCrit && cfg.criteria.map((c) => <td key={c.key} className="num">–</td>)}
                <td><span className="badge warn">입력 중</span></td>
                <td style={{ fontSize: 12 }}>{r.pendingCount}명 미입력</td>
              </tr>
            );
          })}
          {ranked.length + pending.length === 0 && (
            <tr>
              <td colSpan={8 + judges.length + (showCrit ? cfg.criteria.length : 0)} className="empty">집계할 팀이 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SummaryView({ cfg, data, outcome, signedValid, update, onExport, onPrint }: Props) {
  const judges = data.judges.filter((j) => j.active);
  const done = outcome.teamCount - outcome.pendingCount;
  const showCrit = outcome.ties.length > 0 || [...(outcome.s1?.ranked ?? []), ...(outcome.s2?.blocks.flatMap((b) => b.ranked) ?? [])].some((r) => r.decidedBy);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>최종 집계표</h1>
          <p>
            점수 입력과 동시에 트림평균·순위·수상이 자동 계산됩니다. 결선 점수만으로 순위를 결정합니다
            {cfg.tasks ? '(예선 점수는 동점 처리에만 사용)' : ''}.
          </p>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onExport}>엑셀 저장</button>
        <button type="button" className="btn primary" onClick={onPrint}>집계표 인쇄 · PDF</button>
      </div>

      <div className="kpis">
        <div className="kpi"><span>결선 팀</span><b>{outcome.teamCount}<small> 팀</small></b></div>
        <div className="kpi"><span>참여 심사위원</span><b>{judges.length}<small> 명</small></b></div>
        <div className="kpi"><span>점수 입력 완료</span><b>{done}<small> / {outcome.teamCount} 팀</small></b></div>
        <div className="kpi"><span>심사위원 서명</span><b>{signedValid}<small> / {judges.length} 명</small></b></div>
      </div>

      <div className="notices">
        {outcome.pendingCount > 0 && (
          <div className="notice warn">점수 입력이 완료되지 않은 팀이 {outcome.pendingCount}팀 있습니다. 입력이 완료된 팀만 잠정 순위를 표시합니다.</div>
        )}
        {outcome.meanCount > 0 && (
          <div className="notice warn">유효 점수가 3개 미만인 팀이 {outcome.meanCount}팀 있어 최고·최저점을 제외할 수 없습니다(산술평균 표시). 회피·제외 심사위원 수를 확인하시기 바랍니다.</div>
        )}
        {outcome.ties.map((g) => (
          <TieResolver key={g.key + g.field} group={g} update={update} />
        ))}
        {outcome.ready && <div className="notice ok">집계가 완료되었습니다. [4. 서명·확정]에서 심사위원 서명을 받으시기 바랍니다.</div>}
      </div>

      {outcome.s1 && (
        <section className="card">
          <div className="card-head">
            <h2>{cfg.short} {cfg.title} · 결선 점수 집계</h2>
            <span className="hint">취소선 = 트림평균에서 제외된 최고·최저점</span>
          </div>
          <RankTable cfg={cfg} judges={judges} ranked={outcome.s1.ranked} pending={outcome.s1.pending} outcome={outcome} showCrit={showCrit} />
        </section>
      )}

      {outcome.s2 && (
        <>
          {outcome.s2.blocks.map((b) => (
            <section className="card" key={b.task.id}>
              <div className="card-head">
                <h2>과제 · {b.task.label}</h2>
                <span className="hint">과제 내 순위: 1위 → 대상/최우수상 후보, 2위 우수상, 3위 장려상</span>
              </div>
              <RankTable cfg={cfg} judges={judges} ranked={b.ranked} pending={b.pending} outcome={outcome} showCrit={showCrit} />
            </section>
          ))}
          <section className="card">
            <div className="card-head">
              <h2>대상 선정 · 과제별 1위 비교</h2>
              <span className="hint">과제별 1위 중 결선 트림평균 최고점 팀이 대상, 나머지 2팀은 최우수상</span>
            </div>
            <div className="card-body">
              <div className="grand-compare">
                {outcome.s2.blocks.map((b) => {
                  const first = outcome.s2?.firsts.find((f) => f.result.team.task === b.task.id);
                  const aw = first ? outcome.awards.get(first.result.team.id) : undefined;
                  const win = aw?.kind === 'award' && aw.tier.key === 'grand';
                  return (
                    <div key={b.task.id} className={`gc${win ? ' win' : ''}`}>
                      <div className="task">{b.task.label} 1위</div>
                      <div className="name">{first ? teamTitle(first.result.team) : '미확정'}</div>
                      <div className="sc">{first?.result.score?.toFixed(2) ?? '–'}</div>
                      <div style={{ marginTop: 8 }}>{first ? <AwardTag state={aw} /> : <span className="badge warn">입력·동점 확인 필요</span>}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      )}

      <section className="card">
        <div className="card-body">
          <div className="legend">
            <span>산식: <b>(합계 − 최고점 − 최저점) ÷ (심사위원 수 − 2)</b>, 소수점 셋째 자리 반올림</span>
            <span>회피 심사위원이 있는 팀은 나머지 심사위원 점수로 동일 산식 적용</span>
          </div>
          <div className="src">동점: {cfg.tieBreakNote}</div>
        </div>
      </section>
    </>
  );
}
