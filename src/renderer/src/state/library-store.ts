import { create } from 'zustand'
import type { LibraryModel, Track, Playlist, FsDelta, ScanProgress } from '@shared/models'
import { useNotice } from './notice-store'

/** Special selection ids (null = Home grid). */
export const ALL_SONGS_ID = '__all__'

interface LibraryState {
  root: string | null
  rootName: string | null
  playlists: Playlist[]
  tracksById: Map<string, Track>
  scanning: boolean
  progress: ScanProgress | null
  ready: boolean

  /** null = Home, ALL_SONGS_ID = all songs, otherwise a playlist id. */
  selection: string | null
  search: string

  init: () => void
  applyModel: (m: LibraryModel) => void
  applyDelta: (d: FsDelta) => void
  select: (id: string | null) => void
  setSearch: (q: string) => void
  chooseFolder: () => Promise<void>
  rescan: () => Promise<void>
  forget: () => Promise<void>
}

let initialized = false

export const useLibrary = create<LibraryState>((set, get) => ({
  root: null,
  rootName: null,
  playlists: [],
  tracksById: new Map(),
  scanning: false,
  progress: null,
  ready: false,
  selection: null,
  search: '',

  init: () => {
    if (initialized) return
    initialized = true
    // Attach listeners BEFORE the first fetch so we can't miss a push.
    window.api.onLoaded((m) => get().applyModel(m))
    window.api.onChanged((d) => get().applyDelta(d))
    window.api.onScanProgress((p) => {
      if (p.phase === 'error') {
        useNotice.getState().show("Couldn't finish scanning your folder. Try Rescan.")
        set({ scanning: false, progress: null })
        return
      }
      set({ progress: p, scanning: !p.done })
    })
    void window.api.getLibrary().then((m) => get().applyModel(m))
  },

  applyModel: (m: LibraryModel) => {
    const tracksById = new Map<string, Track>()
    for (const t of m.tracks) tracksById.set(t.id, t)
    set((s) => ({
      root: m.root,
      rootName: m.rootName,
      playlists: m.playlists,
      tracksById,
      scanning: m.scanning ?? false,
      ready: true,
      // If the current selection no longer exists, fall back to Home.
      selection:
        s.selection && s.selection !== ALL_SONGS_ID && !m.playlists.some((p) => p.id === s.selection)
          ? null
          : s.selection
    }))
  },

  applyDelta: (d: FsDelta) => {
    set((s) => {
      const next = new Map(s.tracksById)
      for (const id of d.removedIds) next.delete(id)
      for (const t of d.added) next.set(t.id, t)
      for (const t of d.updated) next.set(t.id, t)
      return {
        tracksById: next,
        playlists: d.playlists,
        selection:
          s.selection && s.selection !== ALL_SONGS_ID && !d.playlists.some((p) => p.id === s.selection)
            ? null
            : s.selection
      }
    })
  },

  select: (id) => set({ selection: id }),
  setSearch: (q) => set({ search: q }),

  chooseFolder: async () => {
    try {
      const res = await window.api.chooseFolder()
      if (res.root) set({ scanning: true, selection: null, search: '' })
    } catch {
      set({ scanning: false })
      useNotice.getState().show("Couldn't open that folder.")
    }
  },

  rescan: async () => {
    try {
      set({ scanning: true })
      await window.api.rescan()
    } catch {
      set({ scanning: false })
      useNotice.getState().show("Couldn't rescan your folder.")
    }
  },

  forget: async () => {
    try {
      await window.api.forget()
    } catch {
      /* clearing local state below is the meaningful part; ignore IPC failure */
    }
    set({
      root: null,
      rootName: null,
      playlists: [],
      tracksById: new Map(),
      scanning: false,
      progress: null,
      selection: null,
      search: ''
    })
  }
}))
