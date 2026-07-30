import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/hanken-grotesk'
import './index.css'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { I18nProvider } from './hooks/useI18n'
import { ThemeProvider } from './hooks/useTheme'
import { watchInstallPrompt } from './lib/install'
import { registerServiceWorker } from './lib/push'

// Register the service worker (push + offline app shell).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker()
  })
}

// Must run before React mounts: Chrome fires `beforeinstallprompt` once, early.
watchInstallPrompt()

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
