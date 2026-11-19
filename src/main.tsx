import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles/review.css';
import './styles/app.css';
import { applyPrefs } from './lib/prefs';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';

applyPrefs();
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
