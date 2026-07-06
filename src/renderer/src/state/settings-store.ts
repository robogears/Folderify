import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useNotice } from './notice-store'

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
  /** Grab F7/F8/F9 system-wide so only Folderify gets them (macOS; default OFF). */
  exclusiveMediaKeys: boolean
  /** Transient (not persisted): whether the settings panel is open. */
  settingsOpen: boolean

  setLayout: (layout: LayoutPreset) => void
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  setResumeLastTrack: (v: boolean) => void
  setExclusiveMediaKeys: (v: boolean) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      layout: 'default',
      sidebarCollapsed: false,
      resumeLastTrack: true,
      exclusiveMediaKeys: false,
      settingsOpen: false,

      setLayout: (layout) => set({ layout }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setResumeLastTrack: (resumeLastTrack) => set({ resumeLastTrack }),

      // Optimistic toggle; main confirms the grab. If macOS wants the Accessibility
      // grant (or another app holds the keys), revert and explain — a toggle that
      // stays on while doing nothing is worse than a visible failure.
      setExclusiveMediaKeys: (v) => {
        set({ exclusiveMediaKeys: v })
        window.api
          ?.setExclusiveMediaKeys(v)
          .then((r) => {
            if (v && !r.ok) {
              set({ exclusiveMediaKeys: false })
              useNotice
                .getState()
                .show(
                  r.reason === 'accessibility'
                    ? 'macOS needs permission first: System Settings → Privacy & Security → Accessibility → enable Folderify, then turn this on again.'
                    : 'Couldn’t take over the media keys — another app is holding them.'
                )
            }
          })
          .catch(() => {
            if (v) set({ exclusiveMediaKeys: false })
          })
      },

      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false })
    }),
    {
      name: 'folderify.settings',
      // Only persist real preferences, never the transient panel-open flag.
      partialize: (s) => ({
        layout: s.layout,
        sidebarCollapsed: s.sidebarCollapsed,
        resumeLastTrack: s.resumeLastTrack,
        exclusiveMediaKeys: s.exclusiveMediaKeys
      })
    }
  )
)
