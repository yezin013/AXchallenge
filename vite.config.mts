import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// THEME=d2 처럼 지정하면 디자인 변형 CSS를 덧씌운다 (기본 d1 = 빈 파일)
const theme = process.env.THEME ?? 'd1';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [{ find: /^@theme.css$/, replacement: fileURLToPath(new URL(`./src/themes/${theme}.css`, import.meta.url)) }],
  },
  build: { target: 'es2020' },
});
