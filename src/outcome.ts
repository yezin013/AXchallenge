import {
  type AwardState,
  type RankedTeam,
  type S2Outcome,
  type TeamResult,
  computeTeam,
  digestOf,
  rankTeams,
  s1Award,
  s2Outcome,
  tieKey,
} from './calc';
import type { SessionConfig, SessionData } from './model';

export interface TieGroup {
  scope: string; // 화면 표시용 (예: '업무바통 2위', '대상 선정')
  field: 'tieOrder' | 'grandTieOrder';
  key: string;
  teams: TeamResult[];
  affectsAward: boolean;
}

export interface Outcome {
  s1: { ranked: RankedTeam[]; pending: TeamResult[] } | null;
  s2: S2Outcome | null;
  awards: Map<string, AwardState>;
  ties: TieGroup[];
  pendingCount: number;
  meanCount: number;
  unnamedJudges: number;
  teamCount: number;
  ready: boolean;
  digest: string;
}

function collectTies(ranked: RankedTeam[], scope: string, field: TieGroup['field'], awards: Map<string, AwardState>): TieGroup[] {
  const out: TieGroup[] = [];
  const seen = new Set<number>();
  for (const r of ranked) {
    if (!r.tied || seen.has(r.rank)) continue;
    seen.add(r.rank);
    const teams = ranked.filter((x) => x.tied && x.rank === r.rank).map((x) => x.result);
    out.push({
      scope: `${scope}${r.rank}위`,
      field,
      key: tieKey(teams),
      teams,
      affectsAward: teams.some((t) => awards.get(t.team.id)?.kind === 'decision'),
    });
  }
  return out;
}

export function computeOutcome(cfg: SessionConfig, data: SessionData): Outcome {
  const awards = new Map<string, AwardState>();
  let ties: TieGroup[] = [];
  let all: TeamResult[] = [];
  let s1: Outcome['s1'] = null;
  let s2: Outcome['s2'] = null;

  if (cfg.tasks) {
    s2 = s2Outcome(cfg, data);
    s2.awards.forEach((v, k) => awards.set(k, v));
    for (const b of s2.blocks) {
      ties = ties.concat(collectTies(b.ranked, `${b.task.label} `, 'tieOrder', awards));
      all = all.concat(b.ranked.map((r) => r.result), b.pending);
    }
    const grandTop = s2.grandRanked.filter((g) => g.rank === 1 && g.tied).map((g) => g.result);
    if (grandTop.length > 1) {
      ties.push({ scope: '대상 선정(과제별 1위 비교)', field: 'grandTieOrder', key: tieKey(grandTop), teams: grandTop, affectsAward: true });
    }
  } else {
    const results = data.teams.filter((t) => !t.withdrawn).map((t) => computeTeam(cfg, data, t));
    const ranked = rankTeams(cfg, results.filter((r) => r.complete), false);
    for (const r of ranked) awards.set(r.result.team.id, s1Award(ranked, r));
    s1 = { ranked, pending: results.filter((r) => !r.complete) };
    ties = collectTies(ranked, '', 'tieOrder', awards);
    all = results;
  }

  const active = data.judges.filter((j) => j.active);
  const pendingCount = all.filter((r) => !r.complete).length;
  const meanCount = all.filter((r) => r.method === 'mean').length;
  const unnamedJudges = active.filter((j) => !j.name.trim()).length;
  const decision = [...awards.values()].some((a) => a.kind === 'decision');
  const ready = all.length > 0 && active.length > 0 && pendingCount === 0 && !decision && unnamedJudges === 0;

  return { s1, s2, awards, ties, pendingCount, meanCount, unnamedJudges, teamCount: all.length, ready, digest: digestOf(data) };
}
