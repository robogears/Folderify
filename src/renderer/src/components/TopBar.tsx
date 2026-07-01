import { useState, type JSX } from 'react'
import { useLibrary } from '../state/library-store'
import { useSettings } from '../state/settings-store'
import { SearchIcon, RefreshIcon, FolderIcon, GearIcon, CloseIcon } from './Icons'

export function TopBar(): JSX.Element {
  const search = useLibrary((s) => s.search)
  const setSearch = useLibrary((s) => s.setSearch)
  const rootName = useLibrary((s) => s.rootName)
  const root = useLibrary((s) => s.root)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const rescan = useLibrary((s) => s.rescan)
  const forget = useLibrary((s) => s.forget)
  const scanning = useLibrary((s) => s.scanning)
  const openSettings = useSettings((s) => s.openSettings)

  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="topbar drag">
      <label className="search-wrap no-drag">
        <SearchIcon size={16} className="search-icon" />
        <input
          className="search-input"
          placeholder="Search your library"
          value={search}
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
            <CloseIcon size={12} />
          </button>
        )}
      </label>

      <div className="topbar-right no-drag">
        <button
          className={`icon-btn ${scanning ? 'is-spinning' : ''}`}
          title="Rescan folder"
          onClick={() => void rescan()}
        >
          <RefreshIcon size={18} />
        </button>

        <button className="icon-btn" title="Settings" onClick={openSettings}>
          <GearIcon size={18} />
        </button>

        <div className="menu-anchor">
          <button className="folder-chip" onClick={() => setMenuOpen((o) => !o)} title={root ?? ''}>
            <FolderIcon size={15} />
            <span className="folder-chip-name">{rootName}</span>
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu">
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    void chooseFolder()
                  }}
                >
                  Change folder…
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    if (root) void window.api.revealTrack(root)
                  }}
                >
                  Reveal in Finder
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    void rescan()
                  }}
                >
                  Rescan
                </button>
                <div className="menu-sep" />
                <button
                  className="menu-item is-danger"
                  onClick={() => {
                    setMenuOpen(false)
                    void forget()
                  }}
                >
                  Disconnect folder
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
