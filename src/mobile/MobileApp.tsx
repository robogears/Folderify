import { useEffect, useMemo, useState, type JSX } from 'react'
import { useLibrary } from '../renderer/src/state/library-store'
import { usePlayer } from '../renderer/src/state/player-store'
import { Cover } from '../renderer/src/components/Cover'
import { SeekBar } from '../renderer/src/components/SeekBar'
import { TransportControls } from '../renderer/src/components/TransportControls'
import { VolumeSlider } from '../renderer/src/components/VolumeSlider'
import { PlayingIndicator } from '../renderer/src/components/PlayingIndicator'
import {
  HomeIcon,
  SearchIcon,
  GearIcon,
  PlayIcon,
  PauseIcon,
  NextIcon,
  MusicIcon,
  FolderPlusIcon,
  AlertIcon
} from '../renderer/src/components/Icons'
import { formatTime, formatDurationLong, pluralize, normalizeSearch } from '../renderer/src/lib/format'
import type { Track, Playlist } from '@shared/models'

type Tab = 'library' | 'search' | 'settings'

function ChevronLeft(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18 9 12l6-6" />
    </svg>
  )
}
function ChevronDown(): JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function tracksOf(pl: Playlist, byId: Map<string, Track>): Track[] {
  return pl.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t)
}

/** A tappable track row (single tap plays — no hover on touch). */
function MTrack({
  track,
  index,
  onPlay
}: {
  track: Track
  index: number
  onPlay: () => void
}): JSX.Element {
  const isCurrent = usePlayer((s) => s.currentTrackId === track.id)
  const isPlaying = usePlayer((s) => s.isPlaying && s.currentTrackId === track.id)
  return (
    <button className={`m-track ${isCurrent ? 'is-current' : ''}`} onClick={onPlay}>
      <span className="m-track-lead">
        {isCurrent ? (
          <PlayingIndicator playing={isPlaying} />
        ) : (
          <span className="m-track-num tnum">{index}</span>
        )}
      </span>
      <Cover trackId={track.id} hasArt={track.hasArt} className="m-track-art" />
      <span className="m-track-text">
        <span className="m-track-title">{track.title}</span>
        <span className="m-track-sub">
          {track.artist}
          {track.unsupported && <span className="m-badge">Can’t play</span>}
        </span>
      </span>
      <span className="m-track-dur tnum">{formatTime(track.durationSec)}</span>
    </button>
  )
}

export function MobileApp(): JSX.Element {
  const init = useLibrary((s) => s.init)
  const ready = useLibrary((s) => s.ready)
  const rootName = useLibrary((s) => s.rootName)
  const root = useLibrary((s) => s.root)
  const playlists = useLibrary((s) => s.playlists)
  const tracksById = useLibrary((s) => s.tracksById)
  const chooseFolder = useLibrary((s) => s.chooseFolder)

  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const playContext = usePlayer((s) => s.playContext)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const next = usePlayer((s) => s.next)
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)

  const [tab, setTab] = useState<Tab>('library')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    init()
  }, [init])

  const currentTrack = currentTrackId ? tracksById.get(currentTrackId) : undefined
  const openPlaylist = openId ? playlists.find((p) => p.id === openId) : undefined

  const searchResults = useMemo(() => {
    const q = normalizeSearch(query)
    if (!q) return []
    return [...tracksById.values()]
      .filter(
        (t) =>
          normalizeSearch(t.title).includes(q) ||
          normalizeSearch(t.artist).includes(q) ||
          normalizeSearch(t.album).includes(q)
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [query, tracksById])

  const progress = duration > 0 ? currentTime / duration : 0

  // ---- Screens ----
  const LibraryScreen = (): JSX.Element => (
    <div className="m-screen">
      <header className="m-head">
        <h1 className="m-title">Library</h1>
        <p className="m-subtitle">
          {rootName ?? 'Folderify'} · {pluralize(tracksById.size, 'track')}
        </p>
      </header>
      {playlists.length > 0 ? (
        <div className="m-grid">
          {playlists.map((pl) => {
            const cover = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
            return (
              <button key={pl.id} className="m-card" onClick={() => setOpenId(pl.id)}>
                <span className="m-card-art">
                  <Cover trackId={pl.coverTrackId} hasArt={cover?.hasArt ?? false} size="lg" className="cover" />
                </span>
                <span className="m-card-name">{pl.name}</span>
                <span className="m-card-sub">{pluralize(pl.trackIds.length, 'track')}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="m-empty">
          <MusicIcon size={40} />
          <p>No folders yet.</p>
        </div>
      )}
    </div>
  )

  const PlaylistScreen = ({ pl }: { pl: Playlist }): JSX.Element => {
    const list = tracksOf(pl, tracksById)
    const ids = list.map((t) => t.id)
    const cover = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
    const total = list.reduce((s, t) => s + (t.durationSec ?? 0), 0)
    const playingHere = currentTrackId != null && ids.includes(currentTrackId)
    return (
      <div className="m-screen">
        <div className="m-navbar">
          <button className="m-back" onClick={() => setOpenId(null)}>
            <ChevronLeft />
          </button>
        </div>
        <div className="m-hero">
          <span className="m-hero-art">
            <Cover trackId={pl.coverTrackId} hasArt={cover?.hasArt ?? false} size="lg" className="cover" />
          </span>
          <h1 className="m-hero-title">{pl.name}</h1>
          <p className="m-hero-meta">
            {pluralize(list.length, 'song')} · {formatDurationLong(total)}
          </p>
          <button
            className="m-play-btn"
            onClick={() => {
              if (playingHere) togglePlay()
              else if (ids.length) playContext(ids, ids[0], pl.name)
            }}
          >
            {playingHere && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            {playingHere && isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
        <div className="m-list">
          {list.map((t, i) => (
            <MTrack key={t.id} track={t} index={i + 1} onPlay={() => playContext(ids, t.id, pl.name)} />
          ))}
        </div>
      </div>
    )
  }

  const SearchScreen = (): JSX.Element => (
    <div className="m-screen">
      <header className="m-head">
        <h1 className="m-title">Search</h1>
      </header>
      <label className="m-search">
        <SearchIcon size={18} />
        <input
          className="m-search-input"
          placeholder="Titles, artists, albums"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCorrect="off"
          autoCapitalize="none"
        />
      </label>
      <div className="m-list">
        {query.trim() && searchResults.length === 0 && <p className="m-empty-text">No matches.</p>}
        {searchResults.map((t, i) => (
          <MTrack
            key={t.id}
            track={t}
            index={i + 1}
            onPlay={() => playContext(searchResults.map((x) => x.id), t.id, 'Search')}
          />
        ))}
      </div>
    </div>
  )

  const SettingsScreen = (): JSX.Element => (
    <div className="m-screen">
      <header className="m-head">
        <h1 className="m-title">Settings</h1>
      </header>
      <div className="m-settings">
        <div className="m-row">
          <span className="m-row-k">Folder</span>
          <span className="m-row-v">{rootName ?? '—'}</span>
        </div>
        <div className="m-row">
          <span className="m-row-k">Tracks</span>
          <span className="m-row-v">{tracksById.size.toLocaleString()}</span>
        </div>
        <button className="m-btn" onClick={() => void chooseFolder()}>
          <FolderPlusIcon size={18} /> {root ? 'Change folder' : 'Connect a folder'}
        </button>
        <p className="m-note">Folderify only reads your files — it never moves or changes anything.</p>
      </div>
    </div>
  )

  if (!ready) {
    return <div className="m-splash" />
  }

  return (
    <div className="m-app">
      <main className="m-content">
        {tab === 'library' && (openPlaylist ? <PlaylistScreen pl={openPlaylist} /> : <LibraryScreen />)}
        {tab === 'search' && <SearchScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      {currentTrack && !sheet && (
        <button className="m-mini" onClick={() => setSheet(true)}>
          <span className="m-mini-progress" style={{ width: `${progress * 100}%` }} />
          <Cover trackId={currentTrack.id} hasArt={currentTrack.hasArt} className="m-mini-art" />
          <span className="m-mini-text">
            <span className="m-mini-title">{currentTrack.title}</span>
            <span className="m-mini-sub">{currentTrack.artist}</span>
          </span>
          <span
            className="m-mini-btn"
            onClick={(e) => {
              e.stopPropagation()
              togglePlay()
            }}
          >
            {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </span>
          <span
            className="m-mini-btn"
            onClick={(e) => {
              e.stopPropagation()
              next(false)
            }}
          >
            <NextIcon size={22} />
          </span>
        </button>
      )}

      <nav className="m-tabbar">
        <button className={`m-tab ${tab === 'library' ? 'is-active' : ''}`} onClick={() => setTab('library')}>
          <HomeIcon size={22} />
          <span>Library</span>
        </button>
        <button className={`m-tab ${tab === 'search' ? 'is-active' : ''}`} onClick={() => setTab('search')}>
          <SearchIcon size={22} />
          <span>Search</span>
        </button>
        <button className={`m-tab ${tab === 'settings' ? 'is-active' : ''}`} onClick={() => setTab('settings')}>
          <GearIcon size={22} />
          <span>Settings</span>
        </button>
      </nav>

      {sheet && currentTrack && (
        <div className="m-sheet">
          <button className="m-sheet-close" onClick={() => setSheet(false)}>
            <ChevronDown />
          </button>
          <div className="m-sheet-art">
            <Cover trackId={currentTrack.id} hasArt={currentTrack.hasArt} size="lg" className="cover" />
          </div>
          <div className="m-sheet-meta">
            <h2 className="m-sheet-title">{currentTrack.title}</h2>
            <p className="m-sheet-artist">{currentTrack.artist}</p>
            {currentTrack.unsupported && (
              <p className="m-sheet-warn">
                <AlertIcon size={15} /> This format can’t be played on device
              </p>
            )}
          </div>
          <div className="m-sheet-seek">
            <SeekBar />
          </div>
          <div className="m-sheet-transport">
            <TransportControls />
          </div>
          <div className="m-sheet-vol">
            <VolumeSlider />
          </div>
        </div>
      )}
    </div>
  )
}
