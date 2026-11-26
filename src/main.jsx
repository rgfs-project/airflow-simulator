import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './ui/App.jsx';
import './style.css';

// Render the page first: the engine attaches its canvas to #viewport when it loads.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<App />));
import('./engine.js');
