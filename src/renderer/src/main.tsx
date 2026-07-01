import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './styles/app.css'
import { App } from './App'
import { MiniPlayer } from './components/MiniPlayer'

// The menu-bar popover window loads the same bundle with #mini in the URL.
const isMini = window.location.hash === '#mini'
if (isMini) document.body.classList.add('mini-body')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{isMini ? <MiniPlayer /> : <App />}</StrictMode>
)
