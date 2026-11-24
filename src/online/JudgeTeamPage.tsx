import { useState } from 'react';
import { LEVELS, levelPoints, RUN_CHECKS, type SessionConfig, type SessionData } from '../model';
import { entryOf, entryTotal, isDone, setLevel, setNote, setRecused, toggleLevel } from '../scoreOps';
import { PointsInput } from '../components/PointsInput';
import { MaterialButtons } from './MaterialViews';
import type { Material } from './materials';
import { teamSub, teamTitle } from '../components/ui';

type Update = (fn: (s: SessionData) => SessionData) => void;

// 심사위원 점수 입력: 한 화면에 한 팀. 위쪽 팀 번호로 바로 이동, 아래 [이전 팀]·[다음 팀]
export function JudgeTeamPage({ cfg, data, update, materials }: { cfg: SessionConfig; data: SessionData; update: Update; materials: Record<string, Material[]> }) {
  const judge = data.judges[0];
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);
  const [idx, setIdx] = useState(0);
  if (!judge || teams.length === 0) return <div className="cp-empty">등록된 결선 진출팀이 없습니다. 운영진에 문의하시기 바랍니다.</div>;

  const cur = Math.min(idx, teams.length - 1);
  const t = teams[cur];
  const e = entryOf(data, judge.id, t.id);
  const off = data.locked || e.recused;
  const done = isDone(cfg, e);
  const task = cfg.tasks?.find((k) => k.id === t.task)?.label;
  const go = (i: number) => {
    setIdx(i);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="jt">
      <nav className="jt-nav" aria-label="평가 대상 팀 선택">
        {teams.map((x, i) => {
          const ok = isDone(cfg, entryOf(data, judge.id, x.id));
          return (
            <button key={x.id} type="button" aria-current={i === cur ? 'true' : undefined} className={ok ? 'ok' : ''} onClick={() => go(i)} title={teamTitle(x)}>
              팀{x.order}
              <span className="sr">{ok ? ' 평가 완료' : ' 미평가'}</span>
            </button>
          );
        })}
      </nav>

      <article className="jt-card">
        <header className="jt-head">
          <div>
            <p className="jt-no">
              발표 {t.order}번{task ? ` · ${task}` : ''}
            </p>
            <h3>{teamTitle(t)}</h3>
            <p className="jt-sub">{teamSub(t)}</p>
          </div>
          <div className="jt-total">
            <span>합계</span>
            <b>{e.recused ? '회피' : done ? entryTotal(cfg, e) : '–'}</b>
            <label className="jt-rec">
              <input type="checkbox" checked={e.recused} disabled={data.locked} onChange={(ev) => setRecused(update, judge.id, t.id, ev.target.checked)} />
              평가 회피 (이해관계 해당)
            </label>
          </div>
        </header>

        <MaterialButtons key={t.id} files={materials[t.id]} />

        <ul className="jt-crit">
          {cfg.criteria.map((c) => (
            <li key={c.key}>
              <div className="jt-cl">
                <b>
                  {c.label} <small>({c.max}점)</small>
                </b>
                <p>{c.desc}</p>
              </div>
              {cfg.scale === 'points' ? (
                <div className="jt-pt">
                  <PointsInput key={t.id + c.key} value={e.levels[c.key]} max={c.max} disabled={off} label={c.label} onChange={(v) => setLevel(update, judge.id, t.id, c.key, v)} />
                  <span>/ {c.max}점</span>
                </div>
              ) : (
                <div className="jt-lv" role="group" aria-label={`${c.label} 평가`}>
                  {LEVELS.map((lv, li) => (
                    <button key={lv.label} type="button" disabled={off} aria-pressed={e.levels[c.key] === li} onClick={() => toggleLevel(update, judge.id, t.id, c.key, li)}>
                      <b>{levelPoints(c.max, li)}</b>
                      <span>{lv.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {cfg.opinion && !e.recused && (
          <div className="jt-op">
            <div>
              <span className="lb">구동 확인 결과</span>
              <div className="jt-run" role="group" aria-label="구동 확인 결과">
                {RUN_CHECKS.map((r) => (
                  <button key={r.id} type="button" disabled={data.locked} aria-pressed={e.run === r.id} onClick={() => setNote(update, judge.id, t.id, { run: e.run === r.id ? null : r.id })}>
                    {r.label}
                  </button>
                ))}
              </div>
              {e.run === 'fail' && (
                <input className={`input${e.runReason?.trim() ? '' : ' invalid'}`} value={e.runReason ?? ''} placeholder="구동 불가 사유" disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { runReason: ev.target.value })} aria-label="구동 불가 사유" />
              )}
            </div>
            <label>
              <span className="lb">주요 강점</span>
              <textarea className="input" rows={3} value={e.strengths ?? ''} disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { strengths: ev.target.value })} />
            </label>
            <label>
              <span className="lb">보완 필요사항</span>
              <textarea className="input" rows={3} value={e.improve ?? ''} disabled={data.locked} onChange={(ev) => setNote(update, judge.id, t.id, { improve: ev.target.value })} />
            </label>
          </div>
        )}

        <footer className="jt-foot">
          <button type="button" className="btn" disabled={cur === 0} onClick={() => go(cur - 1)}>
            이전 팀
          </button>
          <span>
            {cur + 1} / {teams.length}
          </span>
          <button type="button" className="btn primary" disabled={cur === teams.length - 1} onClick={() => go(cur + 1)}>
            다음 팀
          </button>
        </footer>
      </article>
    </div>
  );
}
