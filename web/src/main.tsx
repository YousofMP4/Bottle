import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { App } from './App';

// Carry view preferences over from before the rename (bottle.* -> portal.*).
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('bottle.') && localStorage.getItem('portal.' + k.slice(7)) === null) localStorage.setItem('portal.' + k.slice(7), localStorage.getItem(k)!);
  }
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(<App />);
