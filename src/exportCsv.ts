import type { RankedTeam, TeamResult } from './calc';
import type { SessionConfig, SessionData } from './model';
import type { Outcome } from './outcome';
import { awardText } from './components/PrintSheet';
import { type Cell, buildXlsx } from './xlsx';

// 최종 집계표 줄 (첫 줄 = 머리글). 점수는 숫자 칸으로 넣는다
export function buildRows(cfg: SessionConfig, data: SessionData, outcome: Outcome): Cell[][] {
  const judges = data.judges.filter((j) => j.active);
  const header = [
    ...(cfg.tasks ? ['과제'] : []), '순위', '발표순', '기관명', '팀명', '작품명',
    ...judges.map((j, i) => `위원${i + 1}(${j.name})`),
    '최고점', '최저점', '트림평균',
    ...cfg.criteria.map((c) => `${c.label} 트림평균`),
    ...(cfg.tasks ? ['예선 점수'] : []),
    '수상', '훈격', '상금', '비고', '최종 총평',
  ];
  const rows: Cell[][] = [header];
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : v);

  const push = (task: string, rank: string, r: TeamResult, rt: RankedTeam | null) => {
    const vals = r.cells.filter((c) => c.status === 'done').map((c) => c.total as number);
    const a = outcome.awards.get(r.team.id);
    const notes: string[] = [];
    if (!r.complete) notes.push(`${r.pendingCount}명 미입력`);
    if (r.method === 'mean') notes.push('산술평균');
    if (rt?.tied) notes.push('동점');
    if (rt?.decidedBy) notes.push(`동점 → ${rt.decidedBy}`);
    rows.push([
      ...(cfg.tasks ? [task] : []), rank === '' ? '' : Number(rank), r.team.order, r.team.org, r.team.teamName, r.team.work,
      ...judges.map((j) => {
        const c = r.cells.find((x) => x.judgeId === j.id);
        return !c || c.status === 'pending' ? '' : c.status === 'recused' ? '회피' : num(c.total);
      }),
      vals.length ? Math.max(...vals) : '',
      vals.length ? Math.min(...vals) : '',
      num(r.score),
      ...cfg.criteria.map((c) => (r.complete ? num(r.critScores[c.key]) : '')),
      ...(cfg.tasks ? [num(r.team.prelimScore)] : []),
      awardText(a),
      a && (a.kind === 'award' || a.kind === 'withheld') ? a.tier.honor : '',
      a && a.kind === 'award' ? a.tier.prize : '',
      notes.join(' / '),
      r.team.finalComment ?? '',
    ]);
  };

  if (outcome.s1) {
    for (const rt of outcome.s1.ranked) push('', `${rt.rank}`, rt.result, rt);
    for (const r of outcome.s1.pending) push('', '', r, null);
  }
  if (outcome.s2) {
    for (const b of outcome.s2.blocks) {
      for (const rt of b.ranked) push(b.task.label, `${rt.rank}`, rt.result, rt);
      for (const r of b.pending) push(b.task.label, '', r, null);
    }
  }
  const sigRow = ['서명', ...judges.map((j) => `${j.name}: ${data.signatures[j.id]?.digest === outcome.digest ? '서명 완료' : '미서명'}`)];
  rows.push([], sigRow);
  return rows;
}

// 최종 집계표 엑셀 파일(.xlsx)
export function buildSummaryXlsx(cfg: SessionConfig, data: SessionData, outcome: Outcome): Blob {
  const title = `${cfg.short} ${cfg.title} 결선 최종 집계표`;
  return buildXlsx([[title], [], ...buildRows(cfg, data, outcome)], { sheet: `${cfg.short} 최종 집계표`, titleRows: [0], headerRows: [2] });
}
