import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildXlsx } from './xlsx';

it('엑셀 파일(zip)로 만들어진다', async () => {
  const blob = buildXlsx([['세션 2 AI 미션 경진 · 시험 위원 점수표'], [], ['발표', '기관명', '팀명', '합계'], [1, '화성시', '신환철 <A&B> "따옴표"', 88.5], [2, '=SUM(1,2)', '015', '회피']], { sheet: '세션 2 점수표', titleRows: [0], headerRows: [2] });
  const b = new Uint8Array(await blob.arrayBuffer());
  expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, b);
});
