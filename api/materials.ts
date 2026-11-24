// 발표 자료: 비공개 저장소에 두고, 접속 코드로 확인된 운영진·심사위원에게만 1시간짜리 열람 주소를 준다
import type { SessionId } from '../src/model';
import { MATERIAL_EXT, MATERIAL_GROUPS, MATERIAL_MAX_BYTES, MATERIAL_MAX_PER_TEAM, type Material, type MaterialGroup, materialKey, materialName } from '../src/online/materials';
import { codeOf, db, fail, guarded, identify, isSid, json, readConfig, seatOf } from './_lib';

const BUCKET = 'fj-materials';
const VIEW_SECONDS = 3600;
const isGroup = (v: unknown): v is MaterialGroup => MATERIAL_GROUPS.some((g) => g.id === v);
// 제출 자료는 세션/팀 바로 아래, 최종 발표자료는 그 아래 final 폴더에 둔다
const dirOf = (sid: SessionId, tid: string, group: MaterialGroup) => (group === 'final' ? `${sid}/${tid}/final` : `${sid}/${tid}`);

async function teamIds(sid: SessionId): Promise<string[]> {
  const config = await readConfig();
  return (config?.sessions[sid].teams ?? []).map((t) => t.id);
}

async function listAll(sid: SessionId): Promise<Record<string, Material[]>> {
  if (!db) return {};
  const store = db.storage.from(BUCKET);
  const ids = await teamIds(sid);
  const out: Record<string, Material[]> = {};
  await Promise.all(
    ids.flatMap((tid) =>
      MATERIAL_GROUPS.map(async ({ id: group }) => {
        const dir = dirOf(sid, tid, group);
        const { data, error } = await store.list(dir, { limit: 50, sortBy: { column: 'name', order: 'asc' } });
        if (error || !data) return; // 저장소(버킷)가 아직 없으면 빈 목록
        const files = data.filter((f) => f.id !== null && materialName(f.name) !== null);
        if (files.length === 0) return;
        const paths = files.map((f) => `${dir}/${f.name}`);
        const signed = await store.createSignedUrls(paths, VIEW_SECONDS);
        if (signed.error) throw new Error(signed.error.message);
        const list = files.flatMap((f, i) => {
          const url = signed.data[i]?.signedUrl;
          const name = materialName(f.name);
          const size = typeof f.metadata?.size === 'number' ? f.metadata.size : 0;
          return url && name ? [{ path: paths[i], group, name, size, url }] : [];
        });
        out[tid] = [...(out[tid] ?? []), ...list];
      }),
    ),
  );
  // 제출 자료 먼저, 그 다음 최종 발표자료
  for (const tid of Object.keys(out)) out[tid].sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group === 'submit' ? -1 : 1));
  return out;
}

export async function GET(req: Request): Promise<Response> {
  return guarded(async () => {
    if (!db) return fail(503, '저장소가 연결되지 않았습니다.');
    const who = await identify(codeOf(req));
    if (!who) return fail(401, '접속 코드가 필요합니다.');
    const sid = who.role === 'admin' ? new URL(req.url).searchParams.get('sid') : seatOf(who, req)?.sid;
    if (!isSid(sid)) return fail(400, '세션을 먼저 선택하시기 바랍니다.');
    return json({ materials: await listAll(sid) });
  });
}

type Body = { op: 'upload'; sid: unknown; tid: unknown; group: unknown; name: unknown; size: unknown } | { op: 'delete'; path: unknown };

export async function POST(req: Request): Promise<Response> {
  return guarded(async () => {
    if (!db) return fail(503, '저장소가 연결되지 않았습니다.');
    const who = await identify(codeOf(req));
    if (who?.role !== 'admin') return fail(401, '운영진 접속 코드가 필요합니다.');
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return fail(400, '요청 형식이 잘못되었습니다.');
    }
    const store = db.storage.from(BUCKET);

    if (body.op === 'upload') {
      if (!isSid(body.sid) || typeof body.tid !== 'string' || !(await teamIds(body.sid)).includes(body.tid)) return fail(400, '대상 팀이 잘못되었습니다.');
      const key = typeof body.name === 'string' ? materialKey(body.name) : null;
      if (!key) return fail(400, `올릴 수 있는 파일 형식은 ${MATERIAL_EXT.join(', ')} 입니다. 파일 이름은 60자 이내로 하시기 바랍니다.`);
      if (typeof body.size !== 'number' || body.size <= 0 || body.size > MATERIAL_MAX_BYTES) return fail(400, '파일 하나의 크기는 50MB 이하여야 합니다.');
      // 처음 올릴 때 비공개 저장소를 만든다 (이미 있으면 그대로 둔다)
      const made = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MATERIAL_MAX_BYTES });
      if (made.error && !/already exists/i.test(made.error.message)) throw new Error(made.error.message);
      const dir = dirOf(body.sid, body.tid, isGroup(body.group) ? body.group : 'submit');
      const cur = await store.list(dir, { limit: 50 });
      if ((cur.data ?? []).filter((f) => f.id !== null && f.name !== key).length >= MATERIAL_MAX_PER_TEAM) return fail(400, `팀당 자료는 ${MATERIAL_MAX_PER_TEAM}개까지 올릴 수 있습니다.`);
      const { data, error } = await store.createSignedUploadUrl(`${dir}/${key}`, { upsert: true });
      if (error) throw new Error(error.message);
      return json({ url: data.signedUrl });
    }

    if (body.op === 'delete') {
      const p = typeof body.path === 'string' ? body.path.split('/') : [];
      const okPath = (p.length === 3 || (p.length === 4 && p[2] === 'final')) && isSid(p[0]) && materialName(p[p.length - 1]) !== null;
      if (!okPath) return fail(400, '대상 파일이 잘못되었습니다.');
      const { error } = await store.remove([p.join('/')]);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
    return fail(400, '알 수 없는 요청입니다.');
  });
}
