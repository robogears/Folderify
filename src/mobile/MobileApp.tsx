import { memo, useCallback, useEffect, useMemo, useState, type JSX } from 'react'
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
  RefreshIcon,
  AlertIcon
} from '../renderer/src/components/Icons'
import { formatTime, formatDurationLong, pluralize, normalizeSearch } from '../renderer/src/lib/format'
import { useMediaSession } from '../renderer/src/media-session'
import type { Track, Playlist } from '@shared/models'

type Tab = 'library' | 'search' | 'settings'

// IMPORTANT: every screen/component here is defined at MODULE scope, never inside
// MobileApp. Nesting them inside would give them a new identity on each MobileApp
// render and force React to REMOUNT the whole subtree — which, combined with the
// ~30fps currentTime updates, froze the app on large playlists. Each component now
// subscribes to only the store slices it needs, so a playing clock only re-renders
// the progress bar, not a 300-row track list.

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

/** A tappable track row. Memoized + self-subscribes to its own current/playing
 *  state, so a track change re-renders only the two affected rows, not the list. */
const MTrack = memo(function MTrack({
  track,
  index,
  onPlay
}: {
  track: Track
  index: number
  onPlay: (id: string) => void
}): JSX.Element {
  const isCurrent = usePlayer((s) => s.currentTrackId === track.id)
  const isPlaying = usePlayer((s) => s.isPlaying && s.currentTrackId === track.id)
  return (
    <button className={`m-track ${isCurrent ? 'is-current' : ''}`} onClick={() => onPlay(track.id)}>
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
})

// ---- Library grid ----
function LibraryScreen({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const playlists = useLibrary((s) => s.playlists)
  const tracksById = useLibrary((s) => s.tracksById)
  const rootName = useLibrary((s) => s.rootName)
  const scanning = useLibrary((s) => s.scanning)
  const scanProgress = useLibrary((s) => s.progress)
  return (
    <div className="m-screen">
      <header className="m-head">
        <h1 className="m-title">Library</h1>
        <p className="m-subtitle">
          {scanning
            ? scanProgress && scanProgress.phase === 'parsing' && scanProgress.total > 0
              ? `Scanning… ${scanProgress.scanned.toLocaleString()} / ${scanProgress.total.toLocaleString()}`
              : `Scanning… ${scanProgress ? scanProgress.scanned.toLocaleString() : ''}`
            : `${rootName ?? 'Folderify'} · ${pluralize(tracksById.size, 'track')}`}
        </p>
      </header>
      {playlists.length > 0 ? (
        <div className="m-grid">
          {playlists.map((pl) => {
            const cover = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
            return (
              <button key={pl.id} className="m-card" onClick={() => onOpen(pl.id)}>
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
}

// ---- Playlist detail ----
function PlaylistScreen({ pl, onBack }: { pl: Playlist; onBack: () => void }): JSX.Element {
  const tracksById = useLibrary((s) => s.tracksById)
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const shuffle = usePlayer((s) => s.shuffle)
  const playContext = usePlayer((s) => s.playContext)
  const togglePlay = usePlayer((s) => s.togglePlay)

  const list = useMemo(() => tracksOf(pl, tracksById), [pl, tracksById])
  const ids = useMemo(() => list.map((t) => t.id), [list])
  const total = useMemo(() => list.reduce((s, t) => s + (t.durationSec ?? 0), 0), [list])
  const onPlay = useCallback((id: string) => playContext(ids, id, pl.name), [ids, pl.name, playContext])

  const cover = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
  const playingHere = currentTrackId != null && ids.includes(currentTrackId)

  return (
    <div className="m-screen">
      <div className="m-navbar">
        <button className="m-back" onClick={onBack}>
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
            else if (ids.length) {
              // Respect the shuffle toggle: shuffle on -> start from a random track
              // (playContext then shuffles the rest); off -> play in order from #1.
              const startId = shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0]
              playContext(ids, startId, pl.name)
            }
          }}
        >
          {playingHere && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          {playingHere && isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>
      <div className="m-list">
        {list.map((t, i) => (
          <MTrack key={t.id} track={t} index={i + 1} onPlay={onPlay} />
        ))}
      </div>
    </div>
  )
}

// ---- Search ----
function SearchScreen({ query, setQuery }: { query: string; setQuery: (q: string) => void }): JSX.Element {
  const tracksById = useLibrary((s) => s.tracksById)
  const playContext = usePlayer((s) => s.playContext)

  const results = useMemo(() => {
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
  const ids = useMemo(() => results.map((t) => t.id), [results])
  const onPlay = useCallback((id: string) => playContext(ids, id, 'Search'), [ids, playContext])

  return (
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
        {query.trim() && results.length === 0 && <p className="m-empty-text">No matches.</p>}
        {results.map((t, i) => (
          <MTrack key={t.id} track={t} index={i + 1} onPlay={onPlay} />
        ))}
      </div>
    </div>
  )
}

// ---- Settings ----
function SettingsScreen(): JSX.Element {
  const rootName = useLibrary((s) => s.rootName)
  const root = useLibrary((s) => s.root)
  const trackCount = useLibrary((s) => s.tracksById.size)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const rescan = useLibrary((s) => s.rescan)
  const scanning = useLibrary((s) => s.scanning)
  return (
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
          <span className="m-row-v">{trackCount.toLocaleString()}</span>
        </div>
        <button className="m-btn" onClick={() => void chooseFolder()}>
          <FolderPlusIcon size={18} /> {root ? 'Change folder' : 'Connect a folder'}
        </button>
        {root && (
          <button className="m-btn m-btn-secondary" disabled={scanning} onClick={() => void rescan()}>
            <RefreshIcon size={18} /> {scanning ? 'Scanning…' : 'Rescan library'}
          </button>
        )}
        <p className="m-note">Folderify only reads your files — it never moves or changes anything.</p>
      </div>
    </div>
  )
}

/** The progress fill on the mini-player. Isolated so only THIS re-renders ~30fps. */
function MiniProgress(): JSX.Element {
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  return <span className="m-mini-progress" style={{ width: `${pct}%` }} />
}

// ---- Mini player bar ----
function MiniBar({ onExpand }: { onExpand: () => void }): JSX.Element | null {
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const next = usePlayer((s) => s.next)
  const tracksById = useLibrary((s) => s.tracksById)
  const track = currentTrackId ? tracksById.get(currentTrackId) : undefined
  if (!track) return null
  return (
    <button className="m-mini" onClick={onExpand}>
      <MiniProgress />
      <Cover trackId={track.id} hasArt={track.hasArt} className="m-mini-art" />
      <span className="m-mini-text">
        <span className="m-mini-title">{track.title}</span>
        <span className="m-mini-sub">{track.artist}</span>
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
  )
}

// ---- Full-screen now-playing sheet ----
function NowPlayingSheet({ onClose }: { onClose: () => void }): JSX.Element | null {
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const tracksById = useLibrary((s) => s.tracksById)
  const track = currentTrackId ? tracksById.get(currentTrackId) : undefined
  if (!track) return null
  return (
    <div className="m-sheet">
      <button className="m-sheet-close" onClick={onClose}>
        <ChevronDown />
      </button>
      <div className="m-sheet-art">
        <Cover trackId={track.id} hasArt={track.hasArt} size="lg" className="cover" />
      </div>
      <div className="m-sheet-meta">
        <h2 className="m-sheet-title">{track.title}</h2>
        <p className="m-sheet-artist">{track.artist}</p>
        {track.unsupported && (
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
  )
}

// ---- Bottom tab bar (Library pinned bottom-right) ----
function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }): JSX.Element {
  return (
    <nav className="m-tabbar">
      <button className={`m-tab ${tab === 'search' ? 'is-active' : ''}`} onClick={() => onSelect('search')}>
        <SearchIcon size={22} />
        <span>Search</span>
      </button>
      <button className={`m-tab ${tab === 'settings' ? 'is-active' : ''}`} onClick={() => onSelect('settings')}>
        <GearIcon size={22} />
        <span>Settings</span>
      </button>
      <button className={`m-tab ${tab === 'library' ? 'is-active' : ''}`} onClick={() => onSelect('library')}>
        <HomeIcon size={22} />
        <span>Library</span>
      </button>
    </nav>
  )
}

export function MobileApp(): JSX.Element {
  const init = useLibrary((s) => s.init)
  const ready = useLibrary((s) => s.ready)
  const playlists = useLibrary((s) => s.playlists)

  const [tab, setTab] = useState<Tab>('library')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    init()
  }, [init])

  // Drive the iOS lock screen / Control Center / AirPods via the Web MediaSession
  // API (WebKit owns the Now Playing session while <audio> plays; see media-session.ts).
  useMediaSession()

  if (!ready) {
    return <div className="m-splash" />
  }

  const openPlaylist = openId ? playlists.find((p) => p.id === openId) : undefined

  // Tapping the Library tab always lands on the library grid — if a playlist is
  // open, it backs out to the root instead of doing nothing.
  const selectTab = (t: Tab): void => {
    if (t === 'library') setOpenId(null)
    setTab(t)
  }

  return (
    <div className="m-app">
      <main className="m-content">
        {tab === 'library' &&
          (openPlaylist ? (
            <PlaylistScreen pl={openPlaylist} onBack={() => setOpenId(null)} />
          ) : (
            <LibraryScreen onOpen={setOpenId} />
          ))}
        {tab === 'search' && <SearchScreen query={query} setQuery={setQuery} />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      {!sheet && <MiniBar onExpand={() => setSheet(true)} />}

      <TabBar tab={tab} onSelect={selectTab} />

      {sheet && <NowPlayingSheet onClose={() => setSheet(false)} />}
    </div>
  )
}
