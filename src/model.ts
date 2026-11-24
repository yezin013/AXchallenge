// 심사 기준·시상 규정. 출처는 각 항목 주석에 표시.
export type SessionId = 's1' | 's2';
export type TaskId = 'baton' | 'clerk' | 'rule';

export interface Criterion {
  key: string;
  label: string;
  max: number;
  desc: string;
}

// 5단계 척도 (심사평가표 양식 "공통 적용 기준", 세션2 심사계획(안) 3. 평가 방법)
export const LEVELS = [
  { label: '매우 우수', ratio: 1.0 },
  { label: '우수', ratio: 0.8 },
  { label: '보통', ratio: 0.6 },
  { label: '미흡', ratio: 0.4 },
  { label: '매우 미흡', ratio: 0.2 },
] as const;

// 서명 이미지 상한: PNG 약 100KB (base64 글자 수 기준). 넘으면 화면에서 줄여 저장한다.
export const SIG_MAX_CHARS = 140_000;

export function levelPoints(max: number, level: number): number {
  return Math.round(max * LEVELS[level].ratio);
}

// 저장된 값(levels[key])을 점수로 바꾼다. 5단계 세션은 등급 번호 → 환산 점수, 점수 기재 세션은 값 그대로
export function critPoints(cfg: { scale: 'level' | 'points' }, max: number, v: number): number {
  return cfg.scale === 'points' ? v : levelPoints(max, v);
}

// 점수 기재 세션의 입력값: 0 이상 배점 이하, 소수 첫째 자리까지
export function validPoints(max: number, v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && Math.round(v * 10) === v * 10;
}

export interface AwardTier {
  key: string;
  name: string;
  honor: string;
  prize: string;
}

export interface SessionConfig {
  id: SessionId;
  short: string;
  title: string;
  // 채점 방식: 'level' = 5단계 중 선택(세션2), 'points' = 지표별 점수 직접 기재(세션1). 통합본 4. 평가 방법·붙임 2
  scale: 'level' | 'points';
  criteria: Criterion[];
  // 동점 시 비교할 지표 순서
  tieBreak: string[];
  tieBreakNote: string;
  tasks: { id: TaskId; label: string }[] | null;
  defaultTeams: number;
  source: string;
  // 심사평가표의 주제 유형 선택지 (세션1만)
  topics: string[] | null;
  // 평가표 하단 '심사 의견'(주요 강점·보완 필요사항·구동 확인 결과) 칸 여부
  opinion: boolean;
}

// 세션1: 심사계획(안) 결선 중심 통합본(11/18) 2. 평가 기준, 4. 결선 심사 계획.
// 채점 방식만 예진님 지시(11/19)로 세션2와 같은 5단계 선택으로 한다 (통합본 평가표는 점수 직접 기재)
export const S1: SessionConfig = {
  id: 's1',
  short: '세션 1',
  title: 'AI 정부 실험실 챔피언십',
  scale: 'level',
  criteria: [
    { key: 'creative', label: '창의성', max: 30, desc: '기존 업무방식·서비스와 차별화된 아이디어의 독창성\nAI 및 데이터를 활용한 문제 해결 방식의 참신성' },
    { key: 'need', label: '필요성', max: 20, desc: '해결하려는 행정·공공서비스 문제의 구체성 및 중요성\n과제 추진 목적의 타당성과 공공적 가치' },
    { key: 'use', label: '활용성', max: 20, desc: '실제 행정업무·대국민 서비스에 적용할 수 있는 가능성\n업무시간 단축, 비용 절감, 품질 향상 등 기대효과' },
    { key: 'done', label: '완성도', max: 15, desc: '기능의 구현 수준과 프로그램의 안정성·사용 편의성\n소스코드, 이용안내서 등 개발 산출물의 충실성' },
    { key: 'spread', label: '확산가능성', max: 15, desc: '다른 기관 및 유사 업무에 적용·재사용할 수 있는 가능성\n지속적인 운영·개선 및 범정부 공동활용 가능성' },
  ],
  tieBreak: ['creative', 'need', 'use'],
  tieBreakNote:
    '동점 시 배점이 높은 지표(창의성 → 필요성·활용성) 점수 순으로 높은 팀 우선, 이후에도 동점이면 심사위원 협의로 결정',
  tasks: null,
  defaultTeams: 10,
  source: '심사계획(안) 결선 중심 통합본(11/18)',
  topics: ['대국민 서비스 향상', '행정업무 효율화', '사회문제 해결', 'AI 신뢰성 확보', '기타'],
  opinion: false,
};

// 세션2: 예선·결선 심사계획(안) 3. 평가 기준, 5. 결선 심사
export const S2: SessionConfig = {
  id: 's2',
  short: '세션 2',
  title: 'AI 미션 경진',
  scale: 'level',
  criteria: [
    { key: 'use', label: '활용성', max: 40, desc: '행정업무 실정에 맞는 최적 활용 가능성 및 기대효과\n전 기관이 공통으로 쓸 수 있으며 기관별 환경에 맞게 설정 가능성' },
    { key: 'done', label: '완성도', max: 30, desc: '핵심 기능 구현 수준, 안정적 구동, 사용 편의성' },
    { key: 'spread', label: '확산 용이성', max: 30, desc: '특정 모델(LLM)에 종속되지 않는 구조 등 타 기관 이식 용이성\n정식활용(정보화사업) 개발·운영으로의 이관 용이성' },
  ],
  tieBreak: ['use', 'done', 'spread'],
  tieBreakNote:
    '동점 시 활용성 → 완성도 → 확산 용이성 지표 트림평균 → 예선 점수 순으로 높은 팀 우선, 모두 같으면 심사위원 협의',
  tasks: [
    { id: 'baton', label: '업무바통' },
    { id: 'clerk', label: '서무비서' },
    { id: 'rule', label: '규정 제·개정' },
  ],
  defaultTeams: 3,
  source: '심사계획(안) 결선 중심 통합본(11/18)',
  topics: null,
  opinion: false,
};

export const SESSIONS: Record<SessionId, SessionConfig> = { s1: S1, s2: S2 };

// 세션1 시상: 참가 안내서 세션1 시상표 (결선 1위 / 2위 / 3~4위 / 5~10위)
export const S1_AWARDS: { fromRank: number; toRank: number; tier: AwardTier }[] = [
  { fromRank: 1, toRank: 1, tier: { key: 'grand', name: '대상', honor: '대통령상', prize: '200만원' } },
  { fromRank: 2, toRank: 2, tier: { key: 'top', name: '최우수상', honor: '국무총리상', prize: '100만원' } },
  { fromRank: 3, toRank: 4, tier: { key: 'excel', name: '우수상', honor: '행정안전부장관상', prize: '각 100만원' } },
  { fromRank: 5, toRank: 10, tier: { key: 'merit', name: '장려상', honor: 'NIA원장상', prize: '각 30만원' } },
];

// 세션2 시상: 심사계획(안) 5. 수상 결정
export const S2_AWARDS = {
  grand: { key: 'grand', name: '대상', honor: '국무총리상', prize: '200만원' },
  top: { key: 'top', name: '최우수상', honor: '행정안전부장관상', prize: '각 100만원' },
  excel: { key: 'excel', name: '우수상', honor: 'NIA원장상', prize: '각 50만원' },
  merit: { key: 'merit', name: '장려상', honor: 'NIA원장상', prize: '각 30만원' },
} satisfies Record<string, AwardTier>;

export interface Judge {
  id: string;
  name: string;
  org: string;
  position: string;
  isChair: boolean;
  active: boolean;
}

export interface TieOrder {
  key: string;
  order: number;
}

export interface Team {
  id: string;
  order: number;
  task: TaskId | null;
  org: string;
  teamName: string;
  work: string;
  presenter: string;
  prelimScore: number | null;
  withdrawn: boolean;
  awardWithheld: boolean;
  // 규정으로 못 가린 동점을 심사위원 협의로 정한 순서. key = 동점 묶음 팀 id 목록
  tieOrder: TieOrder | null;
  grandTieOrder: TieOrder | null;
  topic?: string | null; // 세션1 주제 유형
  finalComment?: string; // 운영진이 적는 팀별 최종 총평
}
export const COMMENT_MAX = 2000;

// 심사평가표 하단 '심사 의견' (양식: 주요 강점 / 보완 필요사항 / 구동 확인 결과)
export type RunCheck = 'ok' | 'partial' | 'fail';
export const RUN_CHECKS: { id: RunCheck; label: string }[] = [
  { id: 'ok', label: '정상 구동' },
  { id: 'partial', label: '일부 기능 오류' },
  { id: 'fail', label: '구동 불가' },
];

export interface ScoreEntry {
  levels: Record<string, number | null>;
  recused: boolean;
  strengths?: string;
  improve?: string;
  run?: RunCheck | null;
  runReason?: string;
  // 운영진이 최종 집계표에서 조정한 점수. 있으면 심사위원이 낸 점수 대신 이 값으로 집계한다 (심사위원은 넣을 수 없음)
  adj?: Adjustment | null;
  // 이전 조정 이력 (오래된 것부터)
  adjLog?: Adjustment[];
}

// 운영진 점수 조정 한 건: 총점, 지표별 점수(합 = 총점), 조정 사유, 반영 시각
export interface Adjustment {
  total: number;
  crit: Record<string, number>;
  reason: string;
  at: string;
}
export const ADJ_REASON_MAX = 500;

export interface Signature {
  dataUrl: string;
  signedAt: string;
  digest: string;
}

export interface SessionData {
  judges: Judge[];
  teams: Team[];
  // scores[judgeId][teamId]
  scores: Record<string, Record<string, ScoreEntry>>;
  signatures: Record<string, Signature>;
  locked: boolean;
}

export interface AppData {
  version: 1;
  eventDate: string;
  sessions: Record<SessionId, SessionData>;
}
