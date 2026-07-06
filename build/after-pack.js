// Ad-hoc code-sign the packaged macOS .app. Without ANY signature, Apple Silicon
// Gatekeeper rejects the app outright as "damaged" (harsher than the usual
// unidentified-developer warning). An ad-hoc signature (`--sign -`) is free, needs
// no Developer ID, and lets the app open via the normal right-click → Open flow.
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  const q = JSON.stringify(appPath)
  // Strip extended attributes (FinderInfo/quarantine/etc.) that make codesign
  // reject the bundle as "detritus". Harmless on a clean CI runner.
  try {
    execSync(`xattr -cr ${q}`, { stdio: 'inherit' })
  } catch {
    /* ignore */
  }
  // NOTE: `--deep` is deprecated by Apple for *signing* (it signs nested code with the
  // outer options rather than each item's own identifier/entitlements) and MUST be
  // dropped before any Developer ID + notarized build — electron-builder signs
  // inside-out natively once `mac.identity` is a real identity. It is intentional here
  // ONLY because this is an ad-hoc (`--sign -`), un-notarized build.
  execSync(`codesign --force --deep --sign - ${q}`, { stdio: 'inherit' })
  console.log(`[after-pack] ad-hoc signed ${appName}`)
}
