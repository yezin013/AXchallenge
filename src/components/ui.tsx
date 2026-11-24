import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { AwardState } from '../calc';
import type { Judge, Team } from '../model';

export function teamTitle(t: Team): string {
  return t.teamName.trim() || '(팀명 미입력)';
}
export function teamSub(t: Team): string {
  return [t.org.trim() || '(기관 미입력)', t.work.trim()].filter(Boolean).join(' · ');
}
export function judgeLabel(j: Judge, idx: number): string {
  return j.name.trim() || `위원 ${idx + 1}`;
}

export function TeamLabel({ team }: { team: Team }) {
  return (
    <div className="team-cell">
      <strong>{teamTitle(team)}</strong>
      <span>{teamSub(team)}</span>
    </div>
  );
}

export function AwardTag({ state }: { state: AwardState | undefined }) {
  if (!state || state.kind === 'none') return <span className="badge">수상 외</span>;
  if (state.kind === 'decision') return <span className="badge bad">협의 필요</span>;
  const cls = state.kind === 'withheld' ? 'withheld' : state.tier.key;
  return (
    <span className={'award ' + cls}>
      <b>{state.tier.name}</b>
      <span>{state.kind === 'withheld' ? '미수여(심사위원회 결정)' : state.tier.honor + ' · ' + state.tier.prize}</span>
    </span>
  );
}

export function RankBadge({ rank, tied }: { rank: number; tied: boolean }) {
  const cls = rank <= 3 ? ' r' + rank : '';
  return (
    <span className={'rank' + cls} title={tied ? '동점' : undefined}>
      {rank}
      {tied ? '=' : ''}
    </span>
  );
}

const ICONS = {
  up: 'M12 19V5M5 12l7-7 7 7',
} as const;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// 두 번 눌러야 실행되는 버튼 (브라우저 확인창을 쓰지 않음)
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  className = '',
  disabled,
}: {
  children: ReactNode;
  confirmText: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn ${className}${armed ? ' armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

export function useDownload() {
  const ref = useRef<HTMLAnchorElement>(null);
  const [link, setLink] = useState<{ href: string; name: string } | null>(null);
  useEffect(() => {
    if (!link) return;
    ref.current?.click();
    const t = window.setTimeout(() => {
      URL.revokeObjectURL(link.href);
      setLink(null);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [link]);
  const anchor = link ? <a ref={ref} href={link.href} download={link.name} className="hidden-file" aria-hidden="true" /> : null;
  const download = (name: string, blob: Blob) => setLink({ href: URL.createObjectURL(blob), name });
  return { anchor, download };
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtEventDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = '일월화수목금토'[d.getDay()];
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.(${wd})`;
}
