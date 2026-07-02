import type { JSX } from 'react'
import { useLibrary } from '../state/library-store'
import { FolderPlusIcon } from './Icons'
import { Toast } from './Toast'

export function EmptyState(): JSX.Element {
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  return (
    <div className="empty-state drag">
      <div className="empty-glow" />
      <div className="empty-card no-drag">
        <div className="empty-icon">
          <FolderPlusIcon size={34} />
        </div>
        <h1 className="empty-title">Turn a folder into a playlist</h1>
        <p className="empty-sub">
          Pick the folder that holds your music. Everything inside becomes your library, and each subfolder
          shows up as a playlist — automatically.
        </p>
        <button className="btn-primary btn-lg" onClick={() => void chooseFolder()}>
          Choose your music folder
        </button>
        <p className="empty-hint">Folderify only reads your files. It never moves, copies, or changes anything.</p>
      </div>
      <Toast />
    </div>
  )
}
