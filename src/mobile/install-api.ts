// Picks the right window.api implementation for the current runtime: the native
// Capacitor-plugin bridge on a real device, or the browser stub otherwise (so
// `vite` preview of the mobile build still renders). Must run before the React
// app / stores load.
import { Capacitor } from '@capacitor/core'
import { installNativeApi } from './native-api'
import { installStubApi } from './api-stub'

export function installApi(): void {
  if (Capacitor.isNativePlatform()) {
    installNativeApi()
  } else {
    installStubApi()
  }
}
