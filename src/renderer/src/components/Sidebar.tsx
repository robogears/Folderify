import type { JSX } from 'react'
import { useLibrary, ALL_SONGS_ID } from '../state/library-store'
import { usePlayer } from '../state/player-store'
import { useSettings } from '../state/settings-store'
import { HomeIcon, MusicIcon, PanelLeftIcon } from './Icons'
import { Cover } from './Cover'
import { PlayingIndicator } from './PlayingIndicator'
import { pluralize } from '../lib/format'

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: JSX.Element
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button className={`nav-item no-drag ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  )
}

export function Sidebar(): JSX.Element {
  const playlists = useLibrary((s) => s.playlists)
  const selection = useLibrary((s) => s.selection)
  const select = useLibrary((s) => s.select)
  const tracksById = useLibrary((s) => s.tracksById)

  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const playingPlaylistId = currentTrackId ? tracksById.get(currentTrackId)?.playlistId : undefined

  const toggleSidebar = useSettings((s) => s.toggleSidebar)

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="logo no-drag">
          <span className="logo-mark" aria-hidden="true" />
          <span className="logo-word">Folderify</span>
        </div>
        <button className="icon-btn collapse-btn no-drag" onClick={toggleSidebar} title="Collapse sidebar">
          <PanelLeftIcon size={18} />
        </button>
      </div>

      <nav className="nav no-drag">
        <NavItem icon={<HomeIcon size={20} />} label="Home" active={selection === null} onClick={() => select(null)} />
        <NavItem
          icon={<MusicIcon size={20} />}
          label="All Songs"
          active={selection === ALL_SONGS_ID}
          onClick={() => select(ALL_SONGS_ID)}
        />
      </nav>

      <div className="sidebar-section-head">
        <span className="eyebrow">Your Folders</span>
        {playlists.length > 0 && <span className="eyebrow-count">{playlists.length}</span>}
      </div>

      <div className="folder-list no-drag">
        {playlists.map((pl) => {
          const cover = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
          const active = selection === pl.id
          const isThisPlaying = playingPlaylistId === pl.id
          return (
            <button
              key={pl.id}
              className={`folder-item ${active ? 'is-active' : ''}`}
              onClick={() => select(pl.id)}
              title={pl.name}
            >
              {active && <span className="active-bar" />}
              <span className="folder-thumb-wrap">
                <Cover trackId={pl.coverTrackId} hasArt={cover?.hasArt ?? false} className="folder-thumb" />
              </span>
              <span className="folder-meta">
                <span className="folder-name">{pl.name}</span>
                <span className="folder-sub">{pluralize(pl.trackIds.length, 'track')}</span>
              </span>
              {isThisPlaying && <PlayingIndicator playing={isPlaying} />}
            </button>
          )
        })}
        {playlists.length === 0 && (
          <p className="folder-empty">
            No subfolders yet. Add folders inside your music folder and they’ll appear here as playlists.
          </p>
        )}
      </div>
    </aside>
  )
}
