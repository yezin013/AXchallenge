import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OfflineCorpApp } from './layouts/Corp';
import { OnlineApp } from './online/OnlineApp';
import './styles.css';
import '@theme.css';

// VITE_LAYOUT 으로 화면 구조를 고른다 (없으면 디자인1)
// VITE_ONLINE=1 이면 서버 저장(운영진·심사위원 접속 코드) 버전
const Root = import.meta.env.VITE_ONLINE === '1' ? OnlineApp : import.meta.env.VITE_LAYOUT === 'corp' ? OfflineCorpApp : App;

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
