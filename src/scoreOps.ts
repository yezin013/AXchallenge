import { critPoints, type ScoreEntry, type SessionConfig, type SessionData } from './model';

export function entryOf(data: SessionData, judgeId: string, teamId: string): ScoreEntry {
  return data.scores[judgeId]?.[teamId] ?? { levels: {}, recused: false };
}

export function isDone(cfg: SessionConfig, e: ScoreEntry): boolean {
  return e.recused || cfg.criteria.every((c) => e.levels[c.key] !== null && e.levels[c.key] !== undefined);
}

export function entryTotal(cfg: SessionConfig, e: ScoreEntry): number {
  const sum = cfg.criteria.reduce((sum, c) => {
    const lv = e.levels[c.key];
    return lv === null || lv === undefined ? sum : sum + critPoints(cfg, c.max, lv);
  }, 0);
  return Math.round(sum * 10) / 10;
}

type Update = (fn: (s: SessionData) => SessionData) => void;

export function setEntry(update: Update, jid: string, tid: string, fn: (e: ScoreEntry) => ScoreEntry) {
  update((s) => {
    const cur = s.scores[jid]?.[tid] ?? { levels: {}, recused: false };
    return { ...s, scores: { ...s.scores, [jid]: { ...(s.scores[jid] ?? {}), [tid]: fn(cur) } } };
  });
}

export function setLevel(update: Update, jid: string, tid: string, key: string, level: number | null) {
  setEntry(update, jid, tid, (e) => ({ ...e, levels: { ...e.levels, [key]: level } }));
}

export function toggleLevel(update: Update, jid: string, tid: string, key: string, level: number) {
  setEntry(update, jid, tid, (e) => ({ ...e, levels: { ...e.levels, [key]: e.levels[key] === level ? null : level } }));
}

export function setNote(update: Update, jid: string, tid: string, patch: Partial<Pick<ScoreEntry, 'strengths' | 'improve' | 'run' | 'runReason'>>) {
  setEntry(update, jid, tid, (e) => ({ ...e, ...patch }));
}

export function setRecused(update: Update, jid: string, tid: string, recused: boolean) {
  setEntry(update, jid, tid, (e) => ({ ...e, recused }));
}
