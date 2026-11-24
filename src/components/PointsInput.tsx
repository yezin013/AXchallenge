import { useEffect, useState } from 'react';
import { validPoints } from '../model';

// 지표별 점수 직접 기재 칸 (세션1). 0 이상 배점 이하, 소수 첫째 자리까지. 잘못된 값은 저장하지 않고 붉게 표시한다
export function PointsInput({ value, max, disabled, label, onChange, className }: { value: number | null | undefined; max: number; disabled?: boolean; label: string; onChange: (v: number | null) => void; className?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    // 서버에서 다른 값이 들어오면 화면 값을 맞춘다 (입력 중인 같은 값은 건드리지 않음)
    setText((cur) => {
      const now = cur.trim() === '' ? null : Number(cur);
      return now === (value ?? null) ? cur : value === null || value === undefined ? '' : String(value);
    });
  }, [value]);
  const n = text.trim() === '' ? null : Number(text);
  const bad = n !== null && !validPoints(max, n);
  return (
    <input
      className={`input pts${bad ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      step={0.5}
      value={text}
      disabled={disabled}
      aria-label={`${label} 점수 (0~${max}점)`}
      aria-invalid={bad}
      title={bad ? `0~${max}점, 소수 첫째 자리까지 입력할 수 있습니다.` : undefined}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = t.trim() === '' ? null : Number(t);
        if (v === null || validPoints(max, v)) onChange(v);
      }}
    />
  );
}
