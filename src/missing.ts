import type { SessionConfig, SessionData } from './model';
import type { Outcome } from './outcome';
import { entryOf } from './scoreOps';
import { judgeLabel, teamTitle } from './components/ui';

// 미입력·미결 항목과 그 항목을 고칠 수 있는 화면 위치
export type JumpTarget =
  | { step: 'setup'; elementId: string }
  | { step: 'score'; judgeId: string; teamId: string; elementId: string }
  | { step: 'summary'; elementId: string };

export interface MissingItem {
  key: string;
  group: string;
  label: string;
  target: JumpTarget;
}

export interface Jump {
  target: JumpTarget;
  seq: number; // 같은 항목을 다시 눌러도 다시 이동하도록
}

export const judgeNameId = (jid: string) => `judge-name-${jid}`;
export const teamFieldId = (tid: string, field: 'org' | 'teamName') => `team-${field}-${tid}`;
export const levelId = (jid: string, tid: string, key: string) => `lv-${jid}-${tid}-${key}`;
export const recuseId = (jid: string, tid: string) => `rec-${jid}-${tid}`;
export const runId = (jid: string, tid: string) => `run-${jid}-${tid}`;
export const runReasonId = (jid: string, tid: string) => `runr-${jid}-${tid}`;
export const tieId = (key: string, field: string) => `tie-${field}-${key}`;

export function findMissing(cfg: SessionConfig, data: SessionData, outcome: Outcome): MissingItem[] {
  const items: MissingItem[] = [];
  const active = data.judges.filter((j) => j.active);
  const teams = data.teams.filter((t) => !t.withdrawn).sort((a, b) => a.order - b.order);

  active.forEach((j) => {
    if (!j.name.trim()) {
      const idx = data.judges.indexOf(j);
      items.push({ key: `jn-${j.id}`, group: '심사위원 성명', label: `심사위원 ${idx + 1}번 성명 미입력`, target: { step: 'setup', elementId: judgeNameId(j.id) } });
    }
  });
  for (const t of teams) {
    const fields: ['org' | 'teamName', string][] = [['org', '기관명'], ['teamName', '팀명']];
    for (const [f, name] of fields) {
      if (!t[f].trim()) items.push({ key: `tf-${t.id}-${f}`, group: '팀 정보', label: `발표 ${t.order}번 ${name} 미입력`, target: { step: 'setup', elementId: teamFieldId(t.id, f) } });
    }
  }
  for (const t of teams) {
    active.forEach((j, k) => {
      const e = entryOf(data, j.id, t.id);
      if (e.recused) return;
      const who = `${judgeLabel(j, k)} 위원 · 발표 ${t.order}번 ${teamTitle(t)}`;
      const miss = cfg.criteria.filter((c) => e.levels[c.key] === null || e.levels[c.key] === undefined);
      if (miss.length) {
        items.push({
          key: `sc-${j.id}-${t.id}`,
          group: '점수',
          label: `${who} — ${miss.map((c) => c.label).join('·')} 미입력`,
          target: { step: 'score', judgeId: j.id, teamId: t.id, elementId: levelId(j.id, t.id, miss[0].key) },
        });
      }
      if (!cfg.opinion) return;
      if (!e.run) {
        items.push({ key: `run-${j.id}-${t.id}`, group: '구동 확인 결과', label: `${who} — 구동 확인 결과 미선택`, target: { step: 'score', judgeId: j.id, teamId: t.id, elementId: runId(j.id, t.id) } });
      } else if (e.run === 'fail' && !e.runReason?.trim()) {
        items.push({ key: `runr-${j.id}-${t.id}`, group: '구동 확인 결과', label: `${who} — 구동 불가 사유 미입력`, target: { step: 'score', judgeId: j.id, teamId: t.id, elementId: runReasonId(j.id, t.id) } });
      }
    });
  }
  for (const g of outcome.ties) {
    if (g.affectsAward) items.push({ key: `tie-${g.field}-${g.key}`, group: '동점 협의', label: `${g.scope} 동점 — 심사위원 협의 순서 입력 필요`, target: { step: 'summary', elementId: tieId(g.key, g.field) } });
  }
  return items;
}

// 화면이 바뀐 뒤 해당 칸으로 스크롤하고 포커스한다
export function revealTarget(elementId: string) {
  window.setTimeout(() => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, 60);
}
