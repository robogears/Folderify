/// <reference types="vite/client" />
import type { FolderifyApi } from '@shared/api'

declare global {
  interface Window {
    api: FolderifyApi
  }
}

export {}
