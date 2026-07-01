import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.folderify.app',
  appName: 'Folderify',
  // The iOS WebView serves the mobile Vite build (see vite.mobile.config.ts).
  webDir: 'dist-mobile',
  ios: {
    // Dark shell behind the WebView so there's no white flash on launch.
    backgroundColor: '#0b0b0fff'
  }
}

export default config
