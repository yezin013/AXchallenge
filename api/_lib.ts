// 서버 함수 공통: 저장소(Supabase) 연결, 접속 코드 확인, 저장소 읽기
import { timingSafeEqual, randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { SessionId, Signature, ScoreEntry } from '../src/model';
import { type AdminState, type ConfigDoc, SIDS } from '../src/online/protocol';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

// 비밀 키는 서버 함수 안에서만 쓴다 (화면 코드로 보내지 않음)
export const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const isSid = (v: unknown): v is SessionId => v === 's1' || v === 's2';

// 심사위원 한 명이 앉는 자리 (세션1·2를 모두 심사하면 같은 코드에 자리가 2개)
export type Seat = { sid: SessionId; judgeId: string };
export type Who = { role: 'admin' } | { role: 'judge'; seats: Seat[] };

// 접속 코드: 한글·영문 대문자·숫자 2~20자 (성명을 코드로 쓸 수 있다)
export const CODE_RE = /^[A-Z0-9가-힣]{2,20}$/;

export function isAdminCode(code: string): boolean {
  const admin = process.env.ADMIN_CODE;
  return !!admin && admin.length >= 4 && sameText(code, admin);
}

export async function identify(code: string | null): Promise<Who | null> {
  if (!db || !code) return null;
  if (isAdminCode(code)) return { role: 'admin' };
  if (!CODE_RE.test(code)) return null;
  const { data, error } = await db.from('fj_access').select('sid, jid').eq('code', code);
  if (error) throw new Error(error.message);
  const seats = (data ?? []).filter((r) => isSid(r.sid)).map((r) => ({ sid: r.sid as SessionId, judgeId: String(r.jid) }));
  return seats.length ? { role: 'judge', seats } : null;
}

export function codeOf(req: Request): string | null {
  // 한글 코드는 머리글에 그대로 못 실으므로 화면에서 퍼센트 인코딩해 보낸다
  const raw = req.headers.get('x-access-code');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim().toUpperCase() || null;
  } catch {
    return null;
  }
}

// 화면에서 고른 세션 (x-session). 자리가 하나뿐이면 고르지 않아도 된다.
export function seatOf(who: Who | null, req: Request): Seat | null {
  if (who?.role !== 'judge') return null;
  const sid = req.headers.get('x-session');
  return who.seats.find((s) => s.sid === sid) ?? (who.seats.length === 1 ? who.seats[0] : null);
}

// 화면이 마지막으로 받은 변경 번호 (?since=)
export function sinceOf(req: Request): number | null {
  const v = new URL(req.url).searchParams.get('since');
  return v && /^\d{1,15}$/.test(v) ? Number(v) : null;
}

// 헷갈리는 글자(0·O·1·I·L) 뺀 8자리
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[randomInt(ALPHA.length)];
  return s;
}

type Snap =
  | { ver: number; unchanged: true }
  | {
      ver: number;
      unchanged?: undefined;
      config: ConfigDoc | null;
      scores: { sid: string; jid: string; tid: string; entry: ScoreEntry }[];
      sigs: { sid: string; jid: string; sig: Signature }[];
      access: { sid: string; jid: string; code: string; submittedAt: string | null }[];
    };

export type Unchanged = { ver: number; unchanged: true };
export type Full = AdminState & { ver: number };

// 전체 상태를 한 번에 읽는다. since 가 지금 변경 번호와 같으면 { unchanged } 만 돌려준다.
export async function readAll(since: number | null = null): Promise<Unchanged | Full> {
  if (!db) throw new Error('저장소가 연결되지 않았습니다.');
  const { data, error } = await db.rpc('fj_snapshot', { p_since: since });
  if (error) throw new Error(error.message);
  const s = data as Snap;
  if (s.unchanged) return { ver: s.ver, unchanged: true };
  const state: Full = { ver: s.ver, config: s.config, scores: { s1: {}, s2: {} }, signatures: { s1: {}, s2: {} }, access: { s1: {}, s2: {} } };
  for (const r of s.scores) if (isSid(r.sid)) (state.scores[r.sid][r.jid] ??= {})[r.tid] = r.entry;
  for (const r of s.sigs) if (isSid(r.sid)) state.signatures[r.sid][r.jid] = r.sig;
  for (const r of s.access) if (isSid(r.sid)) state.access[r.sid][r.jid] = { code: r.code, submittedAt: r.submittedAt };
  for (const sid of SIDS) {
    // 명단에 있는 위원은 점수가 없어도 빈 칸으로 둔다
    for (const j of s.config?.sessions[sid].judges ?? []) state.scores[sid][j.id] ??= {};
  }
  return state;
}

export async function readConfig(): Promise<ConfigDoc | null> {
  if (!db) throw new Error('저장소가 연결되지 않았습니다.');
  const { data, error } = await db.from('fj_config').select('doc').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.doc as ConfigDoc | undefined) ?? null;
}

// 저장소 오류를 화면용 응답으로 바꾼다
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return fail(503, e instanceof Error ? `저장소 오류: ${e.message}` : '저장소 오류');
  }
}
