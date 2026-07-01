import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LayoutPreset = 'default' | 'compact' | 'cover' | 'clean_01' | 'clean_02'

export const LAYOUTS: { id: LayoutPreset; name: string; description: string }[] = [
  { id: 'default', name: 'Default', description: 'Album-art grid, comfortable rows' },
  { id: 'compact', name: 'Compact', description: 'Denser rows, more on screen' },
  { id: 'cover', name: 'Cover', description: 'Bigger artwork everywhere' },
  { id: 'clean_01', name: 'Clean 01', description: 'Bright, airy light theme' },
  { id: 'clean_02', name: 'Clean 02', description: 'Dark listening room, art panel' }
]

interface SettingsState {
  layout: LayoutPreset
  sidebarCollapsed: boolean
  resumeLastTrack: boolean
  /** Transient (not persisted): whether the settings panel is open. */
  settingsOpen: boolean

  setLayout: (layout: LayoutPreset) => void
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setResumeLastTrack: (v: boolean) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      layout: 'default',
      sidebarCollapsed: false,
      resumeLastTrack: true,
      settingsOpen: false,

      setLayout: (layout) => set({ layout }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setResumeLastTrack: (resumeLastTrack) => set({ resumeLastTrack }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false })
    }),
    {
      name: 'folderify.settings',
      // Only persist real preferences, never the transient panel-open flag.
      partialize: (s) => ({
        layout: s.layout,
        sidebarCollapsed: s.sidebarCollapsed,
        resumeLastTrack: s.resumeLastTrack
      })
    }
  )
)
