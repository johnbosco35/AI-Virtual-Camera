import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { prewarmTracker } from './hooks/useFaceTracking';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Load the face-tracking models while the user is still on the dashboard.
window.setTimeout(prewarmTracker, 1500);
