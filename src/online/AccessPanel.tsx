import { useState } from 'react';
import type { SessionConfig, SessionData } from '../model';
import { ConfirmButton, fmtDateTime, judgeLabel } from '../components/ui';
import type { RemoteAdmin } from './useRemoteAdmin';

// 운영진: 심사위원별 접속 코드 발급과 제출 현황
export function AccessPanel({ cfg, data, remote }: { cfg: SessionConfig; data: SessionData; remote: RemoteAdmin }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const judges = data.judges.filter((j) => j.active);
  const access = remote.access[cfg.id] ?? {};
  const run = async (jid: string, fn: () => Promise<void>) => {
    setBusy(jid);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리하지 못하였습니다.');
    } finally {
      setBusy(null);
    }
  };
  const submitted = judges.filter((j) => access[j.id]?.submittedAt).length;

  return (
    <section className="ol-access">
      <div className="ol-access-h">
        <h3 className="cp-h3">심사위원 접속 코드 · 제출 현황</h3>
        <span>
          제출 <b>{submitted}</b> / {judges.length}명 · 접속 주소 <b>{window.location.host}</b>
        </span>
      </div>
      {err && <div className="notice bad" role="alert">{err}</div>}
      <div className="cp-tbl">
        <table className="tbl">
          <thead>
            <tr>
              <th>심사위원</th>
              <th>접속 코드</th>
              <th>점수 제출</th>
              <th className="c">관리</th>
            </tr>
          </thead>
          <tbody>
            {judges.map((j, k) => {
              const a = access[j.id];
              return (
                <tr key={j.id}>
                  <td>
                    <b>{judgeLabel(j, k)}</b>
                    {j.isChair && <small className="sub"> 위원장</small>}
                  </td>
                  <td>
                    {a?.code ? <code className="ol-code">{a.code}</code> : <span className="mute">없음</span>}
                    <form
                      className="ol-code-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = (draft[j.id] ?? '').trim().toUpperCase();
                        void run(j.id, async () => {
                          await remote.setCode(cfg.id, j.id, v);
                          setDraft((d) => ({ ...d, [j.id]: '' }));
                        });
                      }}
                    >
                      <input
                        className="input"
                        value={draft[j.id] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [j.id]: e.target.value.toUpperCase().replace(/[^A-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '').slice(0, 20) }))}
                        placeholder="직접 입력 (2~20자)"
                        aria-label={`${judgeLabel(j, k)} 접속 코드 직접 입력`}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy === j.id || !j.name.trim()}
                      />
                      <button type="submit" className="btn sm" disabled={busy === j.id || !/^[A-Z0-9가-힣]{2,20}$/.test(draft[j.id] ?? '')}>
                        저장
                      </button>
                    </form>
                  </td>
                  <td>{a?.submittedAt ? <span className="badge ok">{fmtDateTime(a.submittedAt)} 제출</span> : <span className="badge">미제출</span>}</td>
                  <td className="c">
                    {a?.code ? (
                      <ConfirmButton className="sm ghost" disabled={busy === j.id} confirmText="기존 코드 사용 불가 · 다시 누르면 재발급" onConfirm={() => void run(j.id, () => remote.makeCode(cfg.id, j.id))}>
                        코드 재발급
                      </ConfirmButton>
                    ) : (
                      <button type="button" className="btn sm" disabled={busy === j.id || !j.name.trim()} onClick={() => void run(j.id, () => remote.makeCode(cfg.id, j.id))}>
                        코드 생성
                      </button>
                    )}{' '}
                    {a?.submittedAt && !data.locked && (
                      <ConfirmButton className="sm ghost" disabled={busy === j.id} confirmText="재입력 허용 · 다시 누르면 제출 취소" onConfirm={() => void run(j.id, () => remote.reopen(cfg.id, j.id))}>
                        제출 취소
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
