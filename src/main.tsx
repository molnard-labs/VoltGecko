import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
// Keep editor base styles before the shared appearance overrides, even when
// their JavaScript is first opened later in the session.
import './components/floorplan.css';
import './components/plan-display.css';
import './components/plan-image-fields.css';
import './components/plan-upload.css';
import './components/board-wiring.css';
import './components/integrated-board-planner.css';
import './components/single-line.css';
import './components/product-library.css';
import './styles.css';
import './app/sidebar-catalog.css';
import './appearance.css';
import './components/board-cabinet.css';
import './theme';
const updateSW = registerSW({ onNeedRefresh() { window.dispatchEvent(new CustomEvent('app-update', { detail: () => updateSW(true) })); } });
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
