import { SESSIONS, SIG_MAX_CHARS, type SessionId, type Signature } from '../src/model';
import type { AppData } from '../src/model';
import { type ConfigDoc, SIDS, configOf, validConfig, validEntry } from '../src/online/protocol';
import { CODE_RE, codeOf, db, fail, guarded, identify, isAdminCode, isSid, json, newCode, readAll, readConfig, sinceOf } from './_lib';

async function guard(req: Request): Promise<Response | null> {
  if (!db) return fail(503, '저장소가 연결되지 않았습니다.');
  const who = await identify(codeOf(req));
  return who?.role === 'admin' ? null : fail(401, '운영진 접속 코드가 필요합니다.');
}

export async function GET(req: Request): Promise<Response> {
  return guarded(async () => (await guard(req)) ?? json(await readAll(sinceOf(req))));
}

type Body =
  | { op: 'config'; config: ConfigDoc }
  | { op: 'score'; sid: SessionId; jid: string; tid: string; entry: unknown }
  | { op: 'sig'; sid: SessionId; jid: string; sig: Signature | null }
  | { op: 'code'; sid: SessionId; jid: string }
  | { op: 'setCode'; sid: SessionId; jid: string; code: unknown }
  | { op: 'reopen'; sid: SessionId; jid: string }
  | { op: 'replace'; app: AppData };

const validSig = (s: unknown): s is Signature => {
  const v = s as Partial<Signature> | null;
  return (
    !!v &&
    typeof v.dataUrl === 'string' &&
    v.dataUrl.startsWith('data:image/png;base64,') &&
    v.dataUrl.length <= SIG_MAX_CHARS &&
    typeof v.signedAt === 'string' &&
    v.signedAt.length <= 40 &&
    typeof v.digest === 'string' &&
    v.digest.length <= 200
  );
};

const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

// 같은 사람의 자리: 고른 위원 + 다른 세션의 같은 성명 위원 (한 사람은 세션1·2에 같은 코드)
function personSeats(config: ConfigDoc | null, sid: SessionId, jid: string): { sid: SessionId; jid: string }[] | null {
  const me = config?.sessions[sid].judges.find((j) => j.id === jid);
  const name = me?.name.trim();
  if (!config || !me || !name) return null;
  const seats = [{ sid, jid }];
  for (const other of SIDS) {
    if (other === sid) continue;
    const same = config.sessions[other].judges.find((j) => j.active && j.name.trim() === name);
    if (same) seats.push({ sid: other, jid: same.id });
  }
  return seats;
}

export async function POST(req: Request): Promise<Response> {
  return guarded(async () => {
    const bad = await guard(req);
    if (bad || !db) return bad ?? fail(503, '저장소가 연결되지 않았습니다.');
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return fail(400, '요청 형식이 잘못되었습니다.');
    }

    switch (body.op) {
      case 'config': {
        if (!validConfig(body.config)) return fail(400, '설정 형식이 잘못되었습니다.');
        const next = { ...body.config, rev: body.config.rev + 1 };
        // 같은 rev 일 때만 바꾼다 (다른 PC가 먼저 바꿨으면 0건 → 충돌)
        const { data, error } = await db.from('fj_config').update({ doc: next, updated_at: new Date().toISOString() }).eq('id', 1).eq('doc->>rev', String(body.config.rev)).select('id');
        if (error) throw new Error(error.message);
        if (data.length === 0) {
          const cur = await readConfig();
          if (!cur && body.config.rev === 0) {
            const ins = await db.from('fj_config').insert({ id: 1, doc: next });
            if (!ins.error) return json({ rev: next.rev });
          }
          return json({ error: '다른 PC에서 먼저 설정을 변경하였습니다.', config: await readConfig() }, 409);
        }
        return json({ rev: next.rev });
      }
      case 'score': {
        if (!isSid(body.sid) || !okId(body.jid) || !okId(body.tid)) return fail(400, '대상이 잘못되었습니다.');
        if (body.entry === null) {
          const { error } = await db.from('fj_score').delete().match({ sid: body.sid, jid: body.jid, tid: body.tid });
          if (error) throw new Error(error.message);
        } else if (validEntry(SESSIONS[body.sid], body.entry)) {
          const { error } = await db.from('fj_score').upsert({ sid: body.sid, jid: body.jid, tid: body.tid, entry: body.entry, updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
        } else return fail(400, '점수 형식이 잘못되었습니다.');
        return json({ ok: true });
      }
      case 'sig': {
        if (!isSid(body.sid) || !okId(body.jid)) return fail(400, '대상이 잘못되었습니다.');
        if (body.sig === null) {
          const { error } = await db.from('fj_sig').delete().match({ sid: body.sid, jid: body.jid });
          if (error) throw new Error(error.message);
        } else if (validSig(body.sig)) {
          const { error } = await db.from('fj_sig').upsert({ sid: body.sid, jid: body.jid, sig: body.sig, updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
        } else return fail(400, '서명 형식이 잘못되었거나 너무 큽니다.');
        return json({ ok: true });
      }
      case 'code':
      case 'setCode': {
        if (!isSid(body.sid) || !okId(body.jid)) return fail(400, '대상이 잘못되었습니다.');
        const seats = personSeats(await readConfig(), body.sid, body.jid);
        if (!seats) return fail(400, '명단에 없는 심사위원이거나 성명이 입력되지 않았습니다.');
        const store = db;
        const save = async (code: string): Promise<Response | null> => {
          // 다른 위원이 이미 쓰는 코드면 거부 (같은 위원의 세션1·2 자리는 같은 코드를 써도 된다)
          const { data: used, error: e1 } = await store.from('fj_access').select('sid, jid').eq('code', code);
          if (e1) throw new Error(e1.message);
          if ((used ?? []).some((u) => !seats.some((s) => s.sid === u.sid && s.jid === u.jid))) return null;
          const now = new Date().toISOString();
          const { error } = await store.from('fj_access').upsert(seats.map((s) => ({ sid: s.sid, jid: s.jid, code, updated_at: now })), { onConflict: 'sid,jid' });
          if (error && error.code !== '23505') throw new Error(error.message);
          return error ? null : json({ code, seats });
        };
        if (body.op === 'setCode') {
          const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
          if (!CODE_RE.test(code)) return fail(400, '코드는 한글·영문 대문자·숫자 2~20자로 입력하시기 바랍니다. (띄어쓰기·기호 제외)');
          if (isAdminCode(code)) return fail(400, '운영진 코드와 동일한 값은 사용할 수 없습니다.');
          return (await save(code)) ?? fail(409, '다른 심사위원이 이미 사용 중인 코드입니다.');
        }
        // 코드가 겹치면(아주 드묾) 다시 만든다. 제출 시각은 그대로 둔다.
        for (let i = 0; i < 5; i++) {
          const r = await save(newCode());
          if (r) return r;
        }
        return fail(500, '접속 코드를 생성하지 못하였습니다. 다시 시도하시기 바랍니다.');
      }
      case 'reopen': {
        if (!isSid(body.sid) || !okId(body.jid)) return fail(400, '대상이 잘못되었습니다.');
        const { error } = await db.from('fj_access').update({ submitted_at: null, updated_at: new Date().toISOString() }).match({ sid: body.sid, jid: body.jid });
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case 'replace': {
        // 백업 불러오기·초기화: 설정·점수·서명을 통째로 바꾼다. 접속 코드는 남아 있는 위원 것만 유지.
        const app = body.app;
        if (typeof app !== 'object' || app === null || app.version !== 1) return fail(400, '백업 형식이 잘못되었습니다.');
        const cur = await readConfig();
        const config = configOf(app, (cur?.rev ?? 0) + 1);
        if (!validConfig(config)) return fail(400, '백업 형식이 잘못되었거나 글자 수가 너무 많습니다.');
        const scores: { sid: SessionId; jid: string; tid: string; entry: unknown }[] = [];
        const sigs: { sid: SessionId; jid: string; sig: Signature }[] = [];
        for (const sid of SIDS) {
          for (const [jid, map] of Object.entries(app.sessions[sid].scores ?? {})) {
            if (!okId(jid)) continue;
            for (const [tid, entry] of Object.entries(map)) if (okId(tid) && validEntry(SESSIONS[sid], entry)) scores.push({ sid, jid, tid, entry });
          }
          for (const [jid, sig] of Object.entries(app.sessions[sid].signatures ?? {})) if (okId(jid) && validSig(sig)) sigs.push({ sid, jid, sig });
        }
        const { error } = await db.rpc('fj_replace', { p_doc: config, p_scores: scores, p_sigs: sigs });
        if (error) throw new Error(error.message);
        return json({ rev: config.rev });
      }
      default:
        return fail(400, '알 수 없는 요청입니다.');
    }
  });
}
