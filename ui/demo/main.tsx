// TEMPORARY demo build of the chat page (interim client update). Same look as the main UI, built from its components,
// with fewer features. Remove with the ui/demo folder, ui/vite.demo.config.ts and the DEMO-UI lines in run.mjs.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import DemoPage from './DemoPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoPage />
  </StrictMode>,
);
