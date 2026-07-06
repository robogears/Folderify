import { useEffect, useRef, type JSX } from 'react'
import { useLibrary, ALL_SONGS_ID } from './state/library-store'
import { usePlayer, readLastPlayed } from './state/player-store'
import { useSettings } from './state/settings-store'
import { useUpdates } from './state/updates-store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { SettingsPanel } from './components/SettingsPanel'
import { ListenPanel } from './components/ListenPanel'
import { QueuePanel } from './components/QueuePanel'
import { NowPlayingBar } from './components/NowPlayingBar'
import { FolderHero } from './components/FolderHero'
import { TrackList } from './components/TrackList'
import { AlbumGrid } from './components/AlbumGrid'
import { Toast } from './components/Toast'
import { Logo } from './components/Icons'
import { useTrayBridge } from './tray-bridge'
import { useMediaSession } from './media-session'
import { normalizeSearch, formatDurationLong, pluralize } from './lib/format'
import { LOOSE_PLAYLIST_ID, type Track } from '@shared/models'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night listening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function byArtistAlbumTrack(a: Track, b: Track): number {
  const ar = a.artist.localeCompare(b.artist)
  if (ar !== 0) return ar
  const al = a.album.localeCompare(b.album)
  if (al !== 0) return al
  return (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || a.title.localeCompare(b.title)
}

function EmptyMessage({ text }: { text: string }): JSX.Element {
  return <div className="view-empty">{text}</div>
}

function ScanChip(): JSX.Element | null {
  const scanning = useLibrary((s) => s.scanning)
  const progress = useLibrary((s) => s.progress)
  if (!scanning) return null
  const label =
    progress && progress.phase === 'parsing' && progress.total > 0
      ? `Reading tags… ${progress.scanned} / ${progress.total}`
      : progress && progress.phase === 'walking'
        ? `Finding music… ${progress.scanned}`
        : 'Scanning your folder…'
  const pct = progress && progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0
  return (
    <div className="scan-chip">
      <span className="scan-spinner" />
      <div className="scan-chip-body">
        <span className="scan-chip-label">{label}</span>
        {progress?.phase === 'parsing' && (
          <span className="scan-bar">
            <span className="scan-bar-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
    </div>
  )
}

function MainView(): JSX.Element | null {
  const selection = useLibrary((s) => s.selection)
  const search = useLibrary((s) => s.search)
  const playlists = useLibrary((s) => s.playlists)
  const tracksById = useLibrary((s) => s.tracksById)

  const isPlaying = usePlayer((s) => s.isPlaying)
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const playContext = usePlayer((s) => s.playContext)

  // --- Search across the whole library ---
  const query = search.trim()
  if (query) {
    const q = normalizeSearch(query)
    const results = [...tracksById.values()]
      .filter(
        (t) =>
          normalizeSearch(t.title).includes(q) ||
          normalizeSearch(t.artist).includes(q) ||
          normalizeSearch(t.album).includes(q)
      )
      .sort((a, b) => a.title.localeCompare(b.title))
    return (
      <div className="view">
        <div className="view-head">
          <h1 className="page-title">Search</h1>
          <p className="page-sub">
            {pluralize(results.length, 'result')} for “{query}”
          </p>
        </div>
        {results.length > 0 ? (
          <TrackList tracks={results} contextLabel="Search results" />
        ) : (
          <EmptyMessage text="No matches. Try another title, artist, or album." />
        )}
      </div>
    )
  }

  // --- Home ---
  if (selection === null) {
    return (
      <div className="view">
        <div className="view-head">
          <h1 className="page-title">{greeting()}</h1>
          <p className="page-sub">
            {playlists.length > 0
              ? `${pluralize(playlists.length, 'folder')} · ${pluralize(tracksById.size, 'track')}`
              : 'No music found in this folder yet'}
          </p>
        </div>
        {playlists.length > 0 ? (
          <AlbumGrid playlists={playlists} />
        ) : (
          <EmptyMessage text="Drop some audio files or folders into your music folder — they’ll appear here automatically." />
        )}
      </div>
    )
  }

  // --- All Songs or a specific playlist ---
  let tracks: Track[]
  let title: string
  let eyebrow: string
  let coverTrackId: string | null
  let hasArt = false

  if (selection === ALL_SONGS_ID) {
    tracks = [...tracksById.values()].sort(byArtistAlbumTrack)
    title = 'All Songs'
    eyebrow = 'Library'
    const artTrack = tracks.find((t) => t.hasArt)
    coverTrackId = artTrack?.id ?? tracks[0]?.id ?? null
    hasArt = !!artTrack
  } else {
    const pl = playlists.find((p) => p.id === selection)
    if (!pl) return null
    tracks = pl.trackIds.map((id) => tracksById.get(id)).filter((t): t is Track => !!t)
    title = pl.name
    eyebrow = pl.id === LOOSE_PLAYLIST_ID ? 'Library' : 'Folder'
    coverTrackId = pl.coverTrackId
    const ct = pl.coverTrackId ? tracksById.get(pl.coverTrackId) : undefined
    hasArt = ct?.hasArt ?? false
  }

  const totalDur = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0)
  const meta = `${pluralize(tracks.length, 'song')} · ${formatDurationLong(totalDur)}`

  const ids = tracks.map((t) => t.id)
  const isThisContext = currentTrackId != null && ids.includes(currentTrackId)
  const heroPlaying = isThisContext && isPlaying
  const onHeroToggle = (): void => {
    if (isThisContext) togglePlay()
    else if (ids.length > 0) playContext(ids, ids[0], title)
  }

  return (
    <div className="view">
      <FolderHero
        eyebrow={eyebrow}
        title={title}
        meta={meta}
        coverTrackId={coverTrackId}
        hasArt={hasArt}
        playing={heroPlaying}
        onPlayToggle={onHeroToggle}
      />
      {tracks.length > 0 ? (
        <TrackList tracks={tracks} contextLabel={title} />
      ) : (
        <EmptyMessage text="This folder has no playable audio." />
      )}
    </div>
  )
}

export function App(): JSX.Element {
  const init = useLibrary((s) => s.init)
  const initUpdates = useUpdates((s) => s.init)
  const ready = useLibrary((s) => s.ready)
  const root = useLibrary((s) => s.root)
  const tracksById = useLibrary((s) => s.tracksById)

  const layout = useSettings((s) => s.layout)
  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed)
  const resumeLastTrack = useSettings((s) => s.resumeLastTrack)

  useEffect(() => {
    init()
    initUpdates()
    // Re-apply the persisted exclusive-media-keys grab (main is stateless about it).
    // Goes through the store action so a failed grab reverts the toggle + explains.
    const s = useSettings.getState()
    if (s.exclusiveMediaKeys) s.setExclusiveMediaKeys(true)
  }, [init, initUpdates])

  useTrayBridge()
  useMediaSession()

  // Resume the last-played track once the library is loaded (paused, cued up).
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !resumeLastTrack || tracksById.size === 0) return
    restoredRef.current = true
    const last = readLastPlayed()
    if (last && usePlayer.getState().currentTrackId == null && tracksById.has(last.trackId)) {
      usePlayer.getState().restore(last.trackId, last.time)
    }
  }, [tracksById, resumeLastTrack])

  if (!ready) {
    return (
      <div className="splash drag">
        <Logo size={56} className="splash-logo" />
      </div>
    )
  }

  if (!root) return <EmptyState />

  return (
    <div className="app" data-layout={layout} data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}>
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="main-scroll">
          <MainView />
        </div>
        <ScanChip />
      </main>
      <NowPlayingBar />
      <QueuePanel />
      <SettingsPanel />
      <ListenPanel />
      <Toast />
    </div>
  )
}
