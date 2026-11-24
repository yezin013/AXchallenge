import { codeOf, db, fail, guarded, identify, json, readConfig } from './_lib';

// 접속 코드로 운영진/심사위원을 구분한다. 심사위원은 들어갈 수 있는 세션 목록을 받는다.
export async function POST(req: Request): Promise<Response> {
  if (!db) return fail(503, '저장소가 연결되지 않았습니다. 운영진에 알려 주시기 바랍니다.');
  return guarded(async () => {
    const who = await identify(codeOf(req));
    if (!who) return fail(401, '접속 코드가 일치하지 않습니다.');
    if (who.role === 'admin') return json(who);
    const config = await readConfig();
    const sessions = who.seats.flatMap((s) => {
      const judge = config?.sessions[s.sid].judges.find((j) => j.id === s.judgeId && j.active);
      return judge ? [{ sid: s.sid, judgeId: s.judgeId, name: judge.name }] : [];
    });
    if (sessions.length === 0) return fail(403, '심사위원 명단에서 제외된 코드입니다. 운영진에 문의하시기 바랍니다.');
    sessions.sort((a, b) => a.sid.localeCompare(b.sid));
    return json({ role: 'judge', sessions });
  });
}
