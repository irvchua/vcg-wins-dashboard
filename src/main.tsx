import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { clearLegacyBoardStorage } from './lib/boardStorage'
import { isFirebaseAppConfigured } from './lib/firebase/auth'

if (isFirebaseAppConfigured) clearLegacyBoardStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
