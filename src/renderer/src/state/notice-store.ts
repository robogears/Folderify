import { create } from 'zustand'

/**
 * A single transient, auto-dismissing toast message. Used for the handful of
 * moments the app needs to tell the user something briefly — a folder with
 * nothing playable, a scan that errored, an IPC call that rejected. Not for
 * long-lived state; the message clears itself after a few seconds.
 */
interface NoticeState {
  message: string | null
  show: (message: string) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useNotice = create<NoticeState>((set) => ({
  message: null,
  show: (message) => {
    if (timer) clearTimeout(timer)
    set({ message })
    timer = setTimeout(() => {
      timer = null
      set({ message: null })
    }, 4500)
  },
  clear: () => {
    if (timer) clearTimeout(timer)
    timer = null
    set({ message: null })
  }
}))
