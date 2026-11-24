import { useState } from 'react';
import type { JumpTarget, MissingItem } from '../missing';

// 미입력 항목을 종류별로 묶어 건수를 보여 준다. [바로 가기]는 그 종류의 첫 항목으로 이동, [목록 보기]는 항목별 목록을 펼친다.
export function MissingNotice({ items, title, onJump }: { items: MissingItem[]; title: string; onJump: (t: JumpTarget) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return null;
  const groups: { name: string; items: MissingItem[] }[] = [];
  for (const it of items) {
    const g = groups.find((x) => x.name === it.group);
    if (g) g.items.push(it);
    else groups.push({ name: it.group, items: [it] });
  }
  return (
    <div className="notice warn missing" style={{ display: 'block' }}>
      <b>{title} {items.length}건</b>
      <ul className="groups">
        {groups.map((g) => {
          const isOpen = open === g.name;
          return (
            <li key={g.name}>
              <div className="gh">
                <span>{g.name} <b>{g.items.length}건</b></span>
                <span className="acts">
                  <button type="button" className="more" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.name)}>
                    {isOpen ? '목록 접기' : '목록 보기'}
                  </button>
                  <button type="button" className="jump" onClick={() => onJump(g.items[0].target)}>바로 가기</button>
                </span>
              </div>
              {isOpen && (
                <ul>
                  {g.items.map((it) => (
                    <li key={it.key}>
                      <span>{it.label}</span>
                      <button type="button" className="jump" onClick={() => onJump(it.target)}>바로 가기</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
