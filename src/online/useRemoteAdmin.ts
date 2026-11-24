import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData, SessionId } from '../model';
import { type Action, type Store, initialData, reducer } from '../store';
import { ApiError, api } from './client';
import { type AdminState, type Op, appOf, configOf, diffApp } from './protocol';

export type SyncStatus = 'loading' | 'saved' | 'saving' | 'offline';

export interface RemoteAdmin {
  status: SyncStatus;
  notice: string | null;
  access: AdminState['access'];
  makeCode: (sid: SessionId, jid: string) => Promise<void>;
  setCode: (sid: SessionId, jid: string, code: string) => Promise<void>;
  reopen: (sid: SessionId, jid: string) => Promise<void>;
}

type Pending = Op | { kind: 'replace' };
const keyOf = (o: Pending) =>
  o.kind === 'score' ? `s|${o.sid}|${o.jid}|${o.tid}` : o.kind === 'sig' ? `g|${o.sid}|${o.jid}` : o.kind;

const POLL_MS = 3000;
const QUIET_MS = 2000; // 마지막 입력 뒤 이 시간이 지나야 서버 내용으로 화면을 갱신

// 운영진 화면용 저장소: 화면은 기존 reducer 그대로 쓰고, 바뀐 부분만 서버로 보낸다
export function useRemoteAdmin(code: string): { store: Store | null; remote: RemoteAdmin } {
  const [state, setState] = useState<AppData | null>(null);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [access, setAccess] = useState<AdminState['access']>({ s1: {}, s2: {} });
  const cur = useRef<AppData | null>(null);
  const rev = useRef(0);
  const queue = useRef(new Map<string, Pending>());
  const flushing = useRef(false);
  const lastEdit = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const ver = useRef<number | null>(null); // 서버 변경 번호: 같으면 서버가 작은 응답만 보낸다

  const apply = useCallback((s: AdminState & { ver: number }) => {
    if (!s.config) return;
    const app = appOf(s.config, s.scores, s.signatures);
    rev.current = s.config.rev;
    cur.current = app;
    ver.current = s.ver;
    setState(app);
    setAccess(s.access);
  }, []);

  const pull = useCallback(async () => {
    const s = await api<AdminState & { ver: number }>('/api/admin', code);
    if (!s.config) {
      // 처음 쓰는 저장소: 빈 양식으로 시작
      const app = initialData();
      cur.current = app;
      setState(app);
      queue.current.set('replace', { kind: 'replace' });
      return false;
    }
    apply(s);
    return true;
  }, [apply, code]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.size > 0) {
        setStatus('saving');
        const [k, op] = queue.current.entries().next().value as [string, Pending];
        const app = cur.current;
        if (!app) break;
        try {
          if (op.kind === 'replace') {
            const r = await api<{ rev: number }>('/api/admin', code, { op: 'replace', app });
            rev.current = r.rev;
          } else if (op.kind === 'config') {
            const r = await api<{ rev: number }>('/api/admin', code, { op: 'config', config: configOf(app, rev.current) });
            rev.current = r.rev;
          } else if (op.kind === 'score') {
            await api('/api/admin', code, { op: 'score', sid: op.sid, jid: op.jid, tid: op.tid, entry: op.entry });
          } else {
            await api('/api/admin', code, { op: 'sig', sid: op.sid, jid: op.jid, sig: op.sig });
          }
          if (queue.current.get(k) === op) queue.current.delete(k);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            queue.current.clear();
            setNotice('다른 PC에서 먼저 설정을 변경하여 최신 내용으로 다시 불러왔습니다. 방금 변경한 설정을 확인하시기 바랍니다.');
            await pull();
            break;
          }
          setStatus('offline');
          setNotice(e instanceof Error ? e.message : '저장하지 못하였습니다.');
          window.setTimeout(() => void flush(), 3000);
          return;
        }
      }
      setStatus('saved');
      setNotice(null);
    } finally {
      flushing.current = false;
    }
  }, [code, pull]);

  const dispatch = useCallback(
    (action: Action) => {
      const prev = cur.current;
      if (!prev) return;
      const next = reducer(prev, action);
      cur.current = next;
      setState(next);
      lastEdit.current = Date.now();
      if (action.type === 'replace') {
        queue.current.clear();
        queue.current.set('replace', { kind: 'replace' });
      } else {
        for (const op of diffApp(prev, next)) queue.current.set(keyOf(op), op);
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 300);
    },
    [flush],
  );

  useEffect(() => {
    let alive = true;
    pull()
      .then(() => {
        if (alive) void flush();
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setStatus('offline');
        setNotice(e instanceof Error ? e.message : '불러오지 못하였습니다.');
      });
    const id = window.setInterval(() => {
      if (queue.current.size > 0 || flushing.current || Date.now() - lastEdit.current < QUIET_MS) return;
      const q = ver.current === null ? '' : `?since=${ver.current}`;
      api<(AdminState & { ver: number; unchanged?: undefined }) | { ver: number; unchanged: true }>(`/api/admin${q}`, code)
        .then((s) => {
          if (queue.current.size > 0 || Date.now() - lastEdit.current < QUIET_MS) return;
          if (!s.unchanged) apply(s);
          setStatus('saved');
          setNotice(null);
        })
        .catch((e: unknown) => {
          setStatus('offline');
          setNotice(e instanceof Error ? e.message : '서버에 연결하지 못하였습니다.');
        });
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [apply, code, flush, pull]);

  // 코드 발급·직접 입력: 서버가 같은 성명 위원(세션1·2)에 같은 코드를 넣고 그 자리 목록을 돌려준다
  const issue = useCallback(
    async (body: { op: 'code' | 'setCode'; sid: SessionId; jid: string; code?: string }) => {
      // 새 위원이면 명단부터 저장되어야 코드가 그 위원에 연결된다
      await flush();
      const r = await api<{ code: string; seats: { sid: SessionId; jid: string }[] }>('/api/admin', code, body);
      setAccess((a) => {
        const next = { ...a };
        for (const s of r.seats) next[s.sid] = { ...next[s.sid], [s.jid]: { code: r.code, submittedAt: a[s.sid][s.jid]?.submittedAt ?? null } };
        return next;
      });
    },
    [code, flush],
  );
  const makeCode = useCallback((sid: SessionId, jid: string) => issue({ op: 'code', sid, jid }), [issue]);
  const setCode = useCallback((sid: SessionId, jid: string, value: string) => issue({ op: 'setCode', sid, jid, code: value }), [issue]);

  const reopen = useCallback(
    async (sid: SessionId, jid: string) => {
      await api('/api/admin', code, { op: 'reopen', sid, jid });
      setAccess((a) => ({ ...a, [sid]: { ...a[sid], [jid]: { ...a[sid][jid], submittedAt: null } } }));
    },
    [code],
  );

  return { store: state ? ([state, dispatch] as const) : null, remote: { status, notice, access, makeCode, setCode, reopen } };
}
