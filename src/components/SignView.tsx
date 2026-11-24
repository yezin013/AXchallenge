import { useEffect, useRef, useState } from 'react';
import { SIG_MAX_CHARS, type Judge, type SessionConfig, type SessionData } from '../model';
import type { Outcome } from '../outcome';
import { ConfirmButton, fmtDateTime, judgeLabel } from './ui';
import { MissingNotice } from './MissingNotice';
import type { JumpTarget, MissingItem } from '../missing';

interface Props {
  cfg: SessionConfig;
  data: SessionData;
  outcome: Outcome;
  update: (fn: (s: SessionData) => SessionData) => void;
  onPrint: () => void;
  missing: MissingItem[];
  onJump: (t: JumpTarget) => void;
}

// 서명 획이 있는 부분만 잘라 저장 (인쇄본 서명란에 크게 보이도록)
function trimmed(c: HTMLCanvasElement): string {
  const ctx = c.getContext('2d');
  if (!ctx) return c.toDataURL('image/png');
  const { width, height } = c;
  const px = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return c.toDataURL('image/png');
  const pad = Math.round(8 * (window.devicePixelRatio || 1));
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width, maxX + pad + 1) - sx;
  const sh = Math.min(height, maxY + pad + 1) - sy;
  // 상한(SIG_MAX_CHARS)을 넘으면 크기를 줄여 다시 만든다
  let scale = 1;
  let url = '';
  do {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    out.getContext('2d')?.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
    url = out.toDataURL('image/png');
    scale *= 0.75;
  } while (url.length > SIG_MAX_CHARS && scale > 0.1);
  return url;
}

export function SignaturePad({ disabled, onSave }: { disabled: boolean; onSave: (dataUrl: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0e1a2b';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    setDirty(false);
  };

  return (
    <>
      <canvas
        ref={canvas}
        className="sign-pad"
        aria-label="서명 입력란 (마우스·터치로 서명)"
        style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        onPointerDown={(e) => {
          if (disabled) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setDirty(true);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <footer>
        <span className="meta">{disabled ? '집계 완료 후 서명할 수 있습니다' : '위 칸에 서명하시기 바랍니다'}</span>
        <button type="button" className="btn sm ghost" disabled={!dirty} onClick={clear}>지우기</button>
        <button
          type="button"
          className="btn sm primary"
          disabled={disabled || !dirty}
          onClick={() => {
            const c = canvas.current;
            if (c) onSave(trimmed(c));
          }}
        >
          서명 저장
        </button>
      </footer>
    </>
  );
}

export function SignView({ cfg, data, outcome, update, onPrint, missing, onJump }: Props) {
  const judges: Judge[] = [...data.judges.filter((j) => j.active)].sort((a, b) => Number(b.isChair) - Number(a.isChair));
  const indexOf = (j: Judge) => data.judges.filter((x) => x.active).findIndex((x) => x.id === j.id);
  const valid = (j: Judge) => data.signatures[j.id]?.digest === outcome.digest;
  const signedCount = judges.filter(valid).length;
  const allSigned = judges.length > 0 && signedCount === judges.length;
  const locked = data.locked;

  const save = (jid: string, dataUrl: string) =>
    update((s) => ({ ...s, signatures: { ...s.signatures, [jid]: { dataUrl, signedAt: new Date().toISOString(), digest: outcome.digest } } }));
  const drop = (jid: string) =>
    update((s) => {
      const signatures = { ...s.signatures };
      delete signatures[jid];
      return { ...s, signatures };
    });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>심사위원 서명 · 집계 확정</h1>
          <p>
            {cfg.short} 최종 집계표에 참여 심사위원 전원이 서명하면 확정합니다. 서명 후 점수·명단이 변경되면 서명이 자동으로 무효 처리됩니다.
          </p>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onPrint}>서명 포함 집계표 인쇄 · PDF</button>
        {locked ? (
          <ConfirmButton className="danger" confirmText="해제 후 수정 가능 · 다시 누르면 해제" onConfirm={() => update((s) => ({ ...s, locked: false }))}>
            잠금 해제
          </ConfirmButton>
        ) : (
          <button type="button" className="btn primary" disabled={!allSigned || !outcome.ready} onClick={() => update((s) => ({ ...s, locked: true }))}>
            집계 확정(잠금)
          </button>
        )}
      </div>

      <div className="notices">
        <MissingNotice items={missing} title="서명 전 확인 항목" onJump={onJump} />
        {outcome.teamCount === 0 && <div className="notice warn">결선 팀이 등록되지 않았습니다. [심사 설정]에서 결선 진출팀을 등록하시기 바랍니다.</div>}
        {locked && <div className="notice ok">집계가 확정되어 잠겨 있습니다. 서명 {signedCount}/{judges.length}명.</div>}
        {!locked && outcome.ready && (
          <div className={`notice ${allSigned ? 'ok' : ''}`}>
            서명 {signedCount} / {judges.length}명{allSigned ? ' — 전원 서명 완료. [집계 확정(잠금)]을 눌러 마감하시기 바랍니다.' : ''}
          </div>
        )}
      </div>

      <div className="sign-grid">
        {judges.map((j) => {
          const sig = data.signatures[j.id];
          const ok = valid(j);
          return (
            <article className="sign-card" key={j.id}>
              <header>
                <div className="who">
                  <strong>
                    {judgeLabel(j, indexOf(j))}
                    {j.isChair && <span className="chair-tag">위원장</span>}
                  </strong>
                  <span title={[j.org, j.position].filter(Boolean).join(' · ')}>{[j.org, j.position].filter(Boolean).join(' · ') || '소속·직위 미입력'}</span>
                </div>
                {ok ? <span className="badge ok">서명 완료</span> : sig ? <span className="badge bad">재서명 필요</span> : <span className="badge">미서명</span>}
              </header>
              {ok && sig ? (
                <>
                  <img className="sign-img" src={sig.dataUrl} alt={`${j.name} 서명`} />
                  <footer>
                    <span className="meta">{fmtDateTime(sig.signedAt)} 서명</span>
                    <ConfirmButton className="sm ghost" disabled={locked} confirmText="서명 지우기 확인" onConfirm={() => drop(j.id)}>
                      다시 서명
                    </ConfirmButton>
                  </footer>
                </>
              ) : (
                <>
                  {sig && (
                    <div className="notice bad" style={{ margin: 10, fontSize: 12 }}>
                      서명 후 점수·명단이 변경되었습니다. 변경된 집계표를 확인한 후 다시 서명을 받으시기 바랍니다.
                    </div>
                  )}
                  <SignaturePad disabled={!outcome.ready || locked} onSave={(url) => save(j.id, url)} />
                </>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
