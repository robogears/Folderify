import type { JSX } from 'react'
import { Cover } from './Cover'
import { PlayIcon } from './Icons'
import { pluralize } from '../lib/format'
import { useLibrary } from '../state/library-store'
import { usePlayer } from '../state/player-store'
import type { Playlist } from '@shared/models'

function AlbumCard({ playlist }: { playlist: Playlist }): JSX.Element {
  const select = useLibrary((s) => s.select)
  const tracksById = useLibrary((s) => s.tracksById)
  const playContext = usePlayer((s) => s.playContext)
  const cover = playlist.coverTrackId ? tracksById.get(playlist.coverTrackId) : undefined

  const play = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (playlist.trackIds.length > 0) playContext(playlist.trackIds, playlist.trackIds[0], playlist.name)
  }

  return (
    <div className="album-card" onClick={() => select(playlist.id)} onDoubleClick={play}>
      <div className="album-art-wrap">
        <Cover trackId={playlist.coverTrackId} hasArt={cover?.hasArt ?? false} size="lg" className="album-art" />
        <button className="album-play" onClick={play} aria-label={`Play ${playlist.name}`}>
          <PlayIcon size={20} />
        </button>
      </div>
      <div className="album-name" title={playlist.name}>
        {playlist.name}
      </div>
      <div className="album-sub">{pluralize(playlist.trackIds.length, 'track')}</div>
    </div>
  )
}

export function AlbumGrid({ playlists }: { playlists: Playlist[] }): JSX.Element {
  return (
    <div className="album-grid">
      {playlists.map((pl) => (
        <AlbumCard key={pl.id} playlist={pl} />
      ))}
    </div>
  )
}
