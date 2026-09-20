import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { Boundary } from './ui';
import './styles.css';

/** The last net, under the ones each section has: never a blank page. The address may be what breaks, so the way out starts from the home section. */
function fromHome() {
  window.location.hash = '#home';
  window.location.reload();
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <Boundary
      fallback={() => (
        <main className="login">
          <div className="state-card" role="alert">
            <strong>تعذّر عرض اللوحة</strong>
            <p className="muted">حدث خطأ غير متوقع أثناء عرض الصفحة.</p>
            <button type="button" onClick={fromHome}>إعادة التحميل من الرئيسية</button>
          </div>
        </main>
      )}
    >
      <App />
    </Boundary>
  </StrictMode>,
);
