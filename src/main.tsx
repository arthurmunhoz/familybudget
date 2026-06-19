import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { I18nProvider } from './hooks/useI18n'
import { ThemeProvider } from './hooks/useTheme'
import { registerServiceWorker } from './lib/push'

// Register the push-only service worker so opted-in devices can receive the
// daily reminder digest. It has no fetch handler, so it never affects loading.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <I18nProvider>
            <App />
          </I18nProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
