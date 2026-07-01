import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Install window.api (native bridge on device, stub in a browser) BEFORE the app
// and its stores load, so the first getLibrary()/listener wiring hits a real api.
import { installApi } from './install-api'
import '../renderer/src/styles/global.css'
import '../renderer/src/styles/app.css'
import './mobile.css'
import { MobileApp } from './MobileApp'

installApi()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>
)
