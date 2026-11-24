import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionConfig, SessionData } from '../model';
import { ConfirmButton, teamTitle } from '../components/ui';
import { api } from './client';
import { MATERIAL_EXT, MATERIAL_GROUPS, MATERIAL_MAX_BYTES, type Material, type MaterialGroup, fmtSize, materialKey, materialKind } from './materials';

type ByTeam = Record<string, Material[]>;
const REFRESH_MS = 20 * 60 * 1000; // 열람 주소는 1시간 뒤 만료 → 20분마다 새로 받는다

// 세션의 발표 자료 목록. session 을 주면 심사위원, sid 만 주면 운영진으로 읽는다
export function useMaterials(code: string, sid: string, asJudge: boolean) {
  const [list, setList] = useState<ByTeam>({});
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = asJudge ? await api<{ materials: ByTeam }>('/api/materials', code, undefined, sid) : await api<{ materials: ByTeam }>(`/api/materials?sid=${sid}`, code);
      setList(r.materials);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '발표 자료를 불러오지 못하였습니다.');
    }
  }, [code, sid, asJudge]);
  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload]);
  return { list, err, reload };
}

// 화면 안 미리보기 창: PDF·영상·이미지
export function MaterialViewer({ file, onClose }: { file: Material; onClose: () => void }) {
  const kind = materialKind(file.name);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="mv-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mv-box" role="dialog" aria-modal="true" aria-label={`${file.name} 미리보기`} tabIndex={-1} ref={box}>
        <header>
          <b>{file.name}</b>
          <button type="button" className="btn sm" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="mv-body">
          {kind === 'pdf' && <iframe title={file.name} src={file.url} />}
          {kind === 'video' && <video src={file.url} controls autoPlay />}
          {kind === 'image' && <img src={file.url} alt={file.name} />}
        </div>
      </div>
    </div>
  );
}

// 심사위원: 팀 카드 안의 자료 버튼
export function MaterialButtons({ files }: { files: Material[] | undefined }) {
  const [open, setOpen] = useState<Material | null>(null);
  return (
    <div className="mv-rows">
      {MATERIAL_GROUPS.map((g) => {
        const list = (files ?? []).filter((f) => f.group === g.id);
        return (
          <div key={g.id} className="mv-row">
            <span className="lb">{g.label}</span>
            {list.length > 0 ? (
              <div className="mv-btns">
                {list.map((f) => (
                  <button key={f.path} type="button" className="btn sm" onClick={() => setOpen(f)}>
                    {materialKind(f.name) === 'video' ? '▶ ' : ''}
                    {f.name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="mute">등록된 자료가 없습니다.</span>
            )}
          </div>
        );
      })}
      {open && <MaterialViewer file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// 운영진: 팀별 자료 올리기·지우기
export function MaterialsPanel({ cfg, data, code }: { cfg: SessionConfig; data: SessionData; code: string }) {
  const { list, err, reload } = useMaterials(code, cfg.id, false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Material | null>(null);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);

  const upload = async (tid: string, group: MaterialGroup, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(tid);
    setMsg(null);
    try {
      for (const f of Array.from(files)) {
        if (!materialKey(f.name)) throw new Error(`「${f.name}」: 올릴 수 있는 형식은 ${MATERIAL_EXT.join(', ')} 이며, 파일 이름은 60자 이내여야 합니다.`);
        if (f.size > MATERIAL_MAX_BYTES) throw new Error(`「${f.name}」: 파일 하나의 크기는 50MB 이하여야 합니다. (현재 ${fmtSize(f.size)})`);
        const { url } = await api<{ url: string }>('/api/materials', code, { op: 'upload', sid: cfg.id, tid, group, name: f.name, size: f.size });
        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', f);
        const res = await fetch(url, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: form });
        if (!res.ok) throw new Error(`「${f.name}」을 올리지 못하였습니다. (${res.status})`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일을 올리지 못하였습니다.');
    } finally {
      await reload();
      setBusy(null);
    }
  };

  const remove = async (tid: string, path: string) => {
    setBusy(tid);
    setMsg(null);
    try {
      await api('/api/materials', code, { op: 'delete', path });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '파일을 지우지 못하였습니다.');
    } finally {
      await reload();
      setBusy(null);
    }
  };

  return (
    <section className="ol-access">
      <div className="ol-access-h">
        <h3 className="cp-h3">제출 자료 · 최종 발표자료</h3>
        <span>심사위원 점수 입력 화면에 팀별로 표시됩니다 · PDF·영상(mp4)·이미지, 파일당 50MB 이하</span>
      </div>
      {(err || msg) && <div className="notice bad" role="alert">{msg ?? err}</div>}
      <div className="cp-tbl">
        <table className="tbl">
          <thead>
            <tr>
              <th className="c">발표</th>
              <th>기관 · 팀</th>
              {MATERIAL_GROUPS.map((g) => (
                <th key={g.id}>{g.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td className="c">{t.order}</td>
                <td>
                  <b>{teamTitle(t)}</b> <small className="sub">{t.org}</small>
                </td>
                {MATERIAL_GROUPS.map((g) => {
                  const files = (list[t.id] ?? []).filter((f) => f.group === g.id);
                  return (
                    <td key={g.id}>
                      {files.map((f) => (
                        <div key={f.path} className="mv-file">
                          <button type="button" className="mv-link" onClick={() => setOpen(f)}>
                            {f.name}
                          </button>
                          <small className="sub">{fmtSize(f.size)}</small>
                          <ConfirmButton className="sm ghost" disabled={busy === t.id} confirmText="다시 누르면 삭제" onConfirm={() => void remove(t.id, f.path)}>
                            삭제
                          </ConfirmButton>
                        </div>
                      ))}
                      <label className={`btn sm mv-add${busy === t.id ? ' disabled' : ''}`}>
                        {busy === t.id ? '처리 중…' : '+ 파일 올리기'}
                        <input
                          type="file"
                          className="sr"
                          multiple
                          accept={MATERIAL_EXT.map((e) => `.${e}`).join(',')}
                          disabled={busy !== null}
                          aria-label={`${teamTitle(t)} ${g.label} 올리기`}
                          onChange={(e) => {
                            const picked = e.target.files;
                            void upload(t.id, g.id, picked).then(() => {
                              e.target.value = '';
                            });
                          }}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <MaterialViewer file={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
