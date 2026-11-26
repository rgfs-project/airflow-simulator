import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './ui/App.jsx';
import './style.css';

// Render the page first: the engine attaches its canvas to #viewport when it loads.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<App />));
import('./engine.js');

// Block page zoom: pinch (Safari gestures, trackpad ctrl+wheel) and Cmd/Ctrl +/-/0.
// The 3D view keeps its own zoom.
const stop = (e) => e.preventDefault();
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !e.target.closest('canvas')) e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '0'].includes(e.key)) e.preventDefault();
  if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !e.target.closest('input, select, textarea')) e.preventDefault();
});
