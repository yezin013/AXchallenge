// 서버 함수 호출. 심사위원 접속 코드는 브라우저에 계속 기억하고, 운영진 코드는 이 탭에서만 기억한다.
const KEY = 'fj-access-code';
const SKEY = 'fj-session';

export function savedCode(): string | null {
  try {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// keep = true 면 브라우저를 닫았다 열어도 로그인이 유지된다 (심사위원). 운영진 코드는 이 탭에서만 기억한다
export function saveCode(code: string | null, keep = false) {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (code) (keep ? localStorage : sessionStorage).setItem(KEY, code);
  } catch {
    // 저장 못 해도 이번 화면에서는 계속 쓸 수 있다
  }
}

// 세션1·2를 모두 심사하는 위원이 고른 세션
export function savedSession(): string | null {
  try {
    return localStorage.getItem(SKEY);
  } catch {
    return null;
  }
}

export function saveSession(sid: string | null) {
  try {
    if (sid) localStorage.setItem(SKEY, sid);
    else localStorage.removeItem(SKEY);
  } catch {
    // 저장 못 해도 이번 화면에서는 계속 쓸 수 있다
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, code: string, body?: unknown, session?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-access-code': encodeURIComponent(code), ...(session ? { 'x-session': session } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, '인터넷 연결이 끊어졌습니다. 연결이 복구되면 자동으로 다시 저장합니다.', null);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : `서버 오류 (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export type JudgeSession = { sid: 's1' | 's2'; judgeId: string; name: string };
export type LoginResult = { role: 'admin' } | { role: 'judge'; sessions: JudgeSession[] };

export function login(code: string): Promise<LoginResult> {
  return api<LoginResult>('/api/login', code, {});
}
