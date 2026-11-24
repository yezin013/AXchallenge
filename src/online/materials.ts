// 발표 자료 공통 규칙 (화면·서버 함께 사용)
// 자료 구분: submit = 제출 자료(참가 신청 때 낸 구동안내서·시연영상 등), final = 최종 발표자료(결선 발표용)
export type MaterialGroup = 'submit' | 'final';
export const MATERIAL_GROUPS: { id: MaterialGroup; label: string }[] = [
  { id: 'submit', label: '제출 자료' },
  { id: 'final', label: '최종 발표자료' },
];

export interface Material {
  path: string; // 저장 경로: 세션/팀/파일키 (최종 발표자료는 세션/팀/final/파일키)
  group: MaterialGroup;
  name: string; // 화면에 보이는 파일 이름
  size: number;
  url: string; // 1시간 동안 열 수 있는 주소
}

// 화면 안에서 바로 미리볼 수 있는 형식만 받는다 (PPT는 PDF로 바꿔 올린다)
export const MATERIAL_EXT = ['pdf', 'mp4', 'webm', 'png', 'jpg', 'jpeg'] as const;
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024; // 저장소 무료 요금제의 파일 하나 상한
export const MATERIAL_MAX_PER_TEAM = 6; // 구분마다
const NAME_MAX = 60;

export function materialKind(name: string): 'pdf' | 'video' | 'image' | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'mp4' || ext === 'webm') return 'video';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'image';
  return null;
}

const b64 = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

// 한글 파일 이름은 저장 경로에 그대로 못 쓰므로, 이름 부분을 영문·숫자로 바꿔 저장한다
export function materialKey(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  const base = fileName.slice(0, dot).trim();
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (!base || base.length > NAME_MAX || !(MATERIAL_EXT as readonly string[]).includes(ext)) return null;
  return `${b64(base)}.${ext}`;
}

export function materialName(key: string): string | null {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = key.slice(dot + 1);
  if (!(MATERIAL_EXT as readonly string[]).includes(ext) || !/^[A-Za-z0-9_-]+$/.test(key.slice(0, dot))) return null;
  try {
    return `${unb64(key.slice(0, dot))}.${ext}`;
  } catch {
    return null;
  }
}

export function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
