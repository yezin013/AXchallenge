import { useEffect, useMemo, useRef, useState } from 'react';
import { applyAdjustment, currentCrit, distributeTotal, makeAdjustment, planTeamFinal, rawCrit } from '../adjust';
import { type RankedTeam, type TeamResult, round2, trimmedMean } from '../calc';
import { ADJ_REASON_MAX, COMMENT_MAX, type Adjustment, type Judge, type SessionConfig, type SessionData, type Team } from '../model';
import { type Outcome, computeOutcome } from '../outcome';
import { entryOf } from '../scoreOps';
import { fmtDateTime, judgeLabel, teamSub, teamTitle } from './ui';

type Update = (fn: (s: SessionData) => SessionData) => void;
// 미반영 조정안: key = 위원id|팀id, adj = null 이면 원래 점수로 되돌리기
type Draft = { jid: string; tid: string; adj: Adjustment | null };
type SortKey = 'rank' | 'order' | 'name' | 'score' | `j:${string}`;
type Sort = { key: SortKey; dir: 1 | -1 };

const keyOf = (jid: string, tid: string) => `${jid}|${tid}`;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="lp-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ol-card lp-card fb-modal" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function History({ raw, log, cur }: { raw: number; log: Adjustment[]; cur: Adjustment | null | undefined }) {
  const all = [...log, ...(cur ? [cur] : [])];
  return (
    <ol className="fb-hist">
      <li>
        <b>{raw}점</b> <span>심사위원이 제출한 점수</span>
      </li>
      {all.map((a, i) => (
        <li key={a.at + i}>
          <b>{a.total}점</b> <span>{a.reason}</span> <small>{fmtDateTime(a.at)}</small>
        </li>
      ))}
    </ol>
  );
}

// 위원 한 명의 한 팀 점수 조정: 총점을 고치면 지표별 점수에 자동 배분, 지표별 직접 조정도 가능. 사유 필수
function AdjustDialog({ cfg, data, judge, judgeIndex, team, draft, onStage, onClose }: { cfg: SessionConfig; data: SessionData; judge: Judge; judgeIndex: number; team: Team; draft: Draft | undefined; onStage: (adj: Adjustment | null) => void; onClose: () => void }) {
  const entry = entryOf(data, judge.id, team.id);
  const maxima = cfg.criteria.map((c) => c.max);
  const cap = maxima.reduce((a, b) => a + b, 0);
  const raw = rawCrit(cfg, entry);
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const start = draft ? (draft.adj ? cfg.criteria.map((c) => draft.adj?.crit[c.key] ?? 0) : raw) : currentCrit(cfg, entry);
  const [crit, setCrit] = useState<string[]>(start.map(String));
  const [total, setTotal] = useState(String(start.reduce((a, b) => a + b, 0)));
  const [reason, setReason] = useState(draft?.adj?.reason ?? '');
  const [err, setErr] = useState<string | null>(null);

  const onTotal = (t: string) => {
    setTotal(t);
    const n = Number(t);
    if (t.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= cap) setCrit(distributeTotal(crit.map(Number), n, maxima).map(String));
  };
  const onCrit = (i: number, t: string) => {
    const next = crit.map((v, k) => (k === i ? t : v));
    setCrit(next);
    setTotal(String(next.reduce((a, v) => a + (Number(v) || 0), 0)));
  };
  const submit = () => {
    const nums = crit.map(Number);
    if (nums.some((v, i) => crit[i].trim() === '' || !Number.isInteger(v) || v < 0 || v > maxima[i])) return setErr('지표별 점수는 0점부터 배점까지의 정수로 입력하시기 바랍니다.');
    if (!reason.trim()) return setErr('조정 사유를 입력하시기 바랍니다.');
    onStage(makeAdjustment(cfg, nums, reason));
  };

  return (
    <Modal title="심사위원 점수 조정" onClose={onClose}>
      <p className="fb-who">
        <b>{teamTitle(team)}</b> · {judgeLabel(judge, judgeIndex)}
      </p>
      <p className="ol-hint">조정안에 담은 뒤 집계표에서 한 번에 최종 반영합니다. 이전 점수는 이력으로 보존됩니다.</p>
      <label htmlFor="fb-total">조정 점수 / {cap}</label>
      <input id="fb-total" className="input fb-big" type="number" min={0} max={cap} step={1} value={total} autoFocus onChange={(e) => onTotal(e.target.value)} />
      <details className="fb-det">
        <summary>지표별 직접 조정</summary>
        <div className="fb-crit">
          {cfg.criteria.map((c, i) => (
            <label key={c.key}>
              <span>
                {c.label} · {c.max}점
              </span>
              <input className="input" type="number" min={0} max={c.max} step={1} value={crit[i]} onChange={(e) => onCrit(i, e.target.value)} />
            </label>
          ))}
        </div>
      </details>
      <label htmlFor="fb-reason">조정 사유</label>
      <textarea id="fb-reason" className="input" rows={3} maxLength={ADJ_REASON_MAX} value={reason} placeholder="점수를 조정한 사유를 적어 주시기 바랍니다." onChange={(e) => setReason(e.target.value)} />
      <details className="fb-det">
        <summary>이전 점수·조정 이력</summary>
        <History raw={rawTotal} log={entry.adjLog ?? []} cur={entry.adj} />
      </details>
      {err && <p className="ol-err" role="alert">{err}</p>}
      <div className="fb-actions">
        {(entry.adj || draft?.adj) && (
          <button type="button" className="btn" onClick={() => onStage(null)}>
            원래 점수({rawTotal})로 되돌리기
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn primary" onClick={submit}>
          조정안에 담기
        </button>
      </div>
    </Modal>
  );
}

// 팀 최종 점수 직접 입력: 그 점수가 되도록 위원별 점수를 같은 폭으로 옮긴다
function TeamFinalDialog({ cfg, data, judges, result, onApply, onClose }: { cfg: SessionConfig; data: SessionData; judges: Judge[]; result: TeamResult; onApply: (changes: Draft[]) => void; onClose: () => void }) {
  const maxima = cfg.criteria.map((c) => c.max);
  const cap = maxima.reduce((a, b) => a + b, 0);
  const cells = result.cells.filter((c) => c.status === 'done');
  const now = cells.map((c) => c.total as number);
  const [target, setTarget] = useState(result.score?.toFixed(2) ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const t = Number(target);
  const ok = target.trim() !== '' && Number.isFinite(t) && t >= 0 && t <= cap;
  const plan = ok ? planTeamFinal(now, t, cap) : null;
  const after = plan ? trimmedMean(plan)?.value : null;

  const submit = () => {
    if (!plan) return setErr(`최종 점수는 0점부터 ${cap}점 사이로 입력하시기 바랍니다.`);
    if (!reason.trim()) return setErr('조정 사유를 입력하시기 바랍니다.');
    const changes: Draft[] = [];
    cells.forEach((c, i) => {
      if (plan[i] === now[i]) return;
      const entry = entryOf(data, c.judgeId, result.team.id);
      changes.push({ jid: c.judgeId, tid: result.team.id, adj: makeAdjustment(cfg, distributeTotal(currentCrit(cfg, entry), plan[i], maxima), `최종 점수 조정: ${reason.trim()}`.slice(0, ADJ_REASON_MAX)) });
    });
    onApply(changes);
  };

  return (
    <Modal title="팀 최종 점수 조정" onClose={onClose}>
      <p className="fb-who">
        <b>{teamTitle(result.team)}</b> · 현재 {result.score?.toFixed(2)}점
      </p>
      <p className="ol-hint">입력한 최종 점수가 되도록 심사위원별 점수를 같은 폭으로 옮깁니다. [반영]을 누르면 바로 저장되고, 이전 점수는 이력으로 보존됩니다.</p>
      <label htmlFor="fb-final">최종 점수 / {cap}</label>
      <input id="fb-final" className="input fb-big" type="number" min={0} max={cap} step={0.01} value={target} autoFocus onChange={(e) => setTarget(e.target.value)} />
      {plan && (
        <div className="fb-plan">
          <table className="tbl">
            <thead>
              <tr>
                <th>심사위원</th>
                <th className="num">현재</th>
                <th className="num">조정 후</th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c, i) => {
                const k = judges.findIndex((j) => j.id === c.judgeId);
                return (
                  <tr key={c.judgeId} className={plan[i] !== now[i] ? 'chg' : ''}>
                    <td>{k >= 0 ? judgeLabel(judges[k], k) : c.judgeId}</td>
                    <td className="num">{now[i]}</td>
                    <td className="num">
                      <b>{plan[i]}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="ol-hint">
            조정 후 최종 점수 <b>{after?.toFixed(2)}</b>점{after !== undefined && after !== null && after !== round2(t) ? ` (입력한 ${round2(t).toFixed(2)}점에 가장 가까운 점수입니다. 위원 점수가 정수라 딱 맞출 수 없습니다.)` : ''}
          </p>
        </div>
      )}
      <label htmlFor="fb-freason">조정 사유</label>
      <textarea id="fb-freason" className="input" rows={3} maxLength={ADJ_REASON_MAX - 12} value={reason} placeholder="최종 점수를 조정한 사유를 적어 주시기 바랍니다." onChange={(e) => setReason(e.target.value)} />
      {err && <p className="ol-err" role="alert">{err}</p>}
      <div className="fb-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn primary" onClick={submit}>
          반영
        </button>
      </div>
    </Modal>
  );
}

function CommentDialog({ team, onSave, onClose }: { team: Team; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(team.finalComment ?? '');
  return (
    <Modal title="최종 총평" onClose={onClose}>
      <p className="fb-who">
        <b>{teamTitle(team)}</b> <small className="sub">{teamSub(team)}</small>
      </p>
      <textarea className="input" rows={7} maxLength={COMMENT_MAX} value={text} autoFocus placeholder="심사 종료 후 종합 의견을 적어 주시기 바랍니다." aria-label={`${teamTitle(team)} 최종 총평`} onChange={(e) => setText(e.target.value)} />
      <div className="fb-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="btn primary" onClick={() => onSave(text.trim())}>
          총평 저장
        </button>
      </div>
    </Modal>
  );
}

function plainMean(r: TeamResult): string {
  const vals = r.cells.filter((c) => c.status === 'done').map((c) => c.total as number);
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '–';
}

type Row = { result: TeamResult; rank: number | null; tied: boolean };

function Board({ judges, ranked, pending, sort, onSort, showMean, onToggleMean, staged, locked, onCell, onFinal, onComment }: {
  judges: Judge[];
  ranked: RankedTeam[];
  pending: TeamResult[];
  sort: Sort;
  onSort: (k: SortKey) => void;
  showMean: boolean;
  onToggleMean: () => void;
  staged: Map<string, Draft>;
  locked: boolean;
  onCell: (jid: string, team: Team) => void;
  onFinal: (r: TeamResult) => void;
  onComment: (t: Team) => void;
}) {
  const rows: Row[] = [...ranked.map((r) => ({ result: r.result, rank: r.rank, tied: r.tied })), ...pending.map((r) => ({ result: r, rank: null, tied: false }))];
  const val = (r: Row): number | string | null => {
    if (sort.key === 'rank') return r.rank;
    if (sort.key === 'order') return r.result.team.order;
    if (sort.key === 'name') return teamTitle(r.result.team);
    if (sort.key === 'score') return r.result.score;
    const c = r.result.cells.find((x) => x.judgeId === sort.key.slice(2));
    return c?.status === 'done' ? c.total : null;
  };
  const sorted = [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av === null || bv === null) return Number(av === null) - Number(bv === null); // 값 없는 팀은 항상 아래
    const d = typeof av === 'string' ? av.localeCompare(String(bv), 'ko') : av - (bv as number);
    return d * sort.dir || a.result.team.order - b.result.team.order;
  });
  const th = (key: SortKey, label: React.ReactNode, cls = '') => {
    const on = sort.key === key;
    return (
      <th className={cls} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`fb-sort${on ? ' on' : ''}`} onClick={() => onSort(key)}>
          {label}
          <span aria-hidden="true">{on ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="table-wrap">
      <table className="tbl fb-tbl">
        <thead>
          <tr>
            {th('rank', '순위', 'c')}
            {th('order', '발표', 'c')}
            {th('name', '기관 · 팀명')}
            {judges.map((j, i) => (
              <th key={j.id} className="num" aria-sort={sort.key === `j:${j.id}` ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className={`fb-sort${sort.key === `j:${j.id}` ? ' on' : ''}`} onClick={() => onSort(`j:${j.id}`)}>
                  {judgeLabel(j, i)}
                  {j.isChair && <span className="chair-tag">장</span>}
                  <span aria-hidden="true">{sort.key === `j:${j.id}` ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                </button>
              </th>
            ))}
            <th className="num">최고점</th>
            <th className="num">최저점</th>
            <th className="num" aria-sort={sort.key === 'score' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onDoubleClick={onToggleMean}>
              <button type="button" className={`fb-sort${sort.key === 'score' ? ' on' : ''}`} onClick={() => onSort('score')}>
                트림평균<span aria-hidden="true">{sort.key === 'score' ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
              </button>
            </th>
            {showMean && <th className="num">전체 평균</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ result: r, rank, tied }) => {
            const vals = r.cells.filter((c) => c.status === 'done').map((c) => c.total as number);
            return (
              <tr key={r.team.id} className={rank === null ? 'muted' : ''}>
                <td className="c">{rank === null ? '–' : `${rank}${tied ? '=' : ''}`}</td>
                <td className="c">{r.team.order}</td>
                <td>
                  <div className="team-cell">
                    <strong>{teamTitle(r.team)}</strong>
                    <span>{teamSub(r.team)}</span>
                  </div>
                  {r.team.finalComment && <p className="fb-comment">{r.team.finalComment}</p>}
                  <button type="button" className="btn sm ghost fb-cbtn" disabled={locked} onClick={() => onComment(r.team)}>
                    {r.team.finalComment ? '총평 수정' : '총평 작성'}
                  </button>
                </td>
                {judges.map((j, k) => {
                  const c = r.cells.find((x) => x.judgeId === j.id);
                  if (!c || c.status === 'pending') return <td key={j.id} className="num" style={{ color: 'var(--warn)' }}>미입력</td>;
                  if (c.status === 'recused') return <td key={j.id} className="num" style={{ color: 'var(--ink-3)' }}>회피</td>;
                  const out = r.maxJudgeId === j.id || r.minJudgeId === j.id;
                  const isStaged = staged.has(keyOf(j.id, r.team.id));
                  return (
                    <td key={j.id} className={`num${isStaged ? ' fb-staged' : c.adjusted ? ' adj-td' : ''}`}>
                      <button type="button" className={`adj-btn ${out ? 'cell-x' : 'cell-in'}${c.adjusted ? ' adj-on' : ''}`} disabled={locked} title="눌러서 점수 조정" aria-label={`${teamTitle(r.team)} ${judgeLabel(j, k)} ${c.total}점, 눌러서 조정`} onClick={() => onCell(j.id, r.team)}>
                        {c.total}
                      </button>
                      {isStaged ? <span className="cell-tag fb-stag">조정안 · 미반영</span> : c.adjusted && <span className="cell-tag adj-tag">조정 (원래 {c.raw})</span>}
                      {out && <span className="cell-tag">{r.maxJudgeId === j.id ? '최고 제외' : '최저 제외'}</span>}
                    </td>
                  );
                })}
                <td className="num">{vals.length ? Math.max(...vals) : '–'}</td>
                <td className="num">{vals.length ? Math.min(...vals) : '–'}</td>
                <td className="num score">
                  {r.score === null ? (
                    <span className="badge warn">입력 중</span>
                  ) : (
                    <button type="button" className="adj-btn fb-final" disabled={locked} title="눌러서 팀 최종 점수 조정" aria-label={`${teamTitle(r.team)} 최종 점수 ${r.score.toFixed(2)}점, 눌러서 조정`} onClick={() => onFinal(r)}>
                      {r.score.toFixed(2)}
                    </button>
                  )}
                </td>
                {showMean && <td className="num">{plainMean(r)}</td>}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7 + judges.length} className="empty">집계할 팀이 없습니다.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// 운영진 최종 집계표: 점수 조정(조정안 → 한 번에 반영), 팀 최종 점수 직접 입력, 총평, 열 정렬, 숨긴 전체 평균
export function FinalBoard({ cfg, data, update, onDirty, children }: {
  cfg: SessionConfig;
  data: SessionData;
  update: Update;
  onDirty: (count: number) => void;
  // 미리보기 결과(조정안 포함)로 그릴 윗부분: 알림·수상 결과
  children: (outcome: Outcome, staged: number) => React.ReactNode;
}) {
  const judges = data.judges.filter((j) => j.active);
  const [staged, setStaged] = useState<Map<string, Draft>>(new Map());
  const [sort, setSort] = useState<Sort>({ key: 'rank', dir: 1 });
  const [showMean, setShowMean] = useState(false);
  const [cell, setCell] = useState<{ jid: string; team: Team } | null>(null);
  const [fin, setFin] = useState<TeamResult | null>(null);
  const [com, setCom] = useState<Team | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 조정안을 얹은 미리보기 자료
  const view = useMemo(() => {
    if (staged.size === 0) return data;
    const scores = { ...data.scores };
    for (const d of staged.values()) scores[d.jid] = { ...(scores[d.jid] ?? {}), [d.tid]: { ...entryOf(data, d.jid, d.tid), adj: d.adj } };
    return { ...data, scores };
  }, [data, staged]);
  const outcome = useMemo(() => computeOutcome(cfg, view), [cfg, view]);

  useEffect(() => onDirty(staged.size), [staged, onDirty]);
  useEffect(() => () => onDirty(0), [onDirty]);
  useEffect(() => {
    if (staged.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [staged]);

  const write = (changes: Draft[]) =>
    update((s) => {
      const scores = { ...s.scores };
      for (const d of changes) scores[d.jid] = { ...(scores[d.jid] ?? {}), [d.tid]: applyAdjustment(entryOf(s, d.jid, d.tid), d.adj) };
      return { ...s, scores };
    });
  const stage = (jid: string, tid: string, adj: Adjustment | null) => {
    setStaged((m) => new Map(m).set(keyOf(jid, tid), { jid, tid, adj }));
    setCell(null);
    setMsg(null);
  };
  const commit = () => {
    write([...staged.values()]);
    setMsg(`조정 점수 ${staged.size}건을 반영하였습니다. 순위와 수상 결과가 함께 바뀌었습니다.`);
    setStaged(new Map());
  };
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'rank' || key === 'order' || key === 'name' ? 1 : -1 }));

  const board = (ranked: RankedTeam[], pending: TeamResult[]) => (
    <Board
      judges={judges}
      ranked={ranked}
      pending={pending}
      sort={sort}
      onSort={onSort}
      showMean={showMean}
      onToggleMean={() => setShowMean((x) => !x)}
      staged={staged}
      locked={data.locked}
      onCell={(jid, team) => setCell({ jid, team })}
      onFinal={(r) => (staged.size ? setMsg('미반영 조정안을 먼저 반영하거나 취소한 뒤 팀 최종 점수를 조정하시기 바랍니다.') : setFin(r))}
      onComment={setCom}
    />
  );
  const cj = cell ? judges.findIndex((j) => j.id === cell.jid) : -1;

  return (
    <>
      {children(outcome, staged.size)}
      <h3 className="cp-h3">최종 집계표</h3>
      <p className="ol-hint fb-help">위원 점수를 누르면 점수를 조정할 수 있고, 트림평균을 누르면 팀 최종 점수를 직접 넣을 수 있습니다. 머리글을 누르면 그 기준으로 정렬됩니다.</p>
      {staged.size > 0 && (
        <div className="notice warn fb-bar" role="status">
          <span>
            <b>미반영 조정안 {staged.size}건</b> — 지금 보이는 점수·순위·수상 결과는 미리보기입니다. 최종 반영해야 저장됩니다.
          </span>
          <button type="button" className="btn sm" onClick={() => setStaged(new Map())}>
            조정안 취소
          </button>
          <button type="button" className="btn sm primary" onClick={commit}>
            {staged.size}건 한 번에 최종 반영
          </button>
        </div>
      )}
      {msg && <div className="notice ok" role="status">{msg}</div>}
      {outcome.s1 && <div className="cp-tbl">{board(outcome.s1.ranked, outcome.s1.pending)}</div>}
      {outcome.s2?.blocks.map((b) => (
        <div key={b.task.id}>
          <h4 className="cp-h4">{b.task.label}</h4>
          <div className="cp-tbl">{board(b.ranked, b.pending)}</div>
        </div>
      ))}
      {cell && cj >= 0 && <AdjustDialog cfg={cfg} data={data} judge={judges[cj]} judgeIndex={cj} team={cell.team} draft={staged.get(keyOf(cell.jid, cell.team.id))} onStage={(adj) => stage(cell.jid, cell.team.id, adj)} onClose={() => setCell(null)} />}
      {fin && (
        <TeamFinalDialog
          cfg={cfg}
          data={data}
          judges={judges}
          result={fin}
          onApply={(changes) => {
            write(changes);
            setFin(null);
            setMsg(changes.length ? `${teamTitle(fin.team)}의 최종 점수를 반영하였습니다. 심사위원 ${changes.length}명의 점수가 조정되었습니다.` : '바뀐 점수가 없습니다.');
          }}
          onClose={() => setFin(null)}
        />
      )}
      {com && (
        <CommentDialog
          team={com}
          onSave={(text) => {
            update((s) => ({ ...s, teams: s.teams.map((t) => (t.id === com.id ? { ...t, finalComment: text || undefined } : t)) }));
            setCom(null);
          }}
          onClose={() => setCom(null)}
        />
      )}
    </>
  );
}
