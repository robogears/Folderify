import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Install the stub window.api BEFORE the app (and its stores) load.
import './api-stub'
import '../renderer/src/styles/global.css'
import '../renderer/src/styles/app.css'
import './mobile.css'
import { MobileApp } from './MobileApp'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>
)
