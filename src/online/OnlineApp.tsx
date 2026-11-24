import { type FormEvent, useEffect, useState } from 'react';
import { SESSIONS } from '../model';
import { CorpApp } from '../layouts/Corp';
import { ApiError, type JudgeSession, type LoginResult, login, saveCode, saveSession, savedCode, savedSession } from './client';
import { JudgeApp } from './JudgeApp';
import { NetBackground } from './NetBackground';
import logos from '../assets/logos-white.png';
import { useRemoteAdmin } from './useRemoteAdmin';

type Session = { code: string; who: LoginResult };

export function OnlineApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [picked, setPicked] = useState<string | null>(() => savedSession());
  const [checking, setChecking] = useState(() => savedCode() !== null);

  // 기억해 둔 코드가 있으면 다시 입력하지 않는다. 코드가 틀렸다는 답(401·403)일 때만 지우고, 연결 문제면 그대로 둔다
  useEffect(() => {
    const code = savedCode();
    if (!code) return;
    login(code)
      .then((who) => setSession({ code, who }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) saveCode(null);
      })
      .finally(() => setChecking(false));
  }, []);

  const pick = (sid: string | null) => {
    saveSession(sid);
    setPicked(sid);
  };

  const logout = () => {
    saveCode(null);
    pick(null);
    setSession(null);
  };

  if (checking) return <div className="ol-center">접속 정보를 확인하고 있습니다.</div>;
  if (!session) return <Login onDone={(s) => setSession(s)} />;
  if (session.who.role === 'admin') return <Admin code={session.code} logout={logout} />;

  const list = session.who.sessions;
  const seat = list.find((s) => s.sid === picked) ?? null;
  if (!seat) return <PickSession sessions={list} onPick={pick} logout={logout} />;
  return <JudgeApp key={seat.sid} code={session.code} sid={seat.sid} logout={logout} sessions={list.map((s) => s.sid)} onPick={pick} />;
}

// 세션1·2를 모두 심사하는 위원: 지금 심사할 세션 고르기
function PickSession({ sessions, onPick, logout }: { sessions: JudgeSession[]; onPick: (sid: string) => void; logout: () => void }) {
  return (
    <div className="lp">
      <section className="lp-hero lp-center">
        <NetBackground />
        <div className="ol-card lp-card">
          <p className="ol-eyebrow">2026 공공 AI 대전환 챌린지</p>
          <h1>{sessions[0].name} 위원님</h1>
          <p className="ol-hint">{sessions.length > 1 ? '심사할 세션을 선택하시기 바랍니다. 다른 세션은 화면 상단 [세션 1]·[세션 2] 버튼으로 언제든 이동할 수 있습니다.' : '심사할 세션을 선택하시기 바랍니다.'}</p>
          {sessions.map((s) => (
            <button key={s.sid} type="button" className="btn primary" onClick={() => onPick(s.sid)}>
              {SESSIONS[s.sid].short} · {SESSIONS[s.sid].title}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          <button type="button" className="btn lp-back" onClick={logout}>
            메인 화면으로
          </button>
        </div>
      </section>
    </div>
  );
}

function Admin({ code, logout }: { code: string; logout: () => void }) {
  const { store, remote } = useRemoteAdmin(code);
  if (!store) {
    return (
      <div className="ol-center">
        {remote.notice ?? '심사 자료를 불러오고 있습니다.'}
        {remote.notice && <button type="button" className="btn" onClick={logout}>처음으로</button>}
      </div>
    );
  }
  return <CorpApp store={store} online={{ remote, logout, code }} />;
}

// 첫 화면: 시안 톤의 메인 화면. [심사위원 접속]·[운영진 접속]을 누르면 접속 코드 입력 창이 뜬다
function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [open, setOpen] = useState<'judge' | 'admin' | null>(null);
  return (
    <div className="lp">
      <section className="lp-hero">
        <NetBackground />
        <div className="lp-copy">
          <p className="lp-eyebrow">AI 직접개발, 실험에서 활용까지</p>
          <h1>
            2026 공공 AI
            <br />
            대전환 챌린지
          </h1>
          <p className="lp-meta">2026. 11. 25. | KINTEX 1전시장 204호</p>
          <img className="lp-logos" src={logos} alt="행정안전부, NIA 한국지능정보사회진흥원" />
          <div className="lp-btns">
            <button type="button" className="lp-go" onClick={() => setOpen('judge')}>
              심사위원 접속
              <span aria-hidden="true">↗</span>
            </button>
            <button type="button" className="lp-go" onClick={() => setOpen('admin')}>
              운영진 접속
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </section>
      {open && (
        <div className="lp-layer" onClick={(e) => e.target === e.currentTarget && setOpen(null)} onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}>
          <CodeForm kind={open} onDone={onDone} onClose={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}

function CodeForm({ kind, onDone, onClose }: { kind: 'judge' | 'admin'; onDone: (s: Session) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setErr(null);
    try {
      const who = await login(c);
      saveCode(c, who.role === 'judge');
      onDone({ code: c, who });
    } catch (ex) {
      // 심사위원은 이름으로 접속하므로, 틀렸을 때 안내도 이름 기준으로 한다
      const wrong = kind === 'judge' && ex instanceof ApiError && ex.status === 401;
      setErr(wrong ? '등록된 이름이 아닙니다. 이름을 다시 확인하시기 바랍니다.' : ex instanceof Error ? ex.message : '접속하지 못하였습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ol-card lp-card" role="dialog" aria-modal="true" aria-labelledby="lp-title" onSubmit={(e) => void submit(e)}>
        <button type="button" className="lp-x" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <p className="ol-eyebrow">2026 공공 AI 대전환 챌린지</p>
        <h1 id="lp-title">{kind === 'judge' ? '심사위원 접속' : '운영진 접속'}</h1>
        <label htmlFor="ol-code">{kind === 'judge' ? '이름' : '접속 코드'}</label>
        <input
          id="ol-code"
          autoFocus
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={kind === 'judge' ? '이름을 입력하세요' : undefined}
          aria-describedby={err ? 'ol-err' : undefined}
        />
        {err && <p id="ol-err" className="ol-err" role="alert">{err}</p>}
        <button type="submit" className="btn primary" disabled={busy || !code.trim()}>
          {busy ? '확인 중…' : '접속'}
          {!busy && <span aria-hidden="true">↗</span>}
        </button>
      </form>
  );
}
