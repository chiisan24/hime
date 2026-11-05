import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredPreferences } from './lib/preferences'

// 保存済みの表示設定（文字サイズ）を起動時に反映
applyStoredPreferences()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
