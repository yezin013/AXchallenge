import { SESSIONS, SIG_MAX_CHARS, type SessionData, type SessionId, type Signature } from '../src/model';
import { type JudgeAccess, type JudgeView, allScored, buildJudgeView, validEntry } from '../src/online/protocol';
import { type Full, codeOf, db, fail, guarded, identify, json, readAll, seatOf, sinceOf } from './_lib';

// 심사위원 한 명이 보는 세션 전체를 서버에서만 조립한다 (응답에는 본인 점수만 담긴다)
type Loaded = { who: { sid: SessionId; judgeId: string }; data: SessionData; view: JudgeView; access: Record<string, JudgeAccess>; ver: number };

async function load(req: Request, since: number | null): Promise<Response | Loaded | { ver: number; unchanged: true }> {
  if (!db) return fail(503, '저장소가 연결되지 않았습니다.');
  const found = await identify(codeOf(req));
  if (found?.role !== 'judge') return fail(401, '심사위원 접속 코드가 필요합니다.');
  const who = seatOf(found, req);
  if (!who) return fail(400, '심사할 세션을 먼저 선택하시기 바랍니다.');
  const all = await readAll(since);
  if ('unchanged' in all && all.unchanged) return all;
  const s = all as Full;
  if (!s.config) return fail(404, '심사 설정이 아직 등록되지 않았습니다.');
  const c = s.config.sessions[who.sid];
  const data: SessionData = { judges: c.judges, teams: c.teams, locked: c.locked, scores: s.scores[who.sid], signatures: s.signatures[who.sid] };
  const view = buildJudgeView(who.sid, data, s.config.eventDate, who.judgeId, s.access[who.sid]);
  if (!view) return fail(403, '심사위원 명단에서 제외된 코드입니다.');
  return { who, data, view, access: s.access[who.sid], ver: s.ver };
}

export async function GET(req: Request): Promise<Response> {
  return guarded(async () => {
    const r = await load(req, sinceOf(req));
    if (r instanceof Response) return r;
    if ('unchanged' in r) return json(r);
    // 수상 등급은 결과 발표 전까지 비공개(통합본 결과 보안): 순위·수상 행은 심사위원에게 보내지 않고, 서명에 필요한 값만 보낸다
    const result = r.view.result && { ...r.view.result, rows: [] };
    return json({ ...r.view, result, ver: r.ver });
  });
}

type Body = { op: 'score'; tid: string; entry: unknown } | { op: 'submit' } | { op: 'sign'; dataUrl: string };

export async function POST(req: Request): Promise<Response> {
  return guarded(async () => {
    const r = await load(req, null);
    if (r instanceof Response) return r;
    if (!db || 'unchanged' in r) return fail(503, '저장소가 연결되지 않았습니다.');
    const { who, data, view } = r;
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return fail(400, '요청 형식이 잘못되었습니다.');
    }
    if (view.locked) return fail(409, '집계가 확정되어 더 이상 수정할 수 없습니다.');

    switch (body.op) {
      case 'score': {
        if (view.submittedAt) return fail(409, '이미 제출하였습니다. 수정이 필요한 경우 운영진에 제출 취소를 요청하시기 바랍니다.');
        if (!view.teams.some((t) => t.id === body.tid)) return fail(400, '결선 팀이 아닙니다.');
        if (!validEntry(SESSIONS[who.sid], body.entry)) return fail(400, '점수 형식이 잘못되었습니다.');
        // 점수 조정과 그 이력은 운영진만 넣을 수 있다
        delete body.entry.adj;
        delete body.entry.adjLog;
        const { error } = await db.from('fj_score').upsert({ sid: who.sid, jid: who.judgeId, tid: body.tid, entry: body.entry, updated_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case 'submit': {
        if (view.submittedAt) return json({ ok: true });
        if (!allScored(who.sid, data, who.judgeId)) return fail(400, '아직 모든 점수가 입력되지 않았습니다.');
        if (!r.access[who.judgeId]) return fail(403, '접속 정보가 없습니다.');
        const now = new Date().toISOString();
        const { error } = await db.from('fj_access').update({ submitted_at: now, updated_at: now }).match({ sid: who.sid, jid: who.judgeId }).is('submitted_at', null);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case 'sign': {
        if (!view.result?.ready) return fail(409, '모든 심사위원의 제출과 집계가 완료된 후 서명할 수 있습니다.');
        if (typeof body.dataUrl !== 'string' || !body.dataUrl.startsWith('data:image/png;base64,') || body.dataUrl.length > SIG_MAX_CHARS) {
          return fail(400, '서명 형식이 잘못되었거나 너무 큽니다.');
        }
        const sig: Signature = { dataUrl: body.dataUrl, signedAt: new Date().toISOString(), digest: view.result.digest };
        const { error } = await db.from('fj_sig').upsert({ sid: who.sid, jid: who.judgeId, sig, updated_at: sig.signedAt });
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      default:
        return fail(400, '알 수 없는 요청입니다.');
    }
  });
}
